-- Spectators: allow joining mid-game as a read-only observer, and bump the
-- reveal window so players can actually read the results before the next
-- round starts.

alter table room_players
  add column if not exists is_spectator boolean not null default false;

-- Default reveal duration up from 10s to 20s. Existing rooms keep their value.
alter table rooms alter column reveal_seconds set default 20;

-- join_room_by_code: now accepts p_as_spectator. Spectators can join at any
-- phase; players can only join in lobby.
drop function if exists join_room_by_code(text, text);

create or replace function join_room_by_code(
  p_code text,
  p_display_name text,
  p_as_spectator boolean default false
)
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

  if not p_as_spectator and v_room.phase <> 'lobby' then
    raise exception 'room already started';
  end if;

  insert into room_players (room_id, player_id, display_name, is_spectator)
    values (v_room.id, auth.uid(), p_display_name, p_as_spectator)
    on conflict (room_id, player_id)
    do update set display_name = excluded.display_name,
                  is_spectator = room_players.is_spectator or excluded.is_spectator;

  return v_room.id;
end;
$$;
revoke all on function join_room_by_code(text, text, boolean) from public;
grant execute on function join_room_by_code(text, text, boolean) to authenticated;

-- submit_guess: deny spectators at the database layer.
create or replace function submit_guess(p_round_id uuid, p_guess text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_guess_id uuid;
  v_player room_players;
begin
  if char_length(p_guess) < 1 or char_length(p_guess) > 200 then
    raise exception 'guess length invalid';
  end if;

  select rm.* into v_room
  from rounds r join rooms rm on rm.id = r.room_id
  where r.id = p_round_id;
  if not found then raise exception 'round not found'; end if;

  if v_room.phase <> 'guessing' or v_room.phase_ends_at <= now() then
    raise exception 'guessing closed';
  end if;

  select * into v_player from room_players
    where room_id = v_room.id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;
  if v_player.is_spectator then raise exception 'spectators cannot guess'; end if;

  insert into guesses (round_id, player_id, guess)
    values (p_round_id, auth.uid(), p_guess)
    on conflict (round_id, player_id) do nothing
    returning id into v_guess_id;

  if v_guess_id is null then
    raise exception 'already guessed this round';
  end if;

  return v_guess_id;
end;
$$;
revoke all on function submit_guess(uuid, text) from public;
grant execute on function submit_guess(uuid, text) to authenticated;
