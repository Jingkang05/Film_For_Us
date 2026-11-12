import { randomUUID } from "node:crypto";

// Test-only provider double. Never imported by application runtime modules.
export function authFixture(db) {
  const pending = new Map(), tokens = new Map(), users = new Map(), revoked = new Set(); let sequence = 0;
  let refreshes = 0;
  function mint(userId, sessionId, expiresAt = Math.floor(Date.now()/1000)+3600) {
    const access_token = `test.${Buffer.from(JSON.stringify({sub:userId,session_id:sessionId})).toString("base64url")}.${++sequence}`;
    const token = {access_token,refresh_token:randomUUID(),expires_at:expiresAt};
    tokens.set(access_token,{userId,sessionId,token}); return token;
  }
  return {
    pending, tokens, revoked,
    get refreshes() { return refreshes; },
    expireAccess() { for(const value of tokens.values()) value.token.expires_at=0; },
    clientFactory: () => ({auth:{
      async signInWithOtp({email}) { pending.set(email,{code:"12345678",expires:Date.now()+600000});return {error:null}; },
      async verifyOtp({email,token}) {
        const otp=pending.get(email);
        if(!otp || otp.code!==token || otp.expires<Date.now()) return {data:{},error:{status:403}};
        pending.delete(email);
        const identity=await db.transaction(async c=>{
          let {rows:[user]}=await c.query("select * from auth.users where email=$1",[email]);
          if(!user) { user={id:randomUUID(),email};await c.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[user.id,email]); }
          users.set(user.id,{...user,email_confirmed_at:new Date().toISOString()});
          const sessionId=randomUUID(); await c.query("insert into auth.sessions(id,user_id) values($1,$2)",[sessionId,user.id]);
          return {userId:user.id,sessionId};
        });
        return {data:{session:mint(identity.userId,identity.sessionId)},error:null};
      },
      async getUser(access) {
        const record=tokens.get(access);
        if(!record || revoked.has(record.sessionId)) return {data:{},error:{status:401}};
        return {data:{user:users.get(record.userId)},error:null};
      },
      async refreshSession({refresh_token}) {
        const record=[...tokens.values()].find(v=>v.token.refresh_token===refresh_token);
        if(!record || revoked.has(record.sessionId)) return {data:{},error:{status:401}};
        refreshes++; return {data:{session:mint(record.userId,record.sessionId)},error:null};
      },
      admin:{async signOut(access) {
        const record=tokens.get(access);
        if(record) revoked.add(record.sessionId);
        return {error:null};
      }},
    }}),
  };
}
