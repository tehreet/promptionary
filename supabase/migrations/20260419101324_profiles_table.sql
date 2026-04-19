-- Profiles: one row per real (non-anonymous) Supabase user. Mirrors the
-- info we want to show across the app - display name, avatar - so we don't
-- round-trip to auth.users on every render.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Anyone can read profiles (they back leaderboards and in-game names).
create policy profiles_select on profiles for select to authenticated, anon
  using (true);

-- Owners can update their own row.
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create a profile row when a real user signs up. Skip anonymous
-- users - they don't have a stable identity worth persisting yet.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_avatar text;
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'user_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'preferred_username'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'player'
  );
  if char_length(v_name) > 24 then
    v_name := substring(v_name, 1, 24);
  end if;

  v_avatar := nullif(trim(new.raw_user_meta_data->>'avatar_url'), '');

  insert into profiles (id, display_name, avatar_url)
    values (new.id, v_name, v_avatar)
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Also promote when an anon user links a real identity: their row is
-- UPDATEd to is_anonymous=false and gains email/metadata. Create the
-- profile then.
create or replace function handle_user_promoted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_avatar text;
begin
  if coalesce(old.is_anonymous, false) = false then return new; end if;
  if coalesce(new.is_anonymous, false) = true then return new; end if;

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'user_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'preferred_username'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'player'
  );
  if char_length(v_name) > 24 then
    v_name := substring(v_name, 1, 24);
  end if;
  v_avatar := nullif(trim(new.raw_user_meta_data->>'avatar_url'), '');

  insert into profiles (id, display_name, avatar_url)
    values (new.id, v_name, v_avatar)
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_promoted on auth.users;
create trigger on_auth_user_promoted
  after update on auth.users
  for each row execute function handle_user_promoted();
