# Phase 4 configuration, migration and release

## Current release status

Implementation is on `codex/phase-4-supabase-multi-user`. Film For Us Supabase project: `lppysxtcvuphvynrvtyr`, Mumbai (`ap-south-1`). User reports custom SMTP is not configured. No verified administrator email/UUID has been supplied. Live R2 metadata has not been imported. Production remains on its functioning legacy R2 implementation. Never declare release gates passed from local synthetic tests alone.

## Configure Supabase

1. Open the **Film For Us** project. Do not reuse Nested KL or 圆周旅迹. For Preview/Development, create a separate free project if your organization has capacity; otherwise use the local fixture for development until an isolated project exists. Do not activate a paid project or branch without approval.
2. Apply the versioned migration in `supabase/migrations/20261112005816_phase4_multi_user.sql`. The `ffu` schema must **not** be included in **Integrations → Data API → Exposed schemas**. No Supabase Storage bucket is needed. Check Database Advisors after applying it.
3. Under **Authentication → Sign In / Providers → Email**, enable email sign-in, confirmations and new users; set **OTP length to 6** and **Email OTP expiration to 600 seconds**. Keep anonymous sign-in disabled. Disable password-based sign-in if the current dashboard offers that setting; the app provides OTP only.
4. In **Authentication → Email → Templates**, put the contents of `supabase/templates/email-otp.html` in both **Magic Link / OTP** and **Confirm signup** templates. The template uses `{{ .Token }}` rather than a confirmation URL. Subject: `Your Film For Us verification code`. Test a brand-new email and an existing user; both must receive a numeric code, not a required magic-link click.
5. In **Authentication → URL Configuration**, set Site URL to `https://filmforus.space`. Numeric OTP is verified on the backend; no wildcard redirect is required.
6. Configure OTP send cooldown at least 60 seconds, verification rate limits, and email send limits appropriate to the SMTP provider. The app additionally enforces shared PostgreSQL limits: 30 auth attempts/IP/15 minutes, 6 sends/email/hour, one send/email/minute and 8 verify attempts/email/15 minutes. Supabase must still enforce its own limits because its Auth endpoint exists independently of the app.
7. Keep token refresh reuse detection enabled. Use the normal one-hour JWT lifetime. The application cookie has a maximum 14-day life and every protected request checks the corresponding `auth.sessions` record plus the verified Auth user. No paid Supabase session-duration feature is required.

## Configure custom SMTP — required manual account setup

In **Authentication → Email → SMTP**, enable custom SMTP and enter your provider's **host, port, username, password, From email and sender name**. Use sender name `Film For Us`. Obtain exact host/port and credentials from an existing SMTP provider account; do not guess them. Configure its domain-verification records (SPF/DKIM/DMARC) through the domain provider before sending. Use a dedicated verified address such as `no-reply@auth.filmforus.space` only after that subdomain is verified. Never commit SMTP passwords or paste them into chat.

