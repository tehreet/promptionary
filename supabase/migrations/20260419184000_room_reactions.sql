-- Emoji reactions persistence. Broadcast is the fast path; this table is the
-- backstop so late joiners / refreshes / reconnects see the last few seconds
-- of activity. Clients fetch the last ~10 seconds on mount and spawn the
-- floats alongside whatever live broadcasts arrive.
--
-- Rate-limiting lives in the RPC (max 1 insert per player per 200ms) so a
-- misbehaving client can't spam the table. RLS: SELECT for any room member,
-- INSERT only via post_reaction().

create table if not exists room_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null,
  emoji text not null check (char_length(emoji) between 1 and 16),
  color text not null check (char_length(color) between 1 and 32),
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  created_at timestamptz not null default now()
);

create index if not exists room_reactions_room_created_idx
  on room_reactions (room_id, created_at desc);

alter table room_reactions enable row level security;
alter table room_reactions replica identity full;

-- Members of the room can read recent reactions.
create policy room_reactions_select on room_reactions for select to authenticated
  using (is_room_member(room_id));

-- No direct inserts from clients — must go through post_reaction() so the
-- rate-limit check can't be bypassed. (No policy => insert denied for
-- non-service-role clients.)

-- No updates or deletes from clients — reactions are immutable and expire
-- by age on the read side.

create or replace function post_reaction(
  p_room_id uuid,
  p_emoji text,
  p_color text,
  p_x real,
  p_y real
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_at timestamptz;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_room_member(p_room_id) then raise exception 'not in room'; end if;
  if char_length(p_emoji) < 1 or char_length(p_emoji) > 16 then
    raise exception 'emoji length invalid';
  end if;
  if char_length(p_color) < 1 or char_length(p_color) > 32 then
    raise exception 'color length invalid';
  end if;
  if p_x < 0 or p_x > 1 or p_y < 0 or p_y > 1 then
    raise exception 'coords out of range';
  end if;

  -- Rate-limit: 1 reaction per player per room per 200ms.
  select max(created_at) into v_last_at from room_reactions
    where room_id = p_room_id and player_id = auth.uid();
  if v_last_at is not null and now() - v_last_at < interval '200 milliseconds' then
    raise exception 'rate limited';
  end if;

  insert into room_reactions (room_id, player_id, emoji, color, x, y)
    values (p_room_id, auth.uid(), p_emoji, p_color, p_x, p_y)
    returning id into v_id;

  return v_id;
end;
$$;
revoke all on function post_reaction(uuid, text, text, real, real) from public;
grant execute on function post_reaction(uuid, text, text, real, real) to authenticated;

-- Expose via realtime so members streaming postgres_changes pick up
-- reactions they missed between broadcast subscribe and the initial mount
-- fetch. (Broadcast remains the primary fast path.)
alter publication supabase_realtime add table room_reactions;
