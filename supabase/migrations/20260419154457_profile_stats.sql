-- Persistent profile stats: cross-game lifetime numbers shown on /account
-- and the public /u/<handle> page.

alter table profiles
  add column if not exists handle text,
  add column if not exists games_played int not null default 0,
  add column if not exists games_won int not null default 0,
  add column if not exists rounds_played int not null default 0,
  add column if not exists total_score int not null default 0,
  add column if not exists best_round_score int not null default 0,
  add column if not exists daily_streak int not null default 0,
  add column if not exists daily_longest_streak int not null default 0,
  add column if not exists last_daily_on date;

-- Handles are URL slugs: ascii lowercase letters, digits, underscore, 3..24.
create unique index if not exists profiles_handle_unique
  on profiles (lower(handle))
  where handle is not null;

-- Backfill handle for existing profiles: start from display_name sanitized,
-- fall back to "player" + short id fragment. Uniqueness enforced by the
-- index above; loop + suffix until we find an open one.
create or replace function ensure_profile_handle(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_base text;
  v_candidate text;
  v_attempt int := 0;
begin
  select handle into v_existing from profiles where id = p_user_id;
  if v_existing is not null then return v_existing; end if;

  select lower(regexp_replace(coalesce(display_name, ''), '[^a-zA-Z0-9_]+', '_', 'g'))
    into v_base
    from profiles where id = p_user_id;
  v_base := trim(both '_' from coalesce(v_base, ''));
  if v_base is null or char_length(v_base) < 3 then
    v_base := 'player_' || substr(p_user_id::text, 1, 6);
  end if;
  if char_length(v_base) > 20 then
    v_base := substring(v_base, 1, 20);
  end if;

  loop
    v_candidate := case when v_attempt = 0 then v_base else v_base || v_attempt::text end;
    begin
      update profiles set handle = v_candidate where id = p_user_id;
      return v_candidate;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 50 then
        raise exception 'could not allocate handle for %', p_user_id;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function ensure_profile_handle(uuid) from public;
grant execute on function ensure_profile_handle(uuid) to authenticated;

-- Backfill: make sure every existing profile has a handle right now.
do $$
declare
  r record;
begin
  for r in select id from profiles where handle is null loop
    perform ensure_profile_handle(r.id);
  end loop;
end $$;

-- Update handle_new_user + handle_user_promoted to allocate a handle too.
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

  perform ensure_profile_handle(new.id);
  return new;
end;
$$;

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

  perform ensure_profile_handle(new.id);
  return new;
end;
$$;

-- bump_round_stats: service-role callers hit this after finalize-round to
-- increment per-round counters. Only bumps profiles that exist (signed-in
-- players) — anonymous players are silently skipped.
create or replace function bump_round_stats(
  p_player_id uuid,
  p_round_total int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
    set rounds_played = rounds_played + 1,
        total_score = total_score + greatest(p_round_total, 0),
        best_round_score = greatest(best_round_score, coalesce(p_round_total, 0)),
        updated_at = now()
    where id = p_player_id;
end;
$$;
revoke all on function bump_round_stats(uuid, int) from public;
-- service-role only; no grant to authenticated/anon.

-- bump_game_stats: call once per player at game_over with a "did_win" flag.
create or replace function bump_game_stats(
  p_player_id uuid,
  p_did_win boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
    set games_played = games_played + 1,
        games_won = games_won + case when p_did_win then 1 else 0 end,
        updated_at = now()
    where id = p_player_id;
end;
$$;
revoke all on function bump_game_stats(uuid, boolean) from public;

-- bump_daily_streak: idempotent per-day. Called from the daily guess route
-- when a signed-in user submits their first guess of the UTC day.
create or replace function bump_daily_streak(p_player_id uuid, p_today date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_current int;
  v_longest int;
  v_next int;
begin
  select last_daily_on, daily_streak, daily_longest_streak
    into v_last, v_current, v_longest
    from profiles where id = p_player_id;
  if not found then return; end if;

  if v_last = p_today then
    -- already counted today; nothing to do.
    return;
  elsif v_last = p_today - interval '1 day' then
    v_next := coalesce(v_current, 0) + 1;
  else
    v_next := 1;
  end if;

  update profiles
    set daily_streak = v_next,
        daily_longest_streak = greatest(coalesce(v_longest, 0), v_next),
        last_daily_on = p_today,
        updated_at = now()
    where id = p_player_id;
end;
$$;
revoke all on function bump_daily_streak(uuid, date) from public;
