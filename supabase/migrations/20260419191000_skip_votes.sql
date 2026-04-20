-- Vote-to-skip: an anti-frustration valve during the guessing phase. Any
-- non-spectator / non-artist competitor can vote to reroll the current round
-- when Gemini produces something nonsensical (or the prompt leaks in the
-- image). If >= 50% of eligible competitors vote to skip, the round is
-- deleted and start-round runs again with the same round_num — this counts
-- as a reroll, not a new round.
--
-- Anti-abuse: we track a per-round skip_count on `rooms`, capped at 2 skips
-- per round_num (enforced in the /api/skip-round route). Counter is bumped
-- by the service role after a successful reroll. It naturally resets when
-- round_num advances because the skip-round route checks the counter only
-- against the current round_num.

create table if not exists skip_votes (
  round_id uuid not null references rounds(id) on delete cascade,
  voter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (round_id, voter_id)
);

create index if not exists skip_votes_round_idx on skip_votes (round_id);

alter table skip_votes enable row level security;
alter table skip_votes replica identity full;

-- Room members (players + spectators) can read the running tally — the UI
-- needs it to render "3/5 voted to skip" live.
drop policy if exists skip_votes_select on skip_votes;
create policy skip_votes_select on skip_votes for select to authenticated
  using (
    exists (
      select 1 from rounds r
      where r.id = skip_votes.round_id
        and is_room_member(r.room_id)
    )
  );

-- No direct inserts from clients — must go through cast_skip_vote() so
-- spectator / artist / phase validation can't be bypassed.

create or replace function cast_skip_vote(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round rounds;
  v_room rooms;
  v_player room_players;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_round from rounds where id = p_round_id;
  if not found then raise exception 'round not found'; end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then raise exception 'room not found'; end if;

  -- Phase gate: only during guessing. Scoring/reveal are too late.
  if v_room.phase <> 'guessing' then
    raise exception 'voting closed (phase=%)', v_room.phase;
  end if;

  -- Caller must be a non-spectator member in this room.
  select * into v_player from room_players
    where room_id = v_room.id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;
  if v_player.is_spectator then
    raise exception 'spectators cannot vote to skip';
  end if;

  -- Artist mode: the artist wrote the prompt, they don't get to abort.
  if v_round.artist_player_id is not null
     and v_round.artist_player_id = auth.uid() then
    raise exception 'artist cannot vote to skip own round';
  end if;

  insert into skip_votes (round_id, voter_id)
    values (p_round_id, auth.uid())
    on conflict do nothing;
end;
$$;
revoke all on function cast_skip_vote(uuid) from public;
grant execute on function cast_skip_vote(uuid) to authenticated;

-- Expose via realtime so the vote tally updates live in the UI. Broadcast
-- via RoomChannelProvider is the fast path; this is the postgres_changes
-- backstop for tabs that miss a broadcast.
do $$
begin
  begin
    alter publication supabase_realtime add table skip_votes;
  exception when duplicate_object then
    -- already in the publication; no-op
    null;
  end;
end$$;

-- Per-round skip counter on rooms. Cap enforced in /api/skip-round. We add
-- it as nullable-with-default so existing rows pick up zero.
alter table rooms add column if not exists skip_count int not null default 0;

-- Reset skip_count whenever the round advances. Piggy-backs on start_round
-- (the canonical entry point for new rounds — lobby → first round and
-- reveal → next round both go through it). play_again also needs a reset
-- because the counter survives a room-level reset otherwise.
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

-- Play Again also resets the counter — otherwise skips accrued in the
-- previous game would leak into the new one. Same signature as the
-- canonical play_again; just adds skip_count = 0 to the update.
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
    skip_count = 0,
    phase_ends_at = null,
    max_rounds = coalesce(p_max_rounds, max_rounds),
    guess_seconds = coalesce(p_guess_seconds, guess_seconds),
    reveal_seconds = coalesce(p_reveal_seconds, reveal_seconds)
    where id = p_room_id;
end;
$$;
revoke all on function play_again(uuid, int, int, int) from public;
grant execute on function play_again(uuid, int, int, int) to authenticated;
