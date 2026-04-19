-- Team chat: teammates can chat privately during teams-mode rounds.
-- Existing room-wide chat (team IS NULL) continues to function for lobby /
-- reveal / game_over banter and for non-teams rooms.
--
-- Teams are controlled by rooms.teams_enabled (boolean, orthogonal to
-- rooms.mode) — see 20260419145319_teams_decoupled.sql.
--
-- Design:
--   * `team` column on room_messages: NULL = room-wide, 1 | 2 = team-scoped.
--   * SELECT policies: keep the room-wide rule for team IS NULL rows; add a
--     second permissive rule so team-scoped rows are only visible to players
--     on that team. Spectators do NOT see team chat — team channels are a
--     private coordination surface for competing teams.
--   * INSERT policy: a team-scoped insert must come from a player on that
--     team, and the room must have teams_enabled = true.
--   * post_message RPC gains a `p_team` argument (defaults to null). Existing
--     room-wide callers are unaffected.

alter table room_messages
  add column if not exists team smallint check (team in (1, 2));

-- Team-scoped fetches (filter by room_id + team, order by created_at).
-- The existing (room_id, created_at) index already covers room-wide reads.
create index if not exists room_messages_team_idx
  on room_messages (room_id, team, created_at);

-- Replace the single "is_room_member" SELECT policy with two permissive
-- policies. Multiple permissive policies are OR'd together, so this widens
-- reads rather than narrowing them for room-wide messages.
drop policy if exists room_messages_select on room_messages;

create policy room_messages_select_room_wide on room_messages
  for select to authenticated
  using (team is null and is_room_member(room_id));

-- Team-scoped visibility: only non-spectator players on the same team see it.
-- Spectators are deliberately excluded from team chat for privacy.
create policy room_messages_select_team on room_messages
  for select to authenticated
  using (
    team is not null
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id
        and rp.player_id = auth.uid()
        and coalesce(rp.is_spectator, false) = false
        and rp.team = room_messages.team
    )
  );

-- Tighten INSERT: team-scoped inserts must match the sender's team, and the
-- room must have teams_enabled = true. Room-wide inserts keep their existing
-- phase blackout. Spectators can post room-wide any time but cannot post
-- team-scoped (they don't belong to a team).
drop policy if exists room_messages_insert on room_messages;
create policy room_messages_insert on room_messages for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id and rp.player_id = auth.uid()
    )
    and (
      (
        team is null
        and (
          exists (
            select 1 from room_players rp
            where rp.room_id = room_messages.room_id
              and rp.player_id = auth.uid()
              and rp.is_spectator
          )
          or exists (
            select 1 from rooms r
            where r.id = room_messages.room_id
              and r.phase in ('lobby', 'reveal', 'game_over')
          )
        )
      )
      or (
        team is not null
        and exists (
          select 1 from rooms r
          where r.id = room_messages.room_id
            and r.teams_enabled = true
        )
        and exists (
          select 1 from room_players rp
          where rp.room_id = room_messages.room_id
            and rp.player_id = auth.uid()
            and coalesce(rp.is_spectator, false) = false
            and rp.team = room_messages.team
        )
      )
    )
  );

-- Replace post_message. The old two-argument call sites still work because
-- p_team defaults to null; team-chat callers pass it explicitly.
drop function if exists post_message(uuid, text);

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
    -- Room-wide: existing phase blackout applies to non-spectators.
    if not v_member.is_spectator
      and v_room.phase not in ('lobby', 'reveal', 'game_over') then
      raise exception 'chat locked during active round';
    end if;
  else
    -- Team-scoped: requires teams_enabled + caller on that team. Spectators
    -- are not on a team and cannot post to team chat.
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

  insert into room_messages (room_id, player_id, display_name, content, team)
    values (p_room_id, auth.uid(), v_member.display_name, p_content, p_team)
    returning id into v_msg_id;

  return v_msg_id;
end;
$$;

revoke all on function post_message(uuid, text, smallint) from public;
grant execute on function post_message(uuid, text, smallint) to authenticated;
