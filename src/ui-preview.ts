import type { Album, ManageData } from './common.js';

/** Browser memory only. Installed solely by the branch-specific Preview build. */
export function installPreview(sample: Album) {
  const id = 'DEMO000000000001';
  let album = structuredClone(sample);
  album.id = id; album.shareSlug = 'ui-sample'; album.demo = true;
  album.rolls.forEach((roll, r) => roll.photos.forEach((photo, i) => {
    photo.id = `00000000-0000-4000-8000-${String(r * 100 + i).padStart(12, '0')}`;
  }));
  let revision = 0, status: ManageData['status'] = 'published';
  const manage = (): ManageData => ({album, shareId: id, shareSlug: 'ui-sample', revision, publishedRevision: 0, status});
  const nativeFetch = window.fetch.bind(window);
  const json = (data: unknown, code = 200) => Promise.resolve(new Response(JSON.stringify(data), {status: code, headers: {'Content-Type': 'application/json'}}));
  window.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (url.origin !== location.origin) return Promise.reject(new Error('External requests disabled in UI preview.'));
    if (!url.pathname.startsWith('/api/')) {
      if ((options?.method ?? 'GET') !== 'GET') return json({error: 'Uploads are disabled in this UI demonstration.'}, 403);
      return nativeFetch(input, options);
    }
    const path = url.pathname;
    if (path === '/api/platform') return json({enabled: true});
    if (path === '/api/auth/session') return json({authenticated: location.pathname !== '/login'});
    if (path === '/api/auth/otp') return json({cooldown: 60});
    if (path === '/api/auth/verify') {
      const body = JSON.parse(String(options?.body ?? '{}'));
      return body.code === '12345678' ? json({ok: true}) : json({error: 'Enter the eight-digit verification code.'}, 422);
    }
    if (path === '/api/manage/logout') { location.assign('/login'); return json({ok:true}); }
    if (path === '/api/editor') return json({albums: [{id, title:album.title, photoCount:album.rolls.reduce((n,r)=>n+r.photos.length,0), status, revision, shareSlug:'ui-sample'}]});
    if (path === '/api/editor/create') return json(manage());
    if (path === `/api/editor/${id}`) return json(manage());
    if (path === `/api/editor/${id}/save`) {
      const body = JSON.parse(String(options?.body ?? '{}')); album = body.album; revision++; return json(manage());
    }
    if (path === `/api/editor/${id}/publish` || path === `/api/editor/${id}/unpublish`) { status = path.endsWith('/unpublish') ? 'unpublished' : 'published'; return json(manage()); }
    if (path === '/api/demo' || path === '/api/a/ui-sample' || path === `/api/editor/${id}/preview`) return json(album);
    return json({error: 'This action is unavailable in the temporary UI demonstration.'}, 403);
  };
  // Replace persistent preference/like storage with per-document memory too.
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const values = new Map<string,string>();
    Object.defineProperty(window, name, {value: {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,String(v)),removeItem:(k:string)=>values.delete(k),clear:()=>values.clear(),key:(i:number)=>[...values.keys()][i]??null,get length(){return values.size;}}});
  }
  const note = document.createElement('aside');
  note.setAttribute('aria-label', 'UI demonstration');
  note.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:10000;padding:8px 16px;background:#241814;color:#eadfc7;font:12px/1.5 sans-serif;text-align:center';
  note.innerHTML = 'Temporary UI demo · resets on navigation · no email sent · code 12345678 · <a href="/login">Login</a> · <a href="/create">Create</a> · <a href="/dashboard">Studio</a> · <a href="/editor/DEMO000000000001">Editor</a> · <a href="/a/ui-sample?sidebar=1">Viewer menu</a>';
  note.querySelectorAll('a').forEach(a=>a.style.color='inherit'); document.body.append(note);
}
