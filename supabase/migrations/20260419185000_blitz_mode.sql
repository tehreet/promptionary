-- Blitz variant: halves the guess window and doubles the speed-bonus
-- multiplier when enabled. Stored as a plain boolean on rooms; scoring
-- branches on it inside lib/scoring.ts. Timer shortening is applied in
-- the lobby settings UI (auto-drops guess_seconds to 22 when still at the
-- default 45), so we don't need a separate server-side clamp here.
alter table rooms
  add column if not exists blitz boolean not null default false;

-- Extend update_room_settings to accept p_blitz. Same host-only / lobby-only
-- guards as the rest of the settings in this RPC. Null = leave unchanged so
-- existing call-sites keep working without passing the new arg.
create or replace function update_room_settings(
  p_room_id uuid,
  p_mode room_mode default null,
  p_pack room_pack default null,
  p_max_rounds int default null,
  p_guess_seconds int default null,
  p_reveal_seconds int default null,
  p_blitz boolean default null
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
end;
$$;

-- The old 6-arg overload has to go — Postgres will otherwise complain about
-- ambiguous calls when clients pass positional args. We drop the prior
-- signature (if it exists) and regrant on the new 7-arg one.
drop function if exists update_room_settings(uuid, room_mode, room_pack, int, int, int);
revoke all on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean) from public;
grant execute on function update_room_settings(uuid, room_mode, room_pack, int, int, int, boolean) to authenticated;
