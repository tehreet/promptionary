-- update_room_settings: host-only RPC to tweak mode / pack / timing from the
-- lobby settings panel. Home-page Create Room is now one-click — all config
-- moves here. Guarded to host + lobby phase.

create or replace function update_room_settings(
  p_room_id uuid,
  p_mode room_mode default null,
  p_pack room_pack default null,
  p_max_rounds int default null,
  p_guess_seconds int default null,
  p_reveal_seconds int default null
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
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'only host can change settings';
  end if;
  if v_room.phase <> 'lobby' then
    raise exception 'room already started';
  end if;

  if p_mode is not null then
    update rooms set mode = p_mode where id = p_room_id;
  end if;
  if p_pack is not null then
    update rooms set pack = p_pack where id = p_room_id;
  end if;
  if p_max_rounds is not null then
    if p_max_rounds < 1 or p_max_rounds > 20 then
      raise exception 'max_rounds must be between 1 and 20';
    end if;
    update rooms set max_rounds = p_max_rounds where id = p_room_id;
  end if;
  if p_guess_seconds is not null then
    if p_guess_seconds < 15 or p_guess_seconds > 120 then
      raise exception 'guess_seconds must be between 15 and 120';
    end if;
    update rooms set guess_seconds = p_guess_seconds where id = p_room_id;
  end if;
  if p_reveal_seconds is not null then
    if p_reveal_seconds < 5 or p_reveal_seconds > 30 then
      raise exception 'reveal_seconds must be between 5 and 30';
    end if;
    update rooms set reveal_seconds = p_reveal_seconds where id = p_room_id;
  end if;
end;
$$;
revoke all on function update_room_settings(uuid, room_mode, room_pack, int, int, int) from public;
grant execute on function update_room_settings(uuid, room_mode, room_pack, int, int, int) to authenticated;
