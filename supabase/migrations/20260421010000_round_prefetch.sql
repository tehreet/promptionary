-- Speculative pre-generation of round N+1 during round N's guessing phase.
-- During `guessing` the server is idle on the Gemini side (players are
-- typing), so we author + render the next prompt+image and stash it on
-- `rooms`. When `/api/start-round` fires for round N+1 it consumes the
-- cached row instead of paying the 20-40s Gemini tax, turning the
-- generating-phase wait into a ~1s phase flip.
--
-- All four columns are server-role-written only — no RLS changes needed.
-- `prefetch_started_at` is an advisory lock: we treat any row with a
-- timestamp within the last 120s as "in-flight" and refuse to restart.
-- On failure the route clears it back to null so a retry can claim.

alter table rooms
  add column if not exists prefetched_prompt text,
  add column if not exists prefetched_image_storage_path text,
  add column if not exists prefetched_image_url text,
  add column if not exists prefetched_tokens jsonb,
  add column if not exists prefetch_started_at timestamptz;

-- Clear prefetch on play_again so the next game doesn't consume a stale
-- prompt authored for the previous game's pack/settings.
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
    reveal_seconds = coalesce(p_reveal_seconds, reveal_seconds),
    prefetched_prompt = null,
    prefetched_image_storage_path = null,
    prefetched_image_url = null,
    prefetched_tokens = null,
    prefetch_started_at = null
    where id = p_room_id;
end;
$$;

-- Extend update_room_settings to also clear the prefetch cache when the
-- host flips pack (or mode → artist). The signature must keep matching
-- the 8-arg shape set by the taboo migration: changing the signature
-- would orphan every browser client that calls the RPC with named args.
create or replace function update_room_settings(
  p_room_id uuid,
  p_mode room_mode default null,
  p_pack room_pack default null,
  p_max_rounds int default null,
  p_guess_seconds int default null,
  p_reveal_seconds int default null,
  p_blitz boolean default null,
  p_taboo_enabled boolean default null
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
  if v_room.host_id <> auth.uid() then
    raise exception 'only host can change settings';
  end if;
  if v_room.phase <> 'lobby' then
    raise exception 'room already started';
  end if;

  if p_mode is not null then
    -- Mode flip invalidates any stashed prefetch — artist mode never
    -- consumes prefetch, and a party→artist switch should wipe it.
    update rooms set
      mode = p_mode,
      prefetched_prompt = null,
      prefetched_image_storage_path = null,
      prefetched_image_url = null,
      prefetched_tokens = null,
      prefetch_started_at = null
      where id = p_room_id;
  end if;
  if p_pack is not null then
    -- Pack change invalidates any stashed prefetch — the prompt was
    -- authored against the old pack's dimension pools.
    update rooms set
      pack = p_pack,
      prefetched_prompt = null,
      prefetched_image_storage_path = null,
      prefetched_image_url = null,
      prefetched_tokens = null,
      prefetch_started_at = null
      where id = p_room_id;
  end if;
  if p_max_rounds is not null then
    if p_max_rounds < 1 or p_max_rounds > 20 then
      raise exception 'max_rounds must be between 1 and 20';
    end if;
    update rooms set max_rounds = p_max_rounds where id = p_room_id;
  end if;
  if p_guess_seconds is not null then
    if p_guess_seconds < 15 or p_guess_seconds > 120 then
      raise exception 'guess_seconds must be between 15 and 120';
    end if;
    update rooms set guess_seconds = p_guess_seconds where id = p_room_id;
  end if;
  if p_reveal_seconds is not null then
    if p_reveal_seconds < 5 or p_reveal_seconds > 30 then
      raise exception 'reveal_seconds must be between 5 and 30';
    end if;
    update rooms set reveal_seconds = p_reveal_seconds where id = p_room_id;
  end if;
  if p_blitz is not null then
    update rooms set blitz = p_blitz where id = p_room_id;
  end if;
  if p_taboo_enabled is not null then
    update rooms set taboo_enabled = p_taboo_enabled where id = p_room_id;
  end if;
end;
$$;
revoke all on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean, boolean) from public;
grant execute on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean, boolean) to authenticated;
revoke all on function play_again(uuid, int, int, int) from public;
grant execute on function play_again(uuid, int, int, int) to authenticated;
