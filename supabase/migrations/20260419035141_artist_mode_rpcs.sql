-- start_round: on artist mode, pick the next artist in join order (rotating
-- through non-spectator players) and land on 'prompting' phase, skipping
-- Gemini authorship. On all other modes, behavior is unchanged.
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
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if v_room.phase not in ('lobby', 'reveal') then
    raise exception 'cannot start round from phase %', v_room.phase;
  end if;

  if v_room.mode = 'artist' then
    -- last artist (by round_num desc) drives rotation; pick whoever joined
    -- after them in lobby order.
    select artist_player_id into v_last_artist
      from rounds
      where room_id = p_room_id
      order by round_num desc
      limit 1;

    if v_last_artist is null then
      select player_id into v_artist
        from room_players
        where room_id = p_room_id and not is_spectator
        order by joined_at asc
        limit 1;
    else
      select player_id into v_artist
        from room_players
        where room_id = p_room_id
          and not is_spectator
          and joined_at > (
            select joined_at from room_players
              where room_id = p_room_id and player_id = v_last_artist
          )
        order by joined_at asc
        limit 1;
      if v_artist is null then
        -- wrap to the first competitor
        select player_id into v_artist
          from room_players
          where room_id = p_room_id and not is_spectator
          order by joined_at asc
          limit 1;
      end if;
    end if;

    if v_artist is null then
      raise exception 'no eligible artist (need at least one non-spectator player)';
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
revoke all on function start_round(uuid) from public;
grant execute on function start_round(uuid) to authenticated;

-- submit_artist_prompt: the round's assigned artist writes the secret prompt
-- and hands it off to the image-generation pipeline. Advances the room to
-- the 'generating' phase so the existing /api/start-round flow picks it up
-- (but with the prompt already set and Gemini text-authoring skipped).
create or replace function submit_artist_prompt(p_round_id uuid, p_prompt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_round rounds;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_prompt) < 4 or char_length(p_prompt) > 240 then
    raise exception 'prompt length must be 4-240 chars';
  end if;

  select * into v_round from rounds where id = p_round_id;
  if not found then raise exception 'round not found'; end if;
  if v_round.artist_player_id is null then
    raise exception 'not an artist round';
  end if;
  if v_round.artist_player_id <> auth.uid() then
    raise exception 'not your turn to prompt';
  end if;

  select * into v_room from rooms where id = v_round.room_id for update;
  if v_room.phase <> 'prompting' then
    raise exception 'wrong phase: %', v_room.phase;
  end if;

  update rounds set prompt = p_prompt where id = p_round_id;
  update rooms
    set phase = 'generating', phase_ends_at = null
    where id = v_room.id;
end;
$$;
revoke all on function submit_artist_prompt(uuid, text) from public;
grant execute on function submit_artist_prompt(uuid, text) to authenticated;

-- rounds_public: expose artist_player_id (public knowledge during prompting)
-- while keeping the prompt text masked outside reveal/game_over. Must DROP
-- first because we're reordering columns (adding artist_player_id).
drop view if exists rounds_public;
create view rounds_public
with (security_invoker = true)
as
select
  r.id,
  r.room_id,
  r.round_num,
  r.artist_player_id,
  case
    when rm.phase in ('reveal', 'game_over') or r.ended_at is not null
      then r.prompt
    else null
  end as prompt,
  r.image_url,
  r.image_storage_path,
  r.started_at,
  r.ended_at
from rounds r
join rooms rm on rm.id = r.room_id;
