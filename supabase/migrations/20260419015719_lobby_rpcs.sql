-- create_room: host creates a new room with auto-gen code, seeds host as first player
create or replace function create_room(p_display_name text, p_mode room_mode default 'party')
returns table (room_id uuid, code text)
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

  insert into rooms (code, host_id, mode)
    values (v_code, auth.uid(), p_mode)
    returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;
revoke all on function create_room(text, room_mode) from public;
grant execute on function create_room(text, room_mode) to authenticated;

-- join_room_by_code: player joins a lobby-phase room by 4-letter code
create or replace function join_room_by_code(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  select * into v_room from rooms where code = upper(p_code);
  if not found then raise exception 'room not found'; end if;
  if v_room.phase <> 'lobby' then raise exception 'room already started'; end if;

  insert into room_players (room_id, player_id, display_name)
    values (v_room.id, auth.uid(), p_display_name)
    on conflict (room_id, player_id) do update set display_name = excluded.display_name;

  return v_room.id;
end;
$$;
revoke all on function join_room_by_code(text, text) from public;
grant execute on function join_room_by_code(text, text) to authenticated;

-- leave_room: non-host removes self; host removal cascades-deletes the room.
create or replace function leave_room(p_room_id uuid)
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
  if not found then return; end if;

  if v_room.host_id = auth.uid() then
    delete from rooms where id = p_room_id;
  else
    delete from room_players where room_id = p_room_id and player_id = auth.uid();
  end if;
end;
$$;
revoke all on function leave_room(uuid) from public;
grant execute on function leave_room(uuid) to authenticated;
