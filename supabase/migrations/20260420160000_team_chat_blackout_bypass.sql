-- Team chat blackout bypass (#57).
--
-- Symptom: users intermittently saw "not allowed" / "chat locked" errors when
-- sending team-scoped chat during `generating` / `guessing` / `scoring`.
--
-- The existing post_message RPC (see 20260419182000_infra_cleanup.sql) already
-- branches on `p_team`, but the phase-blackout check isn't fully explicit —
-- and the INSERT policy's spectator escape-hatch comes *before* the team
-- validation, so a spectator could slip a team-scoped insert through while
-- their sender-side SELECT readback then fails (causing the client to hang
-- until the post rpc response finally lands with a row they can't see). This
-- migration tightens both paths so team chat is open through every phase for
-- teammates on the right team, and completely closed for spectators.
--
-- Summary of changes:
--   * post_message: explicit "team-scoped writes skip the phase-blackout"
--     comment + reject spectator team sends unconditionally (they shouldn't
--     post to team chat at all). Room-wide blackout semantics unchanged.
--   * room_messages_insert policy: split spectator escape-hatch so it only
--     applies to room-wide (team IS NULL) writes. A team-scoped insert now
--     always goes through the team-member branch, never the spectator branch.

-- =========================================================================
-- 1. post_message RPC
-- =========================================================================

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
    -- Room-wide chat: phase blackout applies to non-spectators. This is the
    -- intentional "no coordinating mid-round" guard and is NOT changing here.
    if not coalesce(v_member.is_spectator, false)
      and v_room.phase not in ('lobby', 'reveal', 'game_over') then
      raise exception 'chat locked during active round';
    end if;
  else
    -- Team-scoped chat: open through every phase for teammates. This is the
    -- whole point of team chat — coordinate with your team during the round.
    -- No phase-blackout check is performed here.
    if not coalesce(v_room.teams_enabled, false) then
      raise exception 'team chat only available when teams are enabled';
    end if;
    if coalesce(v_member.is_spectator, false) then
      -- Spectators aren't on a team and cannot use team chat. Reject cleanly
      -- rather than letting the INSERT slip through a stale policy branch.
      raise exception 'spectators cannot post to team chat';
    end if;
    if v_member.team is distinct from p_team then
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

-- =========================================================================
-- 2. room_messages INSERT policy
-- =========================================================================
--
-- Structure: (player_id matches caller) AND (is a room member)
--            AND one of:
--              a. team-scoped insert by a non-spectator teammate on that team
--                 (allowed regardless of phase — team chat is open)
--              b. room-wide spectator insert (open any phase)
--              c. room-wide non-spectator insert during lobby/reveal/game_over
--                 (keeps the existing blackout)

drop policy if exists room_messages_insert on room_messages;
create policy room_messages_insert on room_messages for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id and rp.player_id = auth.uid()
    )
    and (
      -- (a) team-scoped send by a teammate on that team — any phase.
      (
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
            and coalesce(rp.is_spectator, false) = false
            and rp.team = room_messages.team
        )
      )
      -- (b) room-wide send by a spectator — any phase.
      or (
        team is null
        and exists (
          select 1 from room_players rp
          where rp.room_id = room_messages.room_id
            and rp.player_id = auth.uid()
            and rp.is_spectator
        )
      )
      -- (c) room-wide send during lobby / reveal / game_over.
      or (
        team is null
        and exists (
          select 1 from rooms r
          where r.id = room_messages.room_id
            and r.phase in ('lobby', 'reveal', 'game_over')
        )
      )
    )
  );
