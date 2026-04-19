-- Play Again: host resets the room back to lobby with the same membership.
-- Clears all rounds/guesses (cascade), zeroes scores. Optionally updates
-- max_rounds / guess_seconds / reveal_seconds if the caller passes them.
create or replace function play_again(
  p_room_id uuid,
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
  if v_room.host_id <> auth.uid() then raise exception 'only host can reset'; end if;
  if v_room.phase <> 'game_over' then
    raise exception 'room is not in game_over';
  end if;

  delete from rounds where room_id = p_room_id;

  update room_players set score = 0 where room_id = p_room_id;

  update rooms set
    phase = 'lobby',
    round_num = 0,
    phase_ends_at = null,
    max_rounds = coalesce(p_max_rounds, max_rounds),
    guess_seconds = coalesce(p_guess_seconds, guess_seconds),
    reveal_seconds = coalesce(p_reveal_seconds, reveal_seconds)
    where id = p_room_id;
end;
$$;
revoke all on function play_again(uuid, int, int, int) from public;
grant execute on function play_again(uuid, int, int, int) to authenticated;
