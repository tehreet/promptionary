-- Passkeys: stored WebAuthn credentials, keyed by user_id. All reads and
-- writes happen via service-role-only API routes, so we keep RLS locked
-- down.

create table if not exists passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id bytea not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists passkeys_user_idx on passkeys (user_id);

alter table passkeys enable row level security;
-- No client-facing policies: all CRUD goes through /api/auth/passkey/* using
-- the service role. RLS stays closed by default.

-- Small helper: let an anon user look up whether a passkey registration
-- exists (but nothing else). Also used by tests to assert enrollment.
create or replace function passkey_count_for_user(p_user_id uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from passkeys where user_id = p_user_id;
$$;
revoke all on function passkey_count_for_user(uuid) from public;
grant execute on function passkey_count_for_user(uuid) to authenticated, anon;
