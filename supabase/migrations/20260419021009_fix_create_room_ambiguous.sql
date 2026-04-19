-- The previous create_room declared `returns table (room_id uuid, code text)`
-- which made `code` an OUT parameter that shadowed rooms.code inside the body,
-- producing "column reference 'code' is ambiguous" (42702) on INSERT.
-- Rename return columns to remove the shadow.

drop function if exists create_room(text, room_mode);

create or replace function create_room(p_display_name text, p_mode room_mode default 'party')
returns table (new_room_id uuid, new_code text)
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
