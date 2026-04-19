-- Tier-1 easy wins bundle:
--   1. Phase-guard transfer_host so it only runs in lobby / game_over.
--   2. Auto-assign team on late join when teams_enabled is true.
--   3. Bump guess_seconds to >= 90 when teams mode is enabled.

-- 1. Phase-guard transfer_host. Host transfer mid-game has no legit use and
--    opens a small grief surface; lock it to lobby / game_over.
create or replace function transfer_host(p_room_id uuid, p_new_host_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_phase text;
  v_exists boolean;
  v_is_spectator boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select host_id, phase::text into v_host, v_phase from rooms where id = p_room_id;
  if v_host is null then raise exception 'room not found'; end if;
  if v_host <> auth.uid() then raise exception 'only host may transfer'; end if;
  if v_phase not in ('lobby', 'game_over') then
    raise exception 'host can only be transferred in lobby or after game over';
  end if;

  select true, rp.is_spectator
    into v_exists, v_is_spectator
    from room_players rp
   where rp.room_id = p_room_id and rp.player_id = p_new_host_id;
  if not v_exists then raise exception 'new host is not in the room'; end if;
  if coalesce(v_is_spectator, false) then
    raise exception 'cannot make a spectator the host';
  end if;

  update rooms set host_id = p_new_host_id where id = p_room_id;
  update room_players
     set is_host = (player_id = p_new_host_id)
   where room_id = p_room_id;
end;
$$;
revoke all on function transfer_host(uuid, uuid) from public;
grant execute on function transfer_host(uuid, uuid) to authenticated;

-- 2. Auto-assign a team to late joiners. Before today, players who joined
--    after the host enabled teams mode landed with team=null and stayed that
--    way until the host manually re-balanced.
create or replace function auto_assign_team_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teams_enabled boolean;
  v_count_team_1 int;
  v_count_team_2 int;
  v_target smallint;
begin
  if coalesce(new.is_spectator, false) then return new; end if;
  if new.team is not null then return new; end if;

  select teams_enabled into v_teams_enabled from rooms where id = new.room_id;
  if not coalesce(v_teams_enabled, false) then return new; end if;

  select
    count(*) filter (where team = 1),
    count(*) filter (where team = 2)
    into v_count_team_1, v_count_team_2
    from room_players
   where room_id = new.room_id
     and coalesce(is_spectator, false) = false
     and player_id <> new.player_id;

  -- Smaller team wins; tie goes to team 1.
  if v_count_team_2 < v_count_team_1 then
    v_target := 2;
  else
    v_target := 1;
  end if;

  update room_players
     set team = v_target
   where room_id = new.room_id and player_id = new.player_id;

  return new;
end;
$$;

drop trigger if exists auto_assign_team_on_join on room_players;
create trigger auto_assign_team_on_join
  after insert on room_players
  for each row
  execute function auto_assign_team_on_join();

-- 3. Teams need more coordination time: when teams mode is turned on, bump
--    guess_seconds to at least 90s. Leaves longer timers alone.
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
    update rooms
      set guess_seconds = greatest(guess_seconds, 90)
      where id = p_room_id;

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
