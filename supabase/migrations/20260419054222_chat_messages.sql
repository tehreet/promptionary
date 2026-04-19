-- Inter-round chat. Messages are stored for history so late joiners / refreshes
-- can catch up. Phase-blackout gating in the INSERT policy ensures nobody can
-- coordinate during guessing, even with a custom client.

create table if not exists room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  content text not null check (char_length(content) between 1 and 400),
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_created_idx
  on room_messages (room_id, created_at);

alter table room_messages enable row level security;
alter table room_messages replica identity full;

-- Members of the room can read history.
create policy room_messages_select on room_messages for select to authenticated
  using (is_room_member(room_id));

-- Members of the room can post messages — but only during lobby, reveal, or
-- game_over. Guessing / generating / scoring are blacked out so nobody can
-- hint or coordinate mid-round. Spectators can chat any time (the blackout
-- only prevents competitive collusion; spectators aren't competing).
create policy room_messages_insert on room_messages for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (
      select 1 from room_players rp
      where rp.room_id = room_messages.room_id and rp.player_id = auth.uid()
    )
    and (
      exists (
        select 1 from room_players rp
        where rp.room_id = room_messages.room_id
          and rp.player_id = auth.uid()
          and rp.is_spectator
      )
      or exists (
        select 1 from rooms r
        where r.id = room_messages.room_id
          and r.phase in ('lobby', 'reveal', 'game_over')
      )
    )
  );

-- No updates or deletes from clients — messages are immutable.

-- post_message: wrapper RPC so clients don't need to know their display_name
-- at the time of send — we derive it from room_players.
create or replace function post_message(p_room_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member room_players;
  v_room rooms;
  v_msg_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(p_content) < 1 or char_length(p_content) > 400 then
    raise exception 'message length invalid';
  end if;

  select * into v_member from room_players
    where room_id = p_room_id and player_id = auth.uid();
  if not found then raise exception 'not in room'; end if;

  select * into v_room from rooms where id = p_room_id;
  if not found then raise exception 'room not found'; end if;

  if not v_member.is_spectator
    and v_room.phase not in ('lobby', 'reveal', 'game_over') then
    raise exception 'chat locked during active round';
  end if;

  insert into room_messages (room_id, player_id, display_name, content)
    values (p_room_id, auth.uid(), v_member.display_name, p_content)
    returning id into v_msg_id;

  return v_msg_id;
end;
$$;
revoke all on function post_message(uuid, text) from public;
grant execute on function post_message(uuid, text) to authenticated;

alter publication supabase_realtime add table room_messages;
