-- Quick Match: public matchmaking lobbies.
--
-- Solo visitors hit "Quick Match" on the home page and get dropped into an
-- existing open lobby with <6 players. If none exists, a new public lobby is
-- minted. The flow is deliberately light: party mode, mixed pack, all
-- defaults — no settings prompt, no code to share. The host is still the
-- original creator (same semantics as a code-created room); nothing special
-- about "public" other than the visibility flag + the matchmaker RPC.

-- 1. Add is_public flag. Existing rooms stay private (false) by default.
alter table rooms
  add column if not exists is_public boolean not null default false;

-- Partial index for the matchmaker lookup — only indexes the handful of
-- rooms that can actually receive a drop-in player at any given moment.
-- (phase = 'lobby', is_public = true). created_at so we can pick the
-- freshest candidate and age off anything stale.
create index if not exists rooms_public_lobby_idx
  on rooms (created_at desc)
  where is_public = true and phase = 'lobby';

-- 2. find_or_create_quick_match: atomic-ish matchmaker.
--
-- Search order:
--   - Public rooms in 'lobby' phase,
--   - created in the last 5 minutes (so we don't drop you into a ghost town
--     where everybody wandered off),
--   - with strictly fewer than 6 players (counts spectators too — Quick
--     Match rooms don't ship spectators, so this is fine),
--   - oldest first (FIFO-ish: fill the earliest room before opening a new
--     one, keeps the matchmaking experience "hot lobby, join now").
--
-- If found: upsert the caller into room_players and return (id, code).
-- If not: generate a code, create a public lobby owned by the caller, add
-- them as host, return (id, code).
--
-- Returned columns are prefixed `new_` to avoid the ambiguous-column
-- shadowing trap (42702) documented in AGENTS.md.
--
-- TODO(v2): auto-start rounds once a public lobby hits 4+ players after a
-- short countdown (15s?). For v1 we keep host-start as the pattern — the
-- original creator still drives the round; drop-in joiners wait on them.
create or replace function find_or_create_quick_match(p_display_name text)
returns table(new_room_id uuid, new_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_code text;
  v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  -- Try to find a joinable public lobby. `for update skip locked` so
  -- concurrent Quick Match hits don't race-double-book the same slot —
  -- losers just skip to the next candidate or fall through to create.
  select r.* into v_room
  from rooms r
  where r.is_public = true
    and r.phase = 'lobby'
    and r.created_at > now() - interval '5 minutes'
    and (
      select count(*) from room_players rp where rp.room_id = r.id
    ) < 6
  order by r.created_at asc
  limit 1
  for update skip locked;

  if found then
    -- Already a member? No-op on conflict, just refresh the display name.
    insert into room_players (room_id, player_id, display_name, is_host)
      values (v_room.id, auth.uid(), p_display_name, false)
      on conflict (room_id, player_id)
      do update set display_name = excluded.display_name;

    return query select v_room.id, v_room.code;
    return;
  end if;

  -- Nothing joinable — mint a new public lobby with defaults. Party mode,
  -- mixed pack, standard timings. The caller becomes host.
  v_code := generate_room_code();

  insert into rooms (
    code, host_id, mode, pack,
    max_rounds, guess_seconds, reveal_seconds,
    is_public
  )
  values (
    v_code, auth.uid(), 'party'::room_mode, 'mixed'::room_pack,
    5, 45, 20,
    true
  )
  returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;

revoke all on function find_or_create_quick_match(text) from public;
grant execute on function find_or_create_quick_match(text) to authenticated;

-- 3. Extend the existing pg_cron tick to also evict dead public lobbies:
-- >5 minutes old, still in lobby, <2 players => nobody's coming, kill it.
-- (Non-public rooms are unaffected — they may be waiting on an invite link.)
--
-- We redefine the tick function; the cron job itself doesn't need to be
-- rescheduled since it calls the function by name.
create or replace function tick_phase_transitions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final_count int;
  v_abandoned_count int;
  v_public_count int;
begin
  -- Final-round reveal -> game_over. Host disconnected, timer elapsed,
  -- nobody drove the transition. No embedding work needed here.
  with advanced as (
    update rooms
      set phase = 'game_over',
          phase_ends_at = null
      where phase = 'reveal'
        and phase_ends_at is not null
        and phase_ends_at < now()
        and round_num >= max_rounds
      returning id
  )
  select count(*) into v_final_count from advanced;

  if v_final_count > 0 then
    raise notice 'tick_phase_transitions: advanced % reveal->game_over', v_final_count;
  end if;

  -- Abandonment: any room that has been sitting past its phase_ends_at for
  -- 2+ hours is gone. Delete cascades to room_players / rounds / etc.
  with nuked as (
    delete from rooms
      where phase_ends_at is not null
        and phase_ends_at < now() - interval '2 hours'
        and phase <> 'game_over'
      returning id
  )
  select count(*) into v_abandoned_count from nuked;

  if v_abandoned_count > 0 then
    raise notice 'tick_phase_transitions: deleted % abandoned rooms', v_abandoned_count;
  end if;

  -- Public-lobby graveyard sweep. A public lobby that's been open >5 min
  -- and never broke 2 players is a dead-end Quick Match slot: killing it
  -- keeps the matchmaker from dropping fresh joiners into a room the
  -- original creator already left.
  with public_nuked as (
    delete from rooms r
      where r.is_public = true
        and r.phase = 'lobby'
        and r.created_at < now() - interval '5 minutes'
        and (
          select count(*) from room_players rp where rp.room_id = r.id
        ) < 2
      returning id
  )
  select count(*) into v_public_count from public_nuked;

  if v_public_count > 0 then
    raise notice 'tick_phase_transitions: deleted % dead public lobbies', v_public_count;
  end if;
end;
$$;

revoke all on function tick_phase_transitions() from public;
