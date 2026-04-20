-- Taboo artist variant: the artist gets 3 forbidden words per round they
-- can't use in their prompt. Validated at submit time (case-insensitive).
-- After the round, the words are revealed in the recap — fun blooper chip.
--
-- Scope: artist mode only. No effect on party/party+teams/party+blitz.

alter table rooms
  add column if not exists taboo_enabled boolean not null default false;

-- Words chosen at round start when taboo_enabled AND it's an artist round.
-- Populated by the /api/start-round route after start_round inserts the round,
-- to keep SQL simple and keep the word pool colocated with the TS code.
alter table rounds
  add column if not exists taboo_words text[];

-- Extend update_room_settings to accept p_taboo_enabled. Same host-only /
-- lobby-only guards as the rest. Null = leave unchanged.
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
    update rooms set mode = p_mode where id = p_room_id;
  end if;
  if p_pack is not null then
    update rooms set pack = p_pack where id = p_room_id;
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

-- Drop the old 7-arg overload so positional callers don't hit an ambiguous
-- function lookup. Grant execute on the new 8-arg signature.
drop function if exists update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean);
revoke all on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean, boolean) from public;
grant execute on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean, boolean) to authenticated;

-- Extend rounds_public to expose taboo_words alongside artist_player_id.
-- Safe to surface pre-reveal since only the artist's *prompt* is secret —
-- the banned words are meant to be visible to the artist while prompting,
-- and harmless context for everyone else.
drop view if exists rounds_public;
create view rounds_public
with (security_invoker = true)
as
select
  r.id,
  r.room_id,
  r.round_num,
  r.artist_player_id,
  r.taboo_words,
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
