-- Server-mediated application schema. Never expose ffu through the Data API.
create schema if not exists ffu;
revoke all on schema ffu from public, anon;
grant usage on schema ffu to authenticated;

create table ffu.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '' check (length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table ffu.albums (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16}$'),
  owner_id uuid not null references ffu.profiles(id) on delete restrict,
  title text not null check (length(title) <= 80),
  description text not null default '' check (length(description) <= 2000),
  template_id text not null default 'film-darkroom-v1' check (template_id = 'film-darkroom-v1'),
  publication_status text not null check (publication_status in ('draft','published','unpublished','deleted')),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  published jsonb,
  version integer not null default 0 check (version >= 0),
  published_version integer check (published_version >= 0 and published_version <= version),
  legacy_media boolean not null default false,
  uploaded uuid[] not null default '{}',
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  upload_budget bigint not null default 0 check (upload_budget >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (publication_status <> 'published' or (published is not null and published_version is not null)),
  check (octet_length(draft::text) <= 2097152)
);
create index albums_owner_updated_idx on ffu.albums(owner_id, updated_at desc, id);
create table ffu.photos (
  album_id text not null references ffu.albums(id) on delete cascade,
  snapshot text not null check (snapshot in ('draft','published')),
  id uuid not null,
  asset_id uuid not null,
  roll_id text not null check (roll_id in ('roll-1','roll-2','roll-3')),
  display_order integer not null check (display_order >= 0 and display_order < 500),
  caption text not null default '' check (length(caption) <= 600),
  photo_date date,
  original_object_key text not null,
  thumbnail_object_key text not null,
  optimized_object_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (album_id,snapshot,id),
  unique (album_id,snapshot,display_order) deferrable initially deferred
);
create table ffu.share_addresses (
  address text primary key check (length(address) between 1 and 80 and address ~ '^[A-Za-z0-9_-]+$'),
  album_id text not null references ffu.albums(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index share_addresses_album_idx on ffu.share_addresses(album_id);
create table ffu.uploads (
  album_id text not null references ffu.albums(id) on delete restrict,
  asset_id uuid not null,
  source_size integer not null check (source_size between 1 and 20971520),
  created_at timestamptz not null default now(),
  primary key (album_id,asset_id)
);
create table ffu.app_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  encrypted_tokens text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index app_sessions_user_idx on ffu.app_sessions(user_id);
create index app_sessions_expiry_idx on ffu.app_sessions(expires_at);
create table ffu.rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create index rate_limits_expiry_idx on ffu.rate_limits(expires_at);
create table ffu.imports (
  digest text primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  album_count integer not null,
  archive jsonb not null,
  created_at timestamptz not null default now()
);

alter table ffu.profiles enable row level security;
alter table ffu.albums enable row level security;
alter table ffu.photos enable row level security;
alter table ffu.share_addresses enable row level security;
alter table ffu.uploads enable row level security;
alter table ffu.app_sessions enable row level security;
alter table ffu.rate_limits enable row level security;
alter table ffu.imports enable row level security;

grant select, insert, update, delete on ffu.profiles, ffu.albums, ffu.photos, ffu.share_addresses, ffu.uploads to authenticated;
revoke all on ffu.app_sessions, ffu.rate_limits, ffu.imports from public, anon, authenticated;

create policy profiles_own on ffu.profiles to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy albums_own on ffu.albums to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy photos_own on ffu.photos to authenticated
  using (album_id in (select id from ffu.albums where owner_id = (select auth.uid())))
  with check (album_id in (select id from ffu.albums where owner_id = (select auth.uid())));
create policy addresses_own on ffu.share_addresses to authenticated
  using (album_id in (select id from ffu.albums where owner_id = (select auth.uid())))
  with check (album_id in (select id from ffu.albums where owner_id = (select auth.uid())));
create policy uploads_own on ffu.uploads to authenticated
  using (album_id in (select id from ffu.albums where owner_id = (select auth.uid())))
  with check (album_id in (select id from ffu.albums where owner_id = (select auth.uid())));

-- Ownership and permanent address bindings cannot be reassigned, including by
-- direct SQL under the authenticated role. All functions are SECURITY INVOKER.
create function ffu.immutable_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
    raise exception 'Album identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger immutable_album_owner before update on ffu.albums for each row execute function ffu.immutable_owner();
create function ffu.immutable_address() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Share addresses are permanent' using errcode = '42501';
end $$;
create trigger immutable_share_address before update or delete on ffu.share_addresses for each row execute function ffu.immutable_address();
revoke execute on function ffu.immutable_owner(), ffu.immutable_address() from public, anon, authenticated;
