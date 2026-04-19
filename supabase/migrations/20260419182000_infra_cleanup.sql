-- Infra cleanup: two unrelated-but-both-small chores rolled into one file.
--
--   1. pg_cron safety-net tick for phase transitions (task #37)
--      - A backstop for the host-driven phase-advance flow. When the host's
--        tab disconnects mid-round, final reveal -> game_over never fires.
--        This cron covers that one case. guessing/scoring advancement still
--        needs a client because finalize calls Gemini embeddings.
--
--   2. Drop legacy 'teams' / 'headsup' enum slots from room_mode (task #41).
--      The `teams_enabled` boolean on `rooms` has fully decoupled teams play
--      from the mode enum. No live rows carry these values anymore
--      (verified pre-migration). Postgres cannot DROP VALUE FROM an enum, so
--      we build a new enum `room_mode_v2`, swap the column over, drop the old
--      enum, and rename v2 -> room_mode.

-- =========================================================================
-- 1. pg_cron backstop
-- =========================================================================

create extension if not exists pg_cron with schema extensions;

-- Reset any prior schedule with the same name so re-running the migration
-- stays idempotent. cron.unschedule is fine on a missing job (throws; we
-- swallow it in a DO block).
do $$
begin
  perform cron.unschedule('tick-phase-transitions');
exception when others then
  null;
end
$$;

-- Why this is so conservative:
--   - `guessing -> scoring` needs Gemini embeddings, which pg_cron can't
--     call. If the host disconnects during guessing we'd rather let the
--     next client to reconnect drive the finalize than risk the cron
--     leaving rooms in a half-scored state.
--   - `scoring -> reveal` is also driven by the finalize RPC; same story.
--   - `reveal -> game_over` on the final round is pure SQL: just flip
--     `phase` to `game_over`. Safe to handle here.
--   - We also clean up ancient rooms (>2h idle) to keep the table tidy.
create or replace function tick_phase_transitions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final_count int;
  v_abandoned_count int;
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
end;
$$;

revoke all on function tick_phase_transitions() from public;

-- Schedule every 30 seconds. '*/30 * * * * *' is the 6-field pg_cron
-- extension that includes seconds.
select cron.schedule(
  'tick-phase-transitions',
  '30 seconds',
  'select public.tick_phase_transitions()'
);

-- =========================================================================
-- 2. Drop 'teams' and 'headsup' from room_mode
-- =========================================================================

-- 2a. Belt-and-suspenders backfill (no-op in practice; the column should
-- already be clean).
update rooms set mode = 'party'  where mode = 'teams';
update rooms set mode = 'party'  where mode = 'headsup';

-- 2b. Drop references that embed the legacy slot as a literal. We rebuild
-- them against `teams_enabled` (the flag that actually drives team play
-- now) before swapping the enum type underneath.

-- room_messages_insert: was `r.mode = 'teams'`. Now `r.teams_enabled`.
drop policy if exists room_messages_insert on room_messages;
create policy room_messages_insert on room_messages for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id and rp.player_id = auth.uid()
    )
    and (
      exists (
        select 1 from room_players rp
        where rp.room_id = room_messages.room_id
          and rp.player_id = auth.uid()
          and rp.is_spectator
      )
      or (
        team is null
        and exists (
          select 1 from rooms r
          where r.id = room_messages.room_id
            and r.phase in ('lobby', 'reveal', 'game_over')
        )
      )
      or (
        team is not null
        and exists (
          select 1 from rooms r
          where r.id = room_messages.room_id
            and r.teams_enabled
        )
        and exists (
          select 1 from room_players rp
          where rp.room_id = room_messages.room_id
            and rp.player_id = auth.uid()
            and rp.team = room_messages.team
        )
      )
    )
  );

