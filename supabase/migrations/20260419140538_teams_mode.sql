-- Teams mode: two-team gameplay with average-of-teammates scoring.
-- team=null means unassigned (only meaningful when room.mode='teams').

alter table room_players
  add column if not exists team smallint check (team in (1, 2));

create index if not exists room_players_team_idx
  on room_players (room_id, team)
  where team is not null;

-- set_room_mode: host toggles teams mode on/off in the lobby. When turning it
-- ON we seed an even split over current players (host = team 1). When turning
-- it OFF we clear all team assignments.
create or replace function set_room_mode(p_room_id uuid, p_mode room_mode)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_i int := 0;
  v_player record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can change mode'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;

  update rooms set mode = p_mode where id = p_room_id;

  if p_mode = 'teams' then
    -- Seed an alternating split by join order; host ends up on team 1.
    for v_player in (
      select player_id from room_players
      where room_id = p_room_id and coalesce(is_spectator, false) = false
      order by joined_at
    ) loop
      update room_players
        set team = (v_i % 2) + 1
        where room_id = p_room_id and player_id = v_player.player_id;
      v_i := v_i + 1;
    end loop;
  else
    update room_players set team = null where room_id = p_room_id;
  end if;
end;
$$;
revoke all on function set_room_mode(uuid, room_mode) from public;
grant execute on function set_room_mode(uuid, room_mode) to authenticated;

-- set_player_team: host assigns a specific player to a specific team.
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
  if p_team not in (1, 2) then raise exception 'team must be 1 or 2'; end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can assign teams'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;
  if v_room.mode <> 'teams' then raise exception 'room is not in teams mode'; end if;

  update room_players
    set team = p_team
    where room_id = p_room_id and player_id = p_player_id;
end;
$$;
revoke all on function set_player_team(uuid, uuid, smallint) from public;
grant execute on function set_player_team(uuid, uuid, smallint) to authenticated;

-- auto_balance_teams: shuffle non-spectator players and split evenly across
-- teams 1/2 so repeat presses produce a different assignment each time.
create or replace function auto_balance_teams(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_i int := 0;
  v_player record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can balance'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;
  if v_room.mode <> 'teams' then raise exception 'room is not in teams mode'; end if;

  for v_player in (
    select player_id from room_players
    where room_id = p_room_id and coalesce(is_spectator, false) = false
    order by random()
  ) loop
    update room_players
      set team = (v_i % 2) + 1
      where room_id = p_room_id and player_id = v_player.player_id;
    v_i := v_i + 1;
  end loop;
end;
$$;
revoke all on function auto_balance_teams(uuid) from public;
grant execute on function auto_balance_teams(uuid) to authenticated;
