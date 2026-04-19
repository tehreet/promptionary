-- Spectator tiebreaker: when the top two guesses end up within 5 points during
-- the reveal phase, any spectators in the room get a "who nailed it?" vote.
-- Majority winner's guess gets a +5 bonus before reveal advances to the next
-- round. Vote window is the existing reveal_seconds — no extension.
--
-- Table holds one row per (round, spectator). Primary key prevents double
-- voting. Bonus resolution happens in resolve_spectator_votes(round_id) which
-- the host tab calls on its way out of the reveal phase (service role writes
-- to guesses / room_players).

create table if not exists spectator_votes (
  round_id uuid not null references rounds(id) on delete cascade,
  spectator_id uuid not null,
  voted_player_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (round_id, spectator_id)
);

create index if not exists spectator_votes_round_idx
  on spectator_votes (round_id);

alter table spectator_votes enable row level security;
alter table spectator_votes replica identity full;

-- Room members (players + spectators) can read the running tally — the UI
-- needs it for both the spectator-facing vote count and the player-facing
-- "spectators are voting" badge.
create policy spectator_votes_select on spectator_votes for select to authenticated
  using (
    exists (
      select 1 from rounds r
      where r.id = spectator_votes.round_id
        and is_room_member(r.room_id)
    )
  );

-- No direct inserts/updates/deletes from clients — must go through
-- cast_spectator_vote() so the spectator / phase / tie validation can't be
-- bypassed.

create or replace function cast_spectator_vote(
  p_round_id uuid,
  p_voted_player_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round rounds;
  v_room rooms;
  v_player room_players;
  v_top_score integer;
  v_second_score integer;
  v_voted_score integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_round from rounds where id = p_round_id;
  if not found then raise exception 'round not found'; end if;

  select * into v_room from rooms where id = v_round.room_id;
  if not found then raise exception 'room not found'; end if;

  -- Phase gate: only during reveal, and only before phase_ends_at.
  if v_room.phase <> 'reveal' then
    raise exception 'voting closed (phase=%)', v_room.phase;
  end if;
  if v_room.phase_ends_at is null or v_room.phase_ends_at <= now() then
    raise exception 'voting closed (window expired)';
  end if;

  -- Caller must be a spectator in this room.
  select * into v_player from room_players
    where room_id = v_room.id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;
  if not v_player.is_spectator then
    raise exception 'only spectators can vote';
  end if;

  -- Validate the voted player has a guess in the top-2 tie for this round:
  -- top1 and top2 must both be > 0 and within 5 pts.
  select total_score into v_top_score from guesses
    where round_id = p_round_id
    order by total_score desc, submitted_at asc
    limit 1;
  if v_top_score is null or v_top_score <= 0 then
    raise exception 'no eligible guesses';
  end if;

  select total_score into v_second_score from guesses
    where round_id = p_round_id
    order by total_score desc, submitted_at asc
    offset 1 limit 1;
  if v_second_score is null or v_second_score <= 0 then
    raise exception 'no tiebreaker';
  end if;

  if (v_top_score - v_second_score) > 5 then
    raise exception 'no tiebreaker';
  end if;

  select total_score into v_voted_score from guesses
    where round_id = p_round_id and player_id = p_voted_player_id
    order by total_score desc
    limit 1;
  if v_voted_score is null then
    raise exception 'voted player has no guess';
  end if;
  if v_voted_score < v_second_score then
    raise exception 'voted player not in top 2';
  end if;

  insert into spectator_votes (round_id, spectator_id, voted_player_id)
    values (p_round_id, auth.uid(), p_voted_player_id);
  -- Let the PK conflict raise naturally ("duplicate key value") so the client
  -- knows the vote was already recorded.
end;
$$;
revoke all on function cast_spectator_vote(uuid, uuid) from public;
grant execute on function cast_spectator_vote(uuid, uuid) to authenticated;

-- Resolve the vote and apply the +5 bonus to the winning guess.
--
-- Idempotent: marks the round as resolved by writing a sentinel row
-- (voted_player_id = all-zero UUID, spectator_id = all-zero UUID) the first
-- time it runs. Subsequent calls see the sentinel and no-op. Ties go to
-- neither — no bonus awarded.
create or replace function resolve_spectator_votes(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round rounds;
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
  v_exists int;
  v_winner uuid;
  v_winner_votes int;
  v_second_votes int;
  v_guess_id uuid;
begin
  select * into v_round from rounds where id = p_round_id;
  if not found then return; end if;

  -- Sentinel guard: if we've already resolved, no-op.
  select 1 into v_exists from spectator_votes
    where round_id = p_round_id and spectator_id = v_sentinel;
  if found then return; end if;

  -- Pick the top-voted candidate. Guard against ties: if the top two vote
  -- counts are equal, no bonus is awarded.
  with counts as (
    select voted_player_id, count(*)::int as n
    from spectator_votes
    where round_id = p_round_id
      and spectator_id <> v_sentinel
    group by voted_player_id
    order by n desc
  )
  select voted_player_id, n into v_winner, v_winner_votes from counts limit 1;

  select n into v_second_votes from (
    select count(*)::int as n
    from spectator_votes
    where round_id = p_round_id
      and spectator_id <> v_sentinel
    group by voted_player_id
    order by n desc
    offset 1 limit 1
  ) t;

  -- Write the sentinel first so concurrent callers bail out.
  insert into spectator_votes (round_id, spectator_id, voted_player_id)
    values (p_round_id, v_sentinel, v_sentinel)
    on conflict do nothing;

  if v_winner is null then return; end if;
  if v_second_votes is not null and v_second_votes = v_winner_votes then
    -- Exact tie on votes — no bonus.
    return;
  end if;

  -- Find the winner's guess for this round and +5 it.
  select id into v_guess_id from guesses
    where round_id = p_round_id and player_id = v_winner
    limit 1;
  if v_guess_id is null then return; end if;

  update guesses
    set total_score = total_score + 5,
        speed_bonus = speed_bonus + 5
    where id = v_guess_id;

  update room_players
    set score = score + 5
    where room_id = v_round.room_id and player_id = v_winner;
end;
$$;
revoke all on function resolve_spectator_votes(uuid) from public;
-- Any authenticated member can trigger resolution from the reveal-advance
-- path. The sentinel guard + definer rights keep it idempotent and safe.
grant execute on function resolve_spectator_votes(uuid) to authenticated;

-- Expose via realtime so the vote tally updates live in the UI.
alter publication supabase_realtime add table spectator_votes;