Supabase accepts standard SMTP providers; [Supabase's SMTP setup guide](https://supabase.com/docs/guides/auth/auth-smtp) documents the dashboard and provider options. Its default email service is restricted and unsuitable for public rollout. If you have no provider, create/select one and approve any charge yourself; no provider subscription was activated by this implementation.

If you want a concrete starting point, Resend documents a Supabase SMTP integration. Create a free account, add and verify a sending subdomain such as `auth.filmforus.space` using the exact DNS records Resend supplies, and create a sending API key restricted to that domain. In Supabase enter **Host `smtp.resend.com`, Port `465`, Username `resend`, Password your Resend API key**, Sender email `no-reply@auth.filmforus.space` (only after verification), Sender name `Film For Us`. See [Resend's official Supabase instructions](https://resend.com/docs/send-with-supabase-smtp). Keep paid overages disabled and check the [current free-plan limits](https://resend.com/pricing); the plan currently lists a 100-email daily limit. These SMTP settings do not establish mainland delivery compatibility; verify the real mailboxes below.

Verify inbox and spam-folder delivery to real QQ, 163, Outlook and Gmail mailboxes. Record delivery latency, success/failure and OTP replay/expiry results without storing codes or tokens. SMTP setup is not complete until both registration and returning-user delivery work.

## Configure Vercel server variables

Open Vercel → `roll-for-us` → Settings → Environment Variables. Production variables must target **Production only**:

| Variable | Value/source |
| --- | --- |
| `SUPABASE_URL` | `https://lppysxtcvuphvynrvtyr.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Settings → API Keys → publishable key (`sb_publishable_…`) |
| `DATABASE_URL` | Supabase **Connect → Transaction pooler**, exact host/username, port 6543; substitute URL-encoded database password |
| `SESSION_ENCRYPTION_KEY` | 32 cryptographically random bytes as 64 lowercase hex characters; generate locally and save as Sensitive |
| `SUPABASE_ENVIRONMENT` | `production` |
| `SUPABASE_PRODUCTION_REF` | `lppysxtcvuphvynrvtyr` |
| `ALBUM_DATA_PROVIDER` | `legacy` until cutover; `postgres` only after verified import |
| `STORAGE_PROVIDER` | Keep `r2` |
| `APP_ORIGIN` | Keep `https://filmforus.space` for Production; staged deployment origin must match the tested host |

Keep all existing Production R2 variables. `DATABASE_URL`, session encryption and R2 credentials are server-only Sensitive values. No service-role/secret API key is required. The database connection is privileged and used only on the server: creator operations explicitly switch to the authenticated role under RLS; public operations have narrow publication predicates; session/rate-limit operations access private tables. Use a verified TLS certificate chain; never disable certificate validation. The connection pool is capped at three per function instance, uses transaction-local role/claims, and does not use named prepared statements.

Preview variables must use a different Supabase reference, different encryption key and private development R2 bucket. Set `SUPABASE_ENVIRONMENT=preview`, `R2_ENVIRONMENT=preview` and the exact Preview `APP_ORIGIN`. Configuration rejects using the Production Supabase project in **either** development or preview, and rejects mismatched database/project URLs. Do not fix such a failure by relabeling a Preview environment as Production.

To generate the encryption key locally, run:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the output directly in your environment manager. Rotation invalidates encrypted application sessions; plan a sign-in-again window rather than trying to decrypt with a new key.

## Verified administrator association

Sign in through the staged application using your actual email OTP. Obtain your UUID from **Authentication → Users** and explicitly identify the email and UUID as the legacy administrator. The import requires that confirmed email and UUID agree, an active OTP application session exists, and the existing administrator password verifies against the **fresh** R2 export's existing salted hash. Supply `LEGACY_ADMIN_PASSWORD`, `MIGRATION_OWNER_EMAIL` and `MIGRATION_OWNER_ID` only in the private operator environment. Do not commit them. There is no first-user ownership assignment and no HTTP import/admin-bypass route.

## Controlled transfer

Do this only after SMTP, identity, isolated integration tests and staged application behavior are verified. Preserve the previous stable R2 commit/deployment and current root/auth documents.

1. Stage the Phase 4 build without assigning the public domain. Use isolated Preview credentials for destructive/adversarial tests. A production-credential staged build must use Vercel's production target with `--skip-domain`, never an environment-spoofed Preview.
2. Freeze the **live legacy application** by setting `STORAGE_WRITE_FREEZE=true` on Production and deploying the unchanged stable R2 implementation with that flag. Verify real write requests return 503 while both public albums and media remain available. Wait for prior in-flight Vercel writes to drain based on the deployment's configured max duration. The operator script flags alone do not freeze the live deployment. Keep older deployment URLs protected and do not route writes to them.
3. In a trusted Production server/operator environment with Production R2 credentials, set `STORAGE_WRITE_FREEZE=true` and `MIGRATION_FREEZE_CONFIRMED=true`, then run the commands below. A dedicated local operator shell must explicitly set `VERCEL_ENV=production` and `SUPABASE_ENVIRONMENT=production` for this authorized Production operation. Never set those values in a Preview deployment to bypass isolation checks.

```sh
node scripts/migrate-to-postgres.mjs export .data/phase4/fresh-state.json
node scripts/migrate-to-postgres.mjs import .data/phase4/fresh-state.json
node scripts/migrate-to-postgres.mjs verify .data/phase4/fresh-state.json
```

The exporter reads current authoritative R2 control/snapshots/auth without scanning media, writes a create-only private R2 backup, reads exact bytes back, verifies a second fresh export, and writes a mode-0600 local backup plus manifest. Import checks the live state still matches, verifies administrator proof, preserves IDs/asset IDs/paths/captions/dates/order/versions/draft/publication/aliases, creates normalized photo projections, archives private recovery extras, and validates round-trips inside a transaction. A checksum-identical reimport returns without replaying old data. A different import colliding with existing album IDs aborts. No R2 media is moved, overwritten or deleted.

4. Set `ALBUM_DATA_PROVIDER=postgres` in the staged Production application, retaining the freeze. Verify exact migrated metadata, both legacy share URLs, unauthorized editor/draft/upload/delete checks, and sampled original R2 media bytes/ETags. Use the imported manifest to check all alias and ID mappings; the known public baseline is 11 ruoxue photos and 24 BlueSecret photos, but newer edits may legitimately change those counts before the freeze.
5. Before promotion, require successful hosted end-to-end and adversarial tests on the **isolated Preview** environment, real Production OTP delivery/administrator sign-in on the protected staged app, migrated-content/read-only checks on the frozen staged app, and clean runtime logs. Confirm no legacy write process is active and the final R2 fingerprint still agrees. Only after these gates pass, merge/release through the existing Git integration, verify the resulting staged Production build, promote it, and remove its application write freeze. Keep the legacy source frozen forever after accepting PostgreSQL creator writes. PostgreSQL is now the sole mutable authority.
6. Confirm READY and repeat bounded live checks after production assignment: original URLs/media, OTP, owner Studio, Create → Editor → Preview → Publish → public Viewer, sidebar, collection CTA and logout. Use only the operator's own newly created test album for any live functional smoke checks; destructive and adversarial testing belongs in the isolated environment. Inspect runtime error logs and repair forward if new PostgreSQL content has been accepted.

## Rollback / forward repair

Before accepting PostgreSQL writes, a failed staged cutover can return traffic to the frozen stable R2 deployment, then unfreeze that legacy source after verifying no PostgreSQL writes occurred. After accepting PostgreSQL writes, preserve PostgreSQL as authority: repair forward or deploy a previous compatible application build. Never revert the provider flag to old R2 JSON or restore the initial import over new user records. Keep database migration history, private backup manifests, immutable media and permanent address reservations. Take a fresh database backup before any later data repair.

## Costs and mainland China evidence

No mainland network or mailbox delivery test has been performed. The browser calls same-origin Vercel Auth routes, avoiding a direct browser-to-Supabase dependency for login. This reduces one network dependency but does **not** prove mainland compatibility: Vercel/domain accessibility, R2 signed upload endpoint access and each mailbox provider still need real network/device tests. Test QQ/163/Outlook/Gmail from mainland China and record results. No Google OAuth or WeChat login is required.

R2 remains private. Source uploads are create-only, short-lived and signed for an exact content length. Shared upload rate limits, 50 lifetime albums/user, 500 active photos/album, 20 MiB sources and conservative 2 GiB lifetime storage accounting/user limit abuse. Failed uploads consume budget; deleting an album does not reset it. Objects unreferenced after failed processing are retained privately for a future reviewed garbage-collection job. No automatic deletion job touches legacy media.

Public media uses indexed PostgreSQL membership/publication checks before immutable cached bytes or a 304. There are no R2 HEAD/LIST operations in normal requests or builds. Viewer media is proxied through Vercel; Vercel bandwidth and function duration still cost resources even with R2's egress pricing. Inspect Vercel transfer/invocations, R2 stored bytes/Class A/Class B operations and Supabase database size/connections/Auth email volume. Configure free dashboard usage notifications and spend caps where available on the selected plan; do not upgrade plans to enable a paid alert. Add a bounded operator cleanup of expired `ffu.rate_limits` and `ffu.app_sessions` after retention review.
