# Phase 4 architecture and release gates

## Audit — 12 November 2026

The frontend is vanilla TypeScript compiled to browser modules, with path dispatch in `src/main.ts`. One Node 24 handler serves local development and the Vercel catch-all API. Keep the current domain, GitHub integration, Node APIs, Sharp pipeline, MemoryProject validation, three-roll template, bilingual UI and Viewer scenes.

Production inspection found Vercel project `roll-for-us`, `prj_AHaa2K8NoPwa5jgGK8AmoUZvvNl2`, with a READY production deployment `dpl_C95nrdoNjPuaGDN8ySpwKxhJuY4R`. Production has R2 configuration and no Supabase variables. No credentials were printed. R2 uses fresh control-document authorization, SHA-256 immutable album snapshots, separate administrator/session state, conditional writes, immutable media, bounded caches and signed source uploads. Routine builds skip storage access.

Fresh public API reads returned 200 for **both** `/a/ruoxue` (ID `OhqQkmPtTAlxEkHH`, 11 photos) and `/a/bluesecret` (ID `aFeMZ8QZkQO1AkYH`, 24 photos). These are observations, not a complete private-state backup. The historical recovery report predates BlueSecret and must never be used as the migration source. Eighteen original photos remain pending according to that report; export current recovery metadata rather than fabricating records.

The local Git remote uses the previous `Jingkang05/Roll_For_Us` name. GitHub confirms both names resolve to repository ID `1449185449`, now `Jingkang05/Film_For_Us`, with default branch `main`. Preserve the configured remote. Existing uncommitted typography/CSS/font-tool changes belong to the user and are excluded from Phase 4 commits.

## Target

Vercel remains the application/backend, Supabase Auth verifies numeric email OTP, Supabase PostgreSQL owns structured records, and private R2 retains every media key. No Supabase Storage or new Blob operations. `ALBUM_DATA_PROVIDER=postgres` is an explicit cutover flag; default legacy behavior continues until migration and release gates pass. Never automatically fall back from PostgreSQL to stale R2 JSON.

Creator reads/writes execute in transactions under the `authenticated` database role with verified identity claims and RLS. A non-exposed `ffu` schema contains profiles, albums, ordered draft/publication photo projections, permanent share-address reservations, upload reservations, encrypted application sessions, rate limits and import records. Do not add `ffu` to Data API exposed schemas. Public HTTP routes use explicit publication and membership predicates and return sanitized Viewer data. No public database policy exposes draft JSON or owner metadata.

Existing `collectionStore` and album validators run on one owned album at a time. Row locks, expected revisions, unique share-address constraints, photo projection replacement and publication updates commit together. Immutable R2 writes precede metadata commit; failures can leave private orphan objects but cannot publish uncommitted photos. Deletes are tombstones; media and permanent share reservations are retained.

Authentication is same-origin and server-mediated. Browsers receive only a random HttpOnly, SameSite cookie; Supabase tokens remain AES-GCM encrypted in private PostgreSQL sessions. Refresh is serialized by row locks. Each protected request verifies the user through Supabase and checks the session ID against `auth.sessions`, supporting immediate application revocation. There is no permanent legacy-password bypass in PostgreSQL mode.

## External gates

Initial discovery found only unrelated projects. After the user identified their new Film For Us project, discovery confirmed `lppysxtcvuphvynrvtyr`. The additive schema and owner-index migrations were applied to that empty project; no albums were imported. Security advisors report only expected INFO notices for three deliberately default-deny private tables. Performance advisors report only unused indexes on the empty schema. Custom SMTP, server credentials, real mailbox delivery, verified administrator identity and hosted integration tests remain required. No paid service was activated. See `phase-4-release.md` for exact configuration and staged transfer instructions.
