-- Lock manual host transfers during active gameplay (phase != 'lobby').
-- The leave_room RPC still auto-reassigns the host when the host disconnects,
-- ensuring the game can continue even if the host leaves mid-round.

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
  select host_id, phase into v_host, v_phase from rooms where id = p_room_id;
  if v_host is null then raise exception 'room not found'; end if;
  if v_host <> auth.uid() then raise exception 'only host may transfer'; end if;

  -- Prevent manual transfers during active gameplay. Only allow in lobby.
  if v_phase <> 'lobby' then
    raise exception 'host transfer is only allowed in the lobby phase';
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
