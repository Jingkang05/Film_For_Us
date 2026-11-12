# Phase 4 implementation evidence — 12 November 2026

## Result and limits

Phase 4 code is implemented on `codex/phase-4-supabase-multi-user`; Production cutover is **not complete**. The existing website was not redeployed, frozen, or switched to PostgreSQL. No production R2 object was overwritten or deleted. The user's five existing typography/CSS/font-script modifications remain separate from the implementation.

Dedicated Film For Us Supabase project `lppysxtcvuphvynrvtyr` now has two additive migrations matching local filenames and hosted migration history:

- `20261112005816_phase4_multi_user`
- `20261112005929_phase4_import_owner_index`

All eight application tables have RLS enabled. Hosted inspection confirms `anon` has no SELECT grant on any application table. Authenticated users have no grant on application sessions, rate limits or imports. Owner policies protect profiles/albums and join photo/address/upload access to owned albums. An immutable-owner trigger prevents reassignment. Share-address bindings are permanent. The `ffu` schema must remain outside the Data API exposed schemas.

Security advisor at schema verification: no WARN/ERROR notices; three expected INFO notices for intentionally default-deny private tables without policies. Performance advisor: missing import-owner FK index fixed; only unused-index INFO remained while all eight application tables were empty. The later SMTP delivery test requested an OTP for the approved mailbox through Supabase Auth, but did not verify it or create an application session, profile, album or ownership assignment.

## Automated evidence

| Check | Result | Scope |
| --- | --- | --- |
| `pnpm check` | PASS | TypeScript and backend/script syntax |
| `pnpm build` | PASS | Compiles UI; explicitly skips storage reads |
| `pnpm test` | 73 passed, 0 failed | Existing regressions plus embedded PostgreSQL, sessions and migration tests |
| `pnpm audit:storage` | PASS | Offline synthetic audit, zero production requests |
| Browser verification | Six groups passed, no page errors | Real local HTTP/backend + embedded PostgreSQL/RLS + synthetic Auth/in-memory R2 |
| Interface detector | `[]` | New platform UI/library/CSS static scan |
| Independent UI verdict | Ship at reviewed scope | Three listed findings resolved; incumbent-system documentation check made no changes |

The initial sandboxed regression run could not bind loopback (`listen EPERM`); rerunning with authorized local networking passed. No application test failure was suppressed. The HEIC negative fixture emits its expected decoder diagnostic while its tests pass.

Embedded PostgreSQL tests use two independent user UUIDs and the real PostgreSQL role/RLS engine. They verify private draft isolation, cross-owner read/save/upload/delete/media denials, direct SQL owner-change denial, photo-policy isolation, permanent aliases, sanitized public reads, stale/concurrent edit rejection, legacy preview-media routes, live unpublish checks before cached 304, and tombstone deletion without R2 deletion. They are not a substitute for two hosted OTP users in an isolated Supabase project.

Auth tests use the production auth/session module with a test-only provider double. They cover new/existing account flows, invalid/expired/replayed OTP rejection, cooldown, origin/CSRF rejection, AES-GCM integrity, HttpOnly/Secure/SameSite cookie properties, backend-restart persistence, serialized refresh, logout, upstream revocation, environment isolation and idempotent identity-verified import. No test-provider route exists in the production handler. Real SMTP and hosted numeric-OTP delivery were verified in the Resend follow-up below; hosted OTP expiry/replay remain unverified.

Browser script: `scripts/check-phase4-browser.mjs`. It starts/disposes its own isolated preview; no production credentials are used. Reproduce with `pnpm exec playwright install chromium --only-shell` followed by `pnpm test:browser`. Desktop viewport 1440×1000; mobile 390×844; reduced motion for deterministic scene checks. Screenshots and `browser-results.json` are under ignored `.data/phase4-qa/`. Checked:

1. Login-free publication, native modal sidebar, Escape/close/backdrop, focus return.
2. Incorrect-email recovery, numeric OTP entry/error/cooldown and direct return to Create.
3. Visiting Create creates no draft; Start creates one owned album; sample uploads, save, private Preview, return to Editor, publish and Studio.
4. Logout blocks owner APIs while publication stays available.
5. Envelope, film strip/detail, viewer lever, new likes, developing, hanging and ending invitation entering login-aware Create.
6. Mobile Viewer/header/menu, login, empty Studio and Create; English switching and no horizontal overflow.

## Bounded live preservation checks

Fresh production public API reads returned 200 for `/api/a/ruoxue` (stable ID `OhqQkmPtTAlxEkHH`, 11 photos) and `/api/a/bluesecret` (stable ID `aFeMZ8QZkQO1AkYH`, 24 photos). These current records supersede assumptions from the older recovery report. They are not private backups and cannot safely serve as an import source.

Exactly two sampled thumbnail GETs returned 200, `image/webp`, `private, no-cache`:

| Album | Photo ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| ruoxue | `fc67ab7d-1af7-459c-9b04-98f5ccfcaa56` | 12,318 | `662863be9b88ac17eb3468ccec21dfdac017f1aead09ca27e77eee7dd6555b36` |
| bluesecret | `162730e3-be14-437e-9983-d19b644fb0a7` | 10,594 | `8708e26ee0d3ecaa94c8b4d58832abd3734b6edbdcfa31a9505ad1b3c45f9216` |

No production media scan or additional Blob request was made. Original pending-recovery records remain a reported gap; this phase does not claim to recover missing photos.

## Remaining release gates

- Resend domain/custom SMTP and Gmail OTP delivery are verified. Actual QQ/163/Outlook delivery remains pending.
- Production server credentials, encryption key and isolated Preview configuration.
- Explicit administrator email and verified UUID, active OTP application session and legacy administrator proof.
- Fresh private R2 backup under a verified live write freeze; import, byte/content/path/alias validation and staged cutover.
- Hosted two-user adversarial tests, real signed-R2 upload with content-length enforcement, session refresh/revocation and end-to-end release checks.
- Real Safari/iPhone and mainland-China network testing; neither is claimed by Chromium mobile emulation.
- Required CI checks and final staged deployment/log checks before merge or production promotion.

The automatic production-deployment authorization remains valid once those gates pass. Until then, a draft PR can be reviewed without exposing a partially configured multi-user platform. Exact setup, SMTP example, migration commands, rollback/forward-repair procedure, and cost controls are in `phase-4-release.md`.

## Resend / Supabase SMTP completion

After the user approved the five additive Vercel DNS records, `auth.filmforus.space` verified in Resend. A domain-restricted sending-only SMTP key is stored in macOS Keychain. A real TLS SMTP test was delivered and two idempotent submissions produced one email. The user saved Supabase SMTP credentials. Both signup and login email templates now use `{{ .Token }}`, the hosted eight-digit OTP default was retained, and the expiry is 600 seconds. The application form, backend validation, bilingual copy and test fixtures were aligned to eight digits. A real Supabase-generated email was confirmed delivered with an eight-digit numeric code, no magic link and no unfilled variables; no code or credential was logged. The code was left unused, so sign-in verification, an active application session and administrator ownership transfer remain separate gates.
