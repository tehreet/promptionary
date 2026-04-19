-- Drag-and-drop team assignment: host can move any room_players row between
-- Team 1 / Team 2 / Spectators / Unassigned in the lobby.
--
-- Three paths are needed on top of the existing `set_player_team(room, player, team)`:
--   * clear a player's team (unassign) without flipping spectator status
--   * flip a player between spectator and active seat
--   * allow set_player_team to accept null (treated as unassign)

-- set_player_team: allow p_team = null to clear the assignment.
create or replace function set_player_team(p_room_id uuid, p_player_id uuid, p_team smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_team is not null and p_team not in (1, 2) then
    raise exception 'team must be 1, 2, or null';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can assign teams'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;
  if not v_room.teams_enabled then raise exception 'teams mode is not enabled'; end if;

  update room_players
    set team = p_team
    where room_id = p_room_id and player_id = p_player_id;
end;
$$;
revoke all on function set_player_team(uuid, uuid, smallint) from public;
grant execute on function set_player_team(uuid, uuid, smallint) to authenticated;

-- set_player_spectator: host flips a player between spectator and active.
-- When promoting to spectator we also clear any team assignment so the UI
-- doesn't show a ghost chip in Team 1/2 after the drop.
create or replace function set_player_spectator(
  p_room_id uuid,
  p_player_id uuid,
  p_is_spectator boolean
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
  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can change spectator'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;

  -- Host cannot demote themselves to spectator (would strand the room without
  -- a host who can start the round).
  if p_player_id = v_room.host_id and p_is_spectator then
    raise exception 'host cannot become spectator';
  end if;

  if p_is_spectator then
    update room_players
      set is_spectator = true, team = null
      where room_id = p_room_id and player_id = p_player_id;
  else
    update room_players
      set is_spectator = false
      where room_id = p_room_id and player_id = p_player_id;
  end if;
end;
$$;
revoke all on function set_player_spectator(uuid, uuid, boolean) from public;
grant execute on function set_player_spectator(uuid, uuid, boolean) to authenticated;
