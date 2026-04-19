-- Randomize artist selection: pick the non-spectator who's been artist the
-- fewest times so far this game (fair rotation), random tiebreak (so the
-- order isn't predictable), and avoid back-to-back turns unless there's
-- only one eligible player.

create or replace function start_round(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_round_id uuid;
  v_artist uuid;
  v_last_artist uuid;
  v_eligible_count int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if v_room.phase not in ('lobby', 'reveal') then
    raise exception 'cannot start round from phase %', v_room.phase;
  end if;

  if v_room.mode = 'artist' then
    select artist_player_id into v_last_artist
      from rounds
      where room_id = p_room_id
      order by round_num desc
      limit 1;

    select count(*) into v_eligible_count
      from room_players
      where room_id = p_room_id and not is_spectator;

    if v_eligible_count = 0 then
      raise exception 'no eligible artist (need at least one non-spectator player)';
    end if;

    -- Fair rotation: pick whoever has been artist the fewest times so far;
    -- random tiebreak; avoid back-to-back if possible.
    with artist_counts as (
      select rp.player_id,
             coalesce(c.n, 0)::int as turns
        from room_players rp
        left join (
          select artist_player_id, count(*) as n
            from rounds
            where room_id = p_room_id and artist_player_id is not null
            group by artist_player_id
        ) c on c.artist_player_id = rp.player_id
       where rp.room_id = p_room_id and not rp.is_spectator
    ),
    min_turns as (
      select min(turns) as m from artist_counts
    )
    select ac.player_id into v_artist
      from artist_counts ac, min_turns mt
      where ac.turns = mt.m
        and (
          v_last_artist is null
          or ac.player_id <> v_last_artist
          or v_eligible_count = 1
        )
      order by random()
      limit 1;

    if v_artist is null then
      -- Fallback: everyone at min count is the last artist; allow back-to-back.
      select player_id into v_artist
        from room_players
        where room_id = p_room_id and not is_spectator
        order by random()
        limit 1;
    end if;

    update rooms
      set phase = 'prompting',
          round_num = round_num + 1,
          phase_ends_at = now() + interval '60 seconds'
      where id = p_room_id;

    insert into rounds (room_id, round_num, prompt, artist_player_id)
      values (p_room_id, v_room.round_num + 1, '', v_artist)
      returning id into v_round_id;
  else
    update rooms
      set phase = 'generating',
          round_num = round_num + 1,
          phase_ends_at = null
      where id = p_room_id;

    insert into rounds (room_id, round_num, prompt)
      values (p_room_id, v_room.round_num + 1, '')
      returning id into v_round_id;
  end if;

  return v_round_id;
end;
$$;
