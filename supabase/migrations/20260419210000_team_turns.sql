-- Turn-by-turn collaborative team prompt writing.
--
-- When rooms.teams_enabled = true AND rooms.mode = 'artist', the "artist"
-- role is played by an ENTIRE team. Each teammate adds one phrase in rotation
-- on a short (12s) timer. After each teammate has gone once (configurable
-- via rooms.team_turn_passes, default 1), the phrases get concatenated into
-- the round's prompt and the normal image-gen pipeline picks it up.
--
-- Scoring-wise (see #58 for the full rewrite): the writing team members each
-- gain the average of the OPPOSING team's individual totals for the round.

-- ---------------------------------------------------------------------------
-- Schema: add per-round turn state to rounds, plus a new round_phrases table.
-- ---------------------------------------------------------------------------

alter table rounds
  add column if not exists writing_team smallint check (writing_team in (1, 2));

alter table rounds
  add column if not exists turn_idx int not null default 0;

alter table rounds
  add column if not exists turn_ends_at timestamptz;

-- Per-round config knob for how many passes through the team we run.
-- Default = 1 (each teammate contributes exactly one phrase).
alter table rooms
  add column if not exists team_turn_passes smallint not null default 1
    check (team_turn_passes between 1 and 3);

-- Short per-turn timer (seconds). Exposed as a column so hosts can eventually
-- tune it from the lobby; for now it just defaults to 12.
alter table rooms
  add column if not exists team_turn_seconds smallint not null default 12
    check (team_turn_seconds between 5 and 60);

create table if not exists round_phrases (
  round_id uuid not null references rounds(id) on delete cascade,
  position int not null,
  player_id uuid not null,
  team smallint not null check (team in (1, 2)),
  phrase text not null check (char_length(phrase) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (round_id, position)
);

create index if not exists round_phrases_round_idx on round_phrases (round_id);

alter table round_phrases enable row level security;
alter table round_phrases replica identity full;

-- Realtime publication. Wrapped in a DO block because ALTER PUBLICATION ADD
-- throws duplicate_object when re-running the migration.
do $$
begin
  begin
    alter publication supabase_realtime add table round_phrases;
  exception when duplicate_object then
    null;
  end;
end$$;

-- ---------------------------------------------------------------------------
-- RLS: SELECT restricted so the OTHER team can't peek mid-compose.
-- Writing team members + room host see the phrases immediately. Everyone
-- else only sees them once the prompt is no longer secret (phase in
-- reveal / game_over, or rounds.ended_at is set).
-- Note: spectators are treated as non-writing — they see phrases at reveal,
-- which matches how rounds_public hides the prompt today.
-- INSERT is RPC-only.
-- ---------------------------------------------------------------------------

drop policy if exists round_phrases_select on round_phrases;
create policy round_phrases_select on round_phrases for select to authenticated
  using (
    exists (
      select 1
        from rounds r
        join rooms rm on rm.id = r.room_id
       where r.id = round_phrases.round_id
         and is_room_member(r.room_id)
         and (
           -- Prompt is no longer secret.
           rm.phase in ('reveal', 'game_over')
           or r.ended_at is not null
           -- Or the caller is on the writing team for this round.
           or exists (
             select 1 from room_players rp
              where rp.room_id = r.room_id
                and rp.player_id = auth.uid()
                and rp.team = round_phrases.team
           )
         )
    )
  );

-- No client INSERT policy — must go through submit_team_phrase(). Skip INSERT
-- grants entirely; SECURITY DEFINER RPCs bypass RLS.

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

-- Ordered list of writing-team members for the current round. Drives turn
-- rotation. Stable by joined_at so turn order is predictable.
create or replace function team_prompting_roster(p_round_id uuid)
returns table (
  out_player_id uuid,
  out_position int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rp.player_id as out_player_id,
    (row_number() over (order by rp.joined_at, rp.player_id))::int - 1 as out_position
  from rounds r
  join room_players rp on rp.room_id = r.room_id
  where r.id = p_round_id
    and r.writing_team is not null
    and rp.team = r.writing_team
    and coalesce(rp.is_spectator, false) = false;
$$;
revoke all on function team_prompting_roster(uuid) from public;
grant execute on function team_prompting_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- start_team_prompting_round: host-only. Picks the writing team by
-- alternating from the previous round's writing_team (random if first),
-- seeds rounds.writing_team + turn_idx=0 + turn_ends_at, flips the room to
-- 'prompting'. Returns the new round id.
--
-- This RPC is the teams_enabled + artist path of start_round; start_round
-- itself now delegates here when the flags match, so the host's existing
-- start_round call keeps working.
-- ---------------------------------------------------------------------------

create or replace function start_team_prompting_round(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_last_team smallint;
  v_team smallint;
  v_team_size int;
  v_round_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if not v_room.teams_enabled then
    raise exception 'teams not enabled on this room';
  end if;
  if v_room.mode <> 'artist' then
    raise exception 'team prompting only valid in artist mode';
  end if;
  if v_room.phase not in ('lobby', 'reveal') then
    raise exception 'cannot start round from phase %', v_room.phase;
  end if;

  -- Both teams need at least one competitor.
  for v_team in select * from (values (1::smallint), (2::smallint)) t(team) loop
    select count(*) into v_team_size
      from room_players
      where room_id = p_room_id
        and coalesce(is_spectator, false) = false
        and team = v_team;
    if v_team_size = 0 then
      raise exception 'team % has no players', v_team;
    end if;
  end loop;

  -- Pick writing team: alternate from last round; random if first.
  select writing_team into v_last_team
    from rounds
    where room_id = p_room_id and writing_team is not null
    order by round_num desc
    limit 1;

  if v_last_team is null then
    v_team := case when random() < 0.5 then 1::smallint else 2::smallint end;
  elsif v_last_team = 1 then
    v_team := 2;
  else
    v_team := 1;
  end if;

  update rooms
    set phase = 'prompting',
        round_num = round_num + 1,
        skip_count = 0,
        phase_ends_at = now() + make_interval(secs => v_room.team_turn_seconds)
    where id = p_room_id;

  insert into rounds (
    room_id,
    round_num,
    prompt,
    writing_team,
    turn_idx,
    turn_ends_at
  )
    values (
      p_room_id,
      v_room.round_num + 1,
      '',
      v_team,
      0,
      now() + make_interval(secs => v_room.team_turn_seconds)
    )
    returning id into v_round_id;

  return v_round_id;
end;
$$;
revoke all on function start_team_prompting_round(uuid) from public;
grant execute on function start_team_prompting_round(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- start_round: extend the artist branch so teams_enabled delegates to
-- start_team_prompting_round. Preserves the rest of the function verbatim.
-- ---------------------------------------------------------------------------

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

  -- Artist + teams_enabled: delegate to the team-prompting path.
  if v_room.mode = 'artist' and v_room.teams_enabled then
    return start_team_prompting_round(p_room_id);
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
      select player_id into v_artist
        from room_players
        where room_id = p_room_id and not is_spectator
        order by random()
        limit 1;
    end if;

    update rooms
      set phase = 'prompting',
          round_num = round_num + 1,
          skip_count = 0,
          phase_ends_at = now() + interval '60 seconds'
      where id = p_room_id;

    insert into rounds (room_id, round_num, prompt, artist_player_id)
      values (p_room_id, v_room.round_num + 1, '', v_artist)
      returning id into v_round_id;
  else
    update rooms
      set phase = 'generating',
          round_num = round_num + 1,
          skip_count = 0,
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

-- ---------------------------------------------------------------------------
-- submit_team_phrase: called by the teammate whose turn it is.
-- Validates caller membership + team + phrase length + turn index,
-- inserts the phrase, advances turn_idx / turn_ends_at. When all turns
-- are consumed (roster_size * team_turn_passes phrases), assembles the
-- final prompt on rounds.prompt and flips the room to 'generating' so the
-- existing start-round / image-gen flow picks it up.
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
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  v_clean := btrim(p_phrase);
  if char_length(v_clean) < 1 or char_length(v_clean) > 60 then
    raise exception 'phrase must be 1-60 characters';
  end if;

  select * into v_round from rounds where id = p_round_id for update;
  if not found then raise exception 'round not found'; end if;
  if v_round.writing_team is null then
    raise exception 'not a team-prompting round';
  end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.phase <> 'prompting' then
    raise exception 'wrong phase: %', v_room.phase;
  end if;

  -- Caller must be on the writing team and not a spectator.
  select team, coalesce(is_spectator, false)
    into v_my_team, v_is_spectator
    from room_players
    where room_id = v_room.id and player_id = auth.uid();
  if v_my_team is null then raise exception 'not in room'; end if;
  if v_is_spectator then raise exception 'spectators cannot write'; end if;
  if v_my_team <> v_round.writing_team then
    raise exception 'not your team''s turn to write';
  end if;

  -- Compute roster size + which teammate is currently up.
  select count(*) into v_roster_size from team_prompting_roster(p_round_id);
  if v_roster_size = 0 then
    raise exception 'writing team has no eligible players';
  end if;

  v_total_turns := v_roster_size * v_room.team_turn_passes;
  if v_round.turn_idx >= v_total_turns then
    raise exception 'all turns already submitted';
  end if;

  v_active_pos := v_round.turn_idx % v_roster_size;
  select out_player_id into v_active_player
    from team_prompting_roster(p_round_id)
    where out_position = v_active_pos;
  if v_active_player is null then
    raise exception 'could not resolve active teammate';
  end if;
  if v_active_player <> auth.uid() then
    raise exception 'wait your turn';
  end if;

  -- Insert the phrase at the current turn_idx position.
  insert into round_phrases (round_id, position, player_id, team, phrase)
    values (p_round_id, v_round.turn_idx, auth.uid(), v_my_team, v_clean);

  select count(*) into v_phrase_count from round_phrases where round_id = p_round_id;

  if v_phrase_count >= v_total_turns then
    -- All phrases collected. Concatenate in position order and flip the room
    -- to 'generating' so the image pipeline picks up rounds.prompt.
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
      set turn_idx = v_round.turn_idx + 1,
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
-- skip_team_turn: advance past the current teammate without inserting a
-- phrase. Callable by any room member when turn_ends_at is in the past
-- (so the host's tab can drive it client-side). If the skip consumes the
-- last turn AND no phrases have landed, we still flip to generating —
-- the image-gen pipeline will see an empty prompt and kick back to lobby
-- (same failure mode as a blank artist prompt), which is acceptable for
-- the first cut of this feature.
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
  v_phrase_count int;
  v_assembled text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_round from rounds where id = p_round_id for update;
  if not found then raise exception 'round not found'; end if;
  if v_round.writing_team is null then
    raise exception 'not a team-prompting round';
  end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then raise exception 'room not found'; end if;
  if v_room.phase <> 'prompting' then
    raise exception 'wrong phase: %', v_room.phase;
  end if;
  if not is_room_member(v_room.id) then raise exception 'not in room'; end if;

  -- Only auto-advance once the turn timer has genuinely expired. Prevents
  -- races where one client's clock is fast and it skips another player
  -- mid-type. 1s of slack for timer skew.
  if v_round.turn_ends_at is null
     or v_round.turn_ends_at > now() - interval '1 second' then
    raise exception 'turn not yet expired';
  end if;

  select count(*) into v_roster_size from team_prompting_roster(p_round_id);
  v_total_turns := v_roster_size * v_room.team_turn_passes;

  if v_round.turn_idx >= v_total_turns then
    raise exception 'all turns already submitted';
  end if;

  select count(*) into v_phrase_count from round_phrases where round_id = p_round_id;
  -- After this skip, have we exhausted the roster?
  if v_round.turn_idx + 1 >= v_total_turns then
    -- Assemble whatever we have and move on. If nothing was submitted, the
    -- prompt is empty — start-round will reject and roll back to lobby.
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
