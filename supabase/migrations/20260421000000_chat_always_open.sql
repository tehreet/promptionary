-- Open chat through every phase. Users reported room chat randomly locking
-- up between rounds — the phase-blackout was firing inconsistently because
-- the client's `roomPhase` trailed the DB by up to 2s of poll jitter. Simpler
-- + less error-prone to just let anyone in a room send messages any time.
--
-- Summary of changes:
--   * post_message: drop the `raise exception 'chat locked during active
--     round'` branch. Any room member can post any phase. Spectator/team
--     validation unchanged.
--   * room_messages_insert: flatten branch (c) so room-wide inserts are
--     allowed any phase (was gated on lobby/reveal/game_over only).

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

  if p_team is not null then
    -- Team-scoped chat: teammates only, spectators excluded. Phase-agnostic.
    if not coalesce(v_room.teams_enabled, false) then
      raise exception 'team chat only available when teams are enabled';
    end if;
    if coalesce(v_member.is_spectator, false) then
      raise exception 'spectators cannot post to team chat';
    end if;
    if v_member.team is distinct from p_team then
      raise exception 'you are not on that team';
    end if;
  end if;
  -- Room-wide chat (p_team is null): open to every room member at any phase.

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
-- Structure: (player_id matches caller) AND (is a room member) AND one of:
--   a. team-scoped insert by a non-spectator teammate on that team
--   b. room-wide insert by any room member — any phase

drop policy if exists room_messages_insert on room_messages;
create policy room_messages_insert on room_messages for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id and rp.player_id = auth.uid()
    )
    and (
      -- (a) team-scoped send by a teammate on that team.
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
      -- (b) room-wide send by any room member — any phase.
      or (team is null)
    )
  );