-- post_message: same substitution. Body is otherwise identical.
create or replace function post_message(
  p_room_id uuid,
  p_content text,
  p_team smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member room_players;
  v_room rooms;
  v_msg_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_content) < 1 or char_length(p_content) > 400 then
    raise exception 'message length invalid';
  end if;
  if p_team is not null and p_team not in (1, 2) then
    raise exception 'team must be null, 1, or 2';
  end if;

  select * into v_member from room_players
    where room_id = p_room_id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;

  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;

  if p_team is null then
    if not v_member.is_spectator
      and v_room.phase not in ('lobby', 'reveal', 'game_over') then
      raise exception 'chat locked during active round';
    end if;
  else
    if not v_room.teams_enabled then
      raise exception 'team chat only available when teams are enabled';
    end if;
    if not v_member.is_spectator and v_member.team is distinct from p_team then
      raise exception 'you are not on that team';
    end if;
  end if;

  insert into room_messages (room_id, player_id, display_name, content, team)
    values (p_room_id, auth.uid(), v_member.display_name, p_content, p_team)
    returning id into v_msg_id;

  return v_msg_id;
end;
$$;

revoke all on function post_message(uuid, text, smallint) from public;
grant execute on function post_message(uuid, text, smallint) to authenticated;

-- 2c. Functions that name `room_mode` in their signatures have to go before
-- we can swap the type. We recreate them against the new type further down.
drop function if exists create_room(text, room_mode, integer, integer, integer, room_pack);
drop function if exists update_room_settings(uuid, room_mode, room_pack, integer, integer, integer);

-- 2d. New enum and column swap.
create type room_mode_v2 as enum ('party', 'artist');

alter table rooms
  alter column mode drop default,
  alter column mode type room_mode_v2 using (
    case mode::text
      when 'teams'   then 'party'::room_mode_v2
      when 'headsup' then 'party'::room_mode_v2
      else mode::text::room_mode_v2
    end
  ),
  alter column mode set default 'party'::room_mode_v2;

drop type room_mode;
alter type room_mode_v2 rename to room_mode;

-- 2e. Recreate create_room with the freshened type.
create or replace function create_room(
  p_display_name text,
  p_mode room_mode default 'party'::room_mode,
  p_max_rounds integer default null,
  p_guess_seconds integer default null,
  p_reveal_seconds integer default null,
  p_pack room_pack default 'mixed'::room_pack
)
returns table(new_room_id uuid, new_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  v_code := generate_room_code();

  insert into rooms (
    code, host_id, mode, pack,
    max_rounds, guess_seconds, reveal_seconds
  )
  values (
    v_code, auth.uid(), p_mode, p_pack,
    coalesce(p_max_rounds, 5),
    coalesce(p_guess_seconds, 45),
    coalesce(p_reveal_seconds, 20)
  )
  returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;

revoke all on function create_room(text, room_mode, integer, integer, integer, room_pack) from public;
grant execute on function create_room(text, room_mode, integer, integer, integer, room_pack) to authenticated;

-- 2f. And rebuild update_room_settings against the freshened type.
create or replace function update_room_settings(
  p_room_id uuid,
  p_mode room_mode default null,
  p_pack room_pack default null,
  p_max_rounds integer default null,
  p_guess_seconds integer default null,
  p_reveal_seconds integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'only host can change settings';
  end if;
  if v_room.phase <> 'lobby' then
    raise exception 'room already started';
  end if;

  if p_mode is not null then
    update rooms set mode = p_mode where id = p_room_id;
  end if;
  if p_pack is not null then
    update rooms set pack = p_pack where id = p_room_id;
  end if;
  if p_max_rounds is not null then
    if p_max_rounds < 1 or p_max_rounds > 20 then
      raise exception 'max_rounds must be between 1 and 20';
    end if;
    update rooms set max_rounds = p_max_rounds where id = p_room_id;
  end if;
  if p_guess_seconds is not null then
    if p_guess_seconds < 15 or p_guess_seconds > 120 then
      raise exception 'guess_seconds must be between 15 and 120';
    end if;
    update rooms set guess_seconds = p_guess_seconds where id = p_room_id;
  end if;
  if p_reveal_seconds is not null then
    if p_reveal_seconds < 5 or p_reveal_seconds > 30 then
      raise exception 'reveal_seconds must be between 5 and 30';
    end if;
    update rooms set reveal_seconds = p_reveal_seconds where id = p_room_id;
  end if;
end;
$$;

revoke all on function update_room_settings(uuid, room_mode, room_pack, integer, integer, integer) from public;
grant execute on function update_room_settings(uuid, room_mode, room_pack, integer, integer, integer) to authenticated;
