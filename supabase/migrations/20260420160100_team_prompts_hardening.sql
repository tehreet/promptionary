-- Team prompts hardening (#58).
--
-- Three bugs shipped with PR #46:
--   a) Client highlights the wrong teammate when turn_idx=0. The server's
--      team_prompting_roster() orders by joined_at, the client sorted
--      alphabetically by display_name — for rosters with a non-alphabetical
--      join order, activePos pointed at a different player than the RPC
--      expected, so submissions rejected as "wait your turn". Fixed in
--      game-client.tsx (this migration is unrelated to (a)).
--
--   b) skip_team_turn's "turn not yet expired" guard had a 1-second slack
--      window (`turn_ends_at > now() - interval '1 second'`). The host's tab
--      calls skip_team_turn exactly when the countdown hits zero; server-side
--      the turn often hasn't crossed that 1s grace yet, so the RPC rejects
--      and the client (which swallows errors) never retries. Tighten to
--      `turn_ends_at > now()` — we don't need slack: the effect only fires
--      when the CLIENT countdown is 0, which already rounds up. Also expose
--      an auto-advance path inside submit_team_phrase so that if the active
--      teammate has fallen off the map AND their turn has expired, the NEXT
--      teammate's submission fast-forwards past them instead of 400-ing.
--
--   c) submit_team_phrase guards currently all raise exceptions (good for
--      client surfacing) but leave no trail in server logs. Adding
--      RAISE NOTICE before each exception so Vercel runtime logs carry the
--      reason without needing client-side bug reports.
--
-- No schema changes — this is CREATE OR REPLACE only.

-- ---------------------------------------------------------------------------
-- submit_team_phrase: same contract, added logging + expired-turn fast-forward.
-- ---------------------------------------------------------------------------

