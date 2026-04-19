-- Theme packs: scope the prompt-author's subject/setting pools by theme.
-- Default 'mixed' keeps the existing behavior (full pools).

create type room_pack as enum ('mixed', 'food', 'wildlife', 'history', 'absurd');

alter table rooms
  add column pack room_pack not null default 'mixed';

create or replace function create_room(
  p_display_name text,
  p_mode room_mode default 'party',
  p_max_rounds int default null,
  p_guess_seconds int default null,
  p_reveal_seconds int default null,
  p_pack room_pack default 'mixed'
)
returns table (new_room_id uuid, new_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_room_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 24 then
    raise exception 'display_name length invalid';
  end if;

  v_code := generate_room_code();

  insert into rooms (
    code, host_id, mode, pack,
    max_rounds, guess_seconds, reveal_seconds
  )
  values (
    v_code, auth.uid(), p_mode, p_pack,
    coalesce(p_max_rounds, 5),
    coalesce(p_guess_seconds, 45),
    coalesce(p_reveal_seconds, 20)
  )
  returning id into v_room_id;

  insert into room_players (room_id, player_id, display_name, is_host)
    values (v_room_id, auth.uid(), p_display_name, true);

  return query select v_room_id, v_code;
end;
$$;
revoke all on function create_room(text, room_mode, int, int, int, room_pack) from public;
grant execute on function create_room(text, room_mode, int, int, int, room_pack) to authenticated;

-- Older 5-arg create_room signature isn't used anywhere else, but drop it
-- to avoid overload ambiguity now that a new arg has been added.
drop function if exists create_room(text, room_mode, int, int, int);
