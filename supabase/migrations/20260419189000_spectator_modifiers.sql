-- Spectator modifiers: spectators submit short prompt fragments during a
-- round ("in neon colors", "underwater", "at 3am"). At the start of the
-- NEXT round one modifier is randomly picked from the pool and appended
-- to the Gemini-authored prompt (or, in artist mode, to the artist's
-- submitted prompt). Pool is per (room, round_num) so each round's
-- submissions shape the following round.
--
-- Moderation happens in the API route (`/api/submit-modifier`) before
-- the RPC is called; the RPC trusts that and enforces only identity,
-- spectator status, phase gate, rate-limit, and length.
--
-- Rate limit: each spectator may contribute at most 3 modifiers per
-- (room, round_num). INSERT is gated to the RPC so the cap is honored.

create table if not exists spectator_modifiers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_num int not null,
  spectator_id uuid not null,
  modifier text not null check (char_length(modifier) between 1 and 60),
  created_at timestamptz not null default now()
);

create index if not exists spectator_modifiers_room_round_idx
  on spectator_modifiers (room_id, round_num, created_at);

alter table spectator_modifiers enable row level security;
alter table spectator_modifiers replica identity full;

-- Any room member can read the pool so both spectators (building it)
-- and competitors (seeing what's being thrown in) can watch it grow.
create policy spectator_modifiers_select on spectator_modifiers for select to authenticated
  using (is_room_member(room_id));

-- No direct inserts from clients — must go through submit_modifier() so
-- the spectator + rate-limit + length checks can't be bypassed.

-- Record which modifier (if any) was applied to a round, so the reveal
-- UI can show "Modifier applied: …" and attribute the spectator.
alter table rounds
  add column if not exists chosen_modifier text,
  add column if not exists chosen_modifier_spectator_id uuid;

-- Expose the chosen modifier on rounds_public. The view is dropped/
-- recreated (can't just replace with an added column and keep ordering
-- stable) per the same pattern used for adding artist_player_id.
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
  r.ended_at,
  -- Modifier is safe to expose any time — it's either null or
  -- something everyone in the room already saw in the pool.
  r.chosen_modifier,
  r.chosen_modifier_spectator_id
from rounds r
join rooms rm on rm.id = r.room_id;

create or replace function submit_modifier(
  p_room_id uuid,
  p_round_num int,
  p_modifier text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player room_players;
  v_room rooms;
  v_count int;
  v_trimmed text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;

  -- Caller must be a spectator in this room.
  select * into v_player from room_players
    where room_id = p_room_id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;
  if not v_player.is_spectator then
    raise exception 'only spectators can submit modifiers';
  end if;

  -- Phase gate: modifiers only during an active round so they actually
  -- influence the next prompt. Lobby / reveal / game_over are closed.
  if v_room.phase not in ('generating', 'guessing', 'prompting', 'scoring') then
    raise exception 'modifiers closed (phase=%)', v_room.phase;
  end if;

  v_trimmed := btrim(p_modifier);
  if v_trimmed is null or char_length(v_trimmed) < 1 then
    raise exception 'modifier empty';
  end if;
  if char_length(v_trimmed) > 60 then
    raise exception 'modifier too long';
  end if;

  -- Rate limit: at most 3 modifiers per spectator per (room, round_num).
  select count(*)::int into v_count from spectator_modifiers
    where room_id = p_room_id
      and round_num = p_round_num
      and spectator_id = auth.uid();
  if v_count >= 3 then
    raise exception 'modifier limit reached';
  end if;

  insert into spectator_modifiers (room_id, round_num, spectator_id, modifier)
    values (p_room_id, p_round_num, auth.uid(), v_trimmed)
    returning id into v_id;

  return v_id;
end;
$$;
revoke all on function submit_modifier(uuid, int, text) from public;
grant execute on function submit_modifier(uuid, int, text) to authenticated;

-- Expose via realtime so the pool updates live for everyone watching.
alter publication supabase_realtime add table spectator_modifiers;
