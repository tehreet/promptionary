-- Host controls: kick_player, transfer_host, and a friendlier leave_room
-- that re-homes the host role onto the next player (by join order) instead
-- of deleting the whole room when the host walks off.

create or replace function kick_player(p_room_id uuid, p_victim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select host_id into v_host from rooms where id = p_room_id;
  if v_host is null then raise exception 'room not found'; end if;
  if v_host <> auth.uid() then raise exception 'only host may kick'; end if;
  if p_victim_id = v_host then raise exception 'host cannot kick themselves - transfer first'; end if;

  delete from room_players
   where room_id = p_room_id and player_id = p_victim_id;
end;
$$;
revoke all on function kick_player(uuid, uuid) from public;
grant execute on function kick_player(uuid, uuid) to authenticated;

create or replace function transfer_host(p_room_id uuid, p_new_host_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_exists boolean;
  v_is_spectator boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select host_id into v_host from rooms where id = p_room_id;
  if v_host is null then raise exception 'room not found'; end if;
  if v_host <> auth.uid() then raise exception 'only host may transfer'; end if;

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

-- Replace leave_room so the host role migrates to the next-joined player
-- when the host leaves, instead of blowing the room away.
create or replace function leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_next_host uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then return; end if;

  delete from room_players
   where room_id = p_room_id and player_id = auth.uid();

  if v_room.host_id = auth.uid() then
    -- Pick the longest-present non-spectator player as the new host.
    select rp.player_id into v_next_host
      from room_players rp
     where rp.room_id = p_room_id
       and coalesce(rp.is_spectator, false) = false
     order by rp.joined_at asc
     limit 1;

    if v_next_host is null then
      delete from rooms where id = p_room_id;
    else
      update rooms set host_id = v_next_host where id = p_room_id;
      update room_players
         set is_host = (player_id = v_next_host)
       where room_id = p_room_id;
    end if;
  end if;
end;
$$;
