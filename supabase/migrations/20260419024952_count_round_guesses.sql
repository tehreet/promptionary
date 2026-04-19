-- Players can only SELECT their own guess rows during the 'guessing' phase,
-- so a plain count query shows 1 at most. Expose a bypass-RLS count via
-- SECURITY DEFINER, gated to members of the room.
create or replace function count_round_guesses(p_round_id uuid)
returns int
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_room_id uuid;
  v_count int;
begin
  select room_id into v_room_id from rounds where id = p_round_id;
  if v_room_id is null then return 0; end if;
  if not is_room_member(v_room_id) then
    raise exception 'not a room member';
  end if;
  select count(*)::int into v_count from guesses where round_id = p_round_id;
  return v_count;
end;
$$;
revoke all on function count_round_guesses(uuid) from public;
grant execute on function count_round_guesses(uuid) to authenticated;
