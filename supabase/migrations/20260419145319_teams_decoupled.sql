-- Decouple teams from the mode enum so artist + teams can coexist.
-- rooms.teams_enabled is orthogonal to rooms.mode: artist mode stays the
-- "one player paints per round" engine, teams_enabled just layers team
-- scoring on top (team score = avg of teammates' individual totals).

alter table rooms
  add column if not exists teams_enabled boolean not null default false;

-- Backfill: any existing rooms still in the (now deprecated) mode='teams'
-- slot get migrated to party + teams_enabled=true. mode='teams' still works
-- as an enum value because of historical rows, but new code never sets it.
update rooms
  set teams_enabled = true, mode = 'party'
  where mode = 'teams';

-- Replace set_room_mode with set_teams_enabled: toggles the flag and seeds /
-- clears team assignments. Works regardless of room.mode (party or artist).
drop function if exists set_room_mode(uuid, room_mode);

create or replace function set_teams_enabled(p_room_id uuid, p_enabled boolean)
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

  update rooms set teams_enabled = p_enabled where id = p_room_id;

  if p_enabled then
    for v_player in
      select player_id from room_players
      where room_id = p_room_id and coalesce(is_spectator, false) = false
      order by joined_at
    loop
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
revoke all on function set_teams_enabled(uuid, boolean) from public;
grant execute on function set_teams_enabled(uuid, boolean) to authenticated;

-- set_player_team: relax the guard so it checks teams_enabled, not mode.
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
  if not v_room.teams_enabled then raise exception 'teams mode is not enabled'; end if;

  update room_players
    set team = p_team
    where room_id = p_room_id and player_id = p_player_id;
end;
$$;
revoke all on function set_player_team(uuid, uuid, smallint) from public;
grant execute on function set_player_team(uuid, uuid, smallint) to authenticated;

-- auto_balance_teams: same guard update.
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
  if not v_room.teams_enabled then raise exception 'teams mode is not enabled'; end if;

  for v_player in
    select player_id from room_players
    where room_id = p_room_id and coalesce(is_spectator, false) = false
    order by random()
  loop
    update room_players
      set team = (v_i % 2) + 1
      where room_id = p_room_id and player_id = v_player.player_id;
    v_i := v_i + 1;
  end loop;
end;
$$;
revoke all on function auto_balance_teams(uuid) from public;
grant execute on function auto_balance_teams(uuid) to authenticated;