create or replace function submit_team_phrase(p_round_id uuid, p_phrase text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round rounds;
  v_room rooms;
  v_my_team smallint;
  v_is_spectator boolean;
  v_roster_size int;
  v_total_turns int;
  v_phrase_count int;
  v_active_pos int;
  v_active_player uuid;
  v_clean text;
  v_assembled text;
  v_turn_idx int;
begin
  if auth.uid() is null then
    raise notice 'submit_team_phrase rejected: not authenticated';
    raise exception 'not authenticated';
  end if;

  v_clean := btrim(p_phrase);
  if char_length(v_clean) < 1 or char_length(v_clean) > 60 then
    raise notice 'submit_team_phrase rejected: phrase length=% (round=%)',
      char_length(v_clean), p_round_id;
    raise exception 'phrase must be 1-60 characters';
  end if;

  select * into v_round from rounds where id = p_round_id for update;
  if not found then
    raise notice 'submit_team_phrase rejected: round not found (round=%)', p_round_id;
    raise exception 'round not found';
  end if;
  if v_round.writing_team is null then
    raise notice 'submit_team_phrase rejected: not a team round (round=%)', p_round_id;
    raise exception 'not a team-prompting round';
  end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then
    raise notice 'submit_team_phrase rejected: room missing (round=%)', p_round_id;
    raise exception 'room not found';
  end if;
  if v_room.phase <> 'prompting' then
    raise notice 'submit_team_phrase rejected: wrong phase=% (round=%)',
      v_room.phase, p_round_id;
    raise exception 'wrong phase: %', v_room.phase;
  end if;

  -- Caller must be on the writing team and not a spectator.
  select team, coalesce(is_spectator, false)
    into v_my_team, v_is_spectator
    from room_players
    where room_id = v_room.id and player_id = auth.uid();
  if v_my_team is null then
    raise notice 'submit_team_phrase rejected: caller % not in room %',
      auth.uid(), v_room.id;
    raise exception 'not in room';
  end if;
  if v_is_spectator then
    raise notice 'submit_team_phrase rejected: caller % is spectator', auth.uid();
    raise exception 'spectators cannot write';
  end if;
  if v_my_team <> v_round.writing_team then
    raise notice 'submit_team_phrase rejected: caller_team=% writing_team=%',
      v_my_team, v_round.writing_team;
    raise exception 'not your team''s turn to write';
  end if;

  -- Compute roster size + which teammate is currently up.
  select count(*) into v_roster_size from team_prompting_roster(p_round_id);
  if v_roster_size = 0 then
    raise notice 'submit_team_phrase rejected: empty roster (round=%)', p_round_id;
    raise exception 'writing team has no eligible players';
  end if;

  v_total_turns := v_roster_size * v_room.team_turn_passes;
  if v_round.turn_idx >= v_total_turns then
    raise notice 'submit_team_phrase rejected: all turns used (turn_idx=%, total=%)',
      v_round.turn_idx, v_total_turns;
    raise exception 'all turns already submitted';
  end if;

  -- Expired-turn fast-forward. If the current teammate's turn_ends_at is in
  -- the past AND the caller is a DIFFERENT teammate, advance turn_idx past
  -- the MIA player(s) until we land on someone whose turn hasn't expired
  -- (the caller, ideally). Bounded by total turns. This is the safety net
  -- for when skip_team_turn hasn't fired (host tab closed, clock skew, etc).
  v_turn_idx := v_round.turn_idx;
  while v_turn_idx < v_total_turns loop
    v_active_pos := v_turn_idx % v_roster_size;
    select out_player_id into v_active_player
      from team_prompting_roster(p_round_id)
      where out_position = v_active_pos;
    exit when v_active_player = auth.uid();
    exit when v_round.turn_ends_at is null or v_round.turn_ends_at >= now();
    -- Active teammate's turn has expired AND caller isn't them. Fast-forward.
    raise notice 'submit_team_phrase auto-skipping expired turn_idx=% (active=%, caller=%)',
      v_turn_idx, v_active_player, auth.uid();
    v_turn_idx := v_turn_idx + 1;
    -- After the first advance the stored turn_ends_at is stale, so assume
    -- each subsequent slot is ALSO expired (which is correct — the timer
    -- only ticks once per real-time interval). Keep looping until we match
    -- the caller or exhaust the roster.
  end loop;

  if v_turn_idx >= v_total_turns then
    -- We skipped past everyone. Assemble whatever phrases exist and flip.
    raise notice 'submit_team_phrase: roster exhausted after fast-forward, assembling';
    select string_agg(phrase, ' ' order by position)
      into v_assembled
      from round_phrases
      where round_id = p_round_id;
    update rounds
      set prompt = coalesce(v_assembled, ''),
          turn_idx = v_total_turns,
          turn_ends_at = null
      where id = p_round_id;
    update rooms
      set phase = 'generating',
          phase_ends_at = null
      where id = v_room.id;
    return;
  end if;

  v_active_pos := v_turn_idx % v_roster_size;
  select out_player_id into v_active_player
    from team_prompting_roster(p_round_id)
    where out_position = v_active_pos;
  if v_active_player is null then
    raise notice 'submit_team_phrase rejected: null active player (pos=%)', v_active_pos;
    raise exception 'could not resolve active teammate';
  end if;
  if v_active_player <> auth.uid() then
    raise notice 'submit_team_phrase rejected: not active (active=%, caller=%, turn_idx=%)',
      v_active_player, auth.uid(), v_turn_idx;
    raise exception 'wait your turn';
  end if;

  -- Insert the phrase at the (possibly fast-forwarded) turn slot.
  insert into round_phrases (round_id, position, player_id, team, phrase)
    values (p_round_id, v_turn_idx, auth.uid(), v_my_team, v_clean);

  select count(*) into v_phrase_count from round_phrases where round_id = p_round_id;

  if v_turn_idx + 1 >= v_total_turns then
    -- This was the last turn. Concatenate everything in position order and
    -- flip the room to 'generating' so the image pipeline picks up the prompt.
    select string_agg(phrase, ' ' order by position)
      into v_assembled
      from round_phrases
      where round_id = p_round_id;

    update rounds
      set prompt = coalesce(v_assembled, ''),
          turn_idx = v_total_turns,
          turn_ends_at = null
      where id = p_round_id;

    update rooms
      set phase = 'generating',
          phase_ends_at = null
      where id = v_room.id;
  else
    -- Advance to the next teammate's turn.
    update rounds
      set turn_idx = v_turn_idx + 1,
          turn_ends_at = now() + make_interval(secs => v_room.team_turn_seconds)
      where id = p_round_id;
    update rooms
      set phase_ends_at = now() + make_interval(secs => v_room.team_turn_seconds)
      where id = v_room.id;
  end if;
end;
$$;
revoke all on function submit_team_phrase(uuid, text) from public;
grant execute on function submit_team_phrase(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- skip_team_turn: drop the 1s slack — it was blocking legitimate expirations.
-- The host tab's skip-effect fires when the client-side countdown hits zero,
-- which already rounds up via Math.ceil. Adding a second layer of server-side
-- slack means the first call always rejects, and since the client swallows
-- errors (and the effect doesn't retry past the 0-transition), the turn
-- never advances.
-- ---------------------------------------------------------------------------

create or replace function skip_team_turn(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round rounds;
  v_room rooms;
  v_roster_size int;
  v_total_turns int;
  v_assembled text;
begin
  if auth.uid() is null then
    raise notice 'skip_team_turn rejected: not authenticated';
    raise exception 'not authenticated';
  end if;

  select * into v_round from rounds where id = p_round_id for update;
  if not found then
    raise notice 'skip_team_turn rejected: round not found (round=%)', p_round_id;
    raise exception 'round not found';
  end if;
  if v_round.writing_team is null then
    raise notice 'skip_team_turn rejected: not a team round (round=%)', p_round_id;
    raise exception 'not a team-prompting round';
  end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then
    raise notice 'skip_team_turn rejected: room missing (round=%)', p_round_id;
    raise exception 'room not found';
  end if;
  if v_room.phase <> 'prompting' then
    raise notice 'skip_team_turn rejected: wrong phase=%', v_room.phase;
    raise exception 'wrong phase: %', v_room.phase;
  end if;
  if not is_room_member(v_room.id) then
    raise notice 'skip_team_turn rejected: caller % not in room %', auth.uid(), v_room.id;
    raise exception 'not in room';
  end if;

  -- Only advance once the turn timer has crossed zero on the server clock.
  -- No slack — the client already rounds remaining up with Math.ceil.
  if v_round.turn_ends_at is null or v_round.turn_ends_at > now() then
    raise notice 'skip_team_turn rejected: not expired (turn_ends_at=%, now=%)',
      v_round.turn_ends_at, now();
    raise exception 'turn not yet expired';
  end if;

  select count(*) into v_roster_size from team_prompting_roster(p_round_id);
  v_total_turns := v_roster_size * v_room.team_turn_passes;

  if v_round.turn_idx >= v_total_turns then
    raise notice 'skip_team_turn rejected: all turns used (turn_idx=%, total=%)',
      v_round.turn_idx, v_total_turns;
    raise exception 'all turns already submitted';
  end if;

  if v_round.turn_idx + 1 >= v_total_turns then
    -- Skipping consumes the last turn. Assemble whatever we have and move on.
    select string_agg(phrase, ' ' order by position)
      into v_assembled
      from round_phrases
      where round_id = p_round_id;

    update rounds
      set prompt = coalesce(v_assembled, ''),
          turn_idx = v_total_turns,
          turn_ends_at = null
      where id = p_round_id;

    update rooms
      set phase = 'generating',
          phase_ends_at = null
      where id = v_room.id;
  else
    update rounds
      set turn_idx = v_round.turn_idx + 1,
          turn_ends_at = now() + make_interval(secs => v_room.team_turn_seconds)
      where id = p_round_id;
    update rooms
      set phase_ends_at = now() + make_interval(secs => v_room.team_turn_seconds)
      where id = v_room.id;
  end if;
end;
$$;
revoke all on function skip_team_turn(uuid) from public;
grant execute on function skip_team_turn(uuid) to authenticated;
