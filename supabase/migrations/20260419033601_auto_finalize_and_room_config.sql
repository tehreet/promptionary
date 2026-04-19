-- 1) create_room accepts optional timing overrides so tests (and power users)
--    can run shorter rounds.
-- 2) Mark a room as "ready to score" when all non-spectator players have
--    submitted, so the client can trigger finalize immediately instead of
--    waiting for the full guess timer.

drop function if exists create_room(text, room_mode);

create or replace function create_room(
  p_display_name text,
  p_mode room_mode default 'party',
  p_max_rounds int default null,
  p_guess_seconds int default null,
  p_reveal_seconds int default null
)
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

  insert into rooms (
    code, host_id, mode,
    max_rounds,
    guess_seconds,
    reveal_seconds
  )
  values (
    v_code, auth.uid(), p_mode,
    coalesce(p_max_rounds, 5),
    coalesce(p_guess_seconds, 45),
    coalesce(p_reveal_seconds, 20)
  )
  returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;
revoke all on function create_room(text, room_mode, int, int, int) from public;
grant execute on function create_room(text, room_mode, int, int, int) to authenticated;

-- everyone_guessed: returns true when every active (non-spectator) player in
-- the current round has a guess submitted. Safe for any room member.
create or replace function everyone_guessed(p_round_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_room_id uuid;
  v_expected int;
  v_actual int;
begin
  select room_id into v_room_id from rounds where id = p_round_id;
  if v_room_id is null then return false; end if;
  if not is_room_member(v_room_id) then return false; end if;

  select count(*) into v_expected
    from room_players
    where room_id = v_room_id and not is_spectator;

  select count(*) into v_actual
    from guesses where round_id = p_round_id;

  return v_expected > 0 and v_actual >= v_expected;
end;
$$;
revoke all on function everyone_guessed(uuid) from public;
grant execute on function everyone_guessed(uuid) to authenticated;
