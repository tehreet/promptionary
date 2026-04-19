-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Enums
do $$ begin
  create type room_mode as enum ('party', 'teams', 'headsup');
exception when duplicate_object then null; end $$;

do $$ begin
  create type room_phase as enum ('lobby', 'generating', 'guessing', 'scoring', 'reveal', 'game_over');
exception when duplicate_object then null; end $$;

do $$ begin
  create type token_role as enum ('subject', 'style', 'modifier', 'filler');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z]{4}$'),
  host_id uuid not null,
  mode room_mode not null default 'party',
  phase room_phase not null default 'lobby',
  round_num int not null default 0,
  max_rounds int not null default 5 check (max_rounds between 1 and 20),
  guess_seconds int not null default 45 check (guess_seconds between 15 and 120),
  reveal_seconds int not null default 10 check (reveal_seconds between 5 and 30),
  phase_ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists rooms_code_idx on rooms (code);
create index if not exists rooms_phase_ends_at_idx on rooms (phase_ends_at) where phase_ends_at is not null;

create table if not exists room_players (
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  score int not null default 0,
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
create index if not exists room_players_player_idx on room_players (player_id);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_num int not null,
  prompt text not null default '',
  image_url text,
  image_storage_path text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, round_num)
);

create table if not exists round_prompt_tokens (
  round_id uuid not null references rounds(id) on delete cascade,
  position int not null,
  token text not null,
  role token_role not null,
  primary key (round_id, position)
);

create table if not exists guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  player_id uuid not null,
  guess text not null check (char_length(guess) between 1 and 200),
  subject_score int not null default 0,
  style_score int not null default 0,
  semantic_score int not null default 0,
  speed_bonus int not null default 0,
  total_score int generated always as (subject_score + style_score + semantic_score + speed_bonus) stored,
  submitted_at timestamptz not null default now(),
  scored_at timestamptz,
  unique (round_id, player_id)
);
create index if not exists guesses_round_idx on guesses (round_id);

-- rounds_public view: hides prompt unless room is in reveal/game_over or the round has ended
create or replace view rounds_public
with (security_invoker = true)
as
select
  r.id,
  r.room_id,
  r.round_num,
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

-- Enable RLS
alter table rooms enable row level security;
alter table room_players enable row level security;
alter table rounds enable row level security;
alter table round_prompt_tokens enable row level security;
alter table guesses enable row level security;

-- RLS: rooms
create policy rooms_select on rooms for select to authenticated using (true);
create policy rooms_insert on rooms for insert to authenticated with check (host_id = auth.uid());
create policy rooms_update on rooms for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy rooms_delete on rooms for delete to authenticated using (host_id = auth.uid());

-- RLS: room_players
create policy room_players_select on room_players for select to authenticated using (
  exists (select 1 from room_players rp where rp.room_id = room_players.room_id and rp.player_id = auth.uid())
);
create policy room_players_insert on room_players for insert to authenticated with check (
  player_id = auth.uid()
  and exists (select 1 from rooms r where r.id = room_id and r.phase = 'lobby')
);
create policy room_players_update_self on room_players for update to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy room_players_update_host on room_players for update to authenticated using (
  exists (select 1 from rooms r where r.id = room_id and r.host_id = auth.uid())
);
create policy room_players_delete_self on room_players for delete to authenticated using (player_id = auth.uid());
create policy room_players_delete_host on room_players for delete to authenticated using (
  exists (select 1 from rooms r where r.id = room_id and r.host_id = auth.uid())
);

-- RLS: rounds — members can select; rounds_public view masks the prompt column
create policy rounds_select on rounds for select to authenticated using (
  exists (select 1 from room_players rp where rp.room_id = rounds.room_id and rp.player_id = auth.uid())
);
-- No INSERT/UPDATE/DELETE policies — writes via SECURITY DEFINER functions and service role only.

-- RLS: round_prompt_tokens — only visible in reveal/game_over
create policy round_prompt_tokens_select on round_prompt_tokens for select to authenticated using (
  exists (
    select 1 from rounds r
    join rooms rm on rm.id = r.room_id
    where r.id = round_prompt_tokens.round_id
      and rm.phase in ('reveal', 'game_over')
      and exists (select 1 from room_players rp where rp.room_id = rm.id and rp.player_id = auth.uid())
  )
);

-- RLS: guesses
create policy guesses_select_own on guesses for select to authenticated using (player_id = auth.uid());
create policy guesses_select_reveal on guesses for select to authenticated using (
  exists (
    select 1 from rounds r
    join rooms rm on rm.id = r.room_id
    where r.id = guesses.round_id
      and rm.phase in ('reveal', 'game_over')
      and exists (select 1 from room_players rp where rp.room_id = rm.id and rp.player_id = auth.uid())
  )
);
-- INSERT is via submit_guess SECURITY DEFINER function, so no INSERT policy for clients.

-- generate_room_code: unique 4-char uppercase code from consonants + AEIO
create or replace function generate_room_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chars constant text := 'BCDFGHJKLMNPRSTVWXYZAEIO';
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if not exists (select 1 from rooms where rooms.code = code) then
      return code;
    end if;
    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'could not generate unique room code after 10 attempts';
    end if;
  end loop;
end;
$$;
revoke all on function generate_room_code() from public;
grant execute on function generate_room_code() to authenticated;

-- start_round: host-only, advances phase to 'generating' and creates round stub
create or replace function start_round(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_round_id uuid;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then raise exception 'room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'only host can start'; end if;
  if v_room.phase not in ('lobby', 'reveal') then
    raise exception 'cannot start round from phase %', v_room.phase;
  end if;

  update rooms
    set phase = 'generating',
        round_num = round_num + 1,
        phase_ends_at = null
    where id = p_room_id;

  insert into rounds (room_id, round_num, prompt)
    values (p_room_id, v_room.round_num + 1, '')
    returning id into v_round_id;

  return v_round_id;
end;
$$;
revoke all on function start_round(uuid) from public;
grant execute on function start_round(uuid) to authenticated;

-- submit_guess: validates phase + membership, enforces one-guess-per-round
create or replace function submit_guess(p_round_id uuid, p_guess text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms;
  v_guess_id uuid;
begin
  if char_length(p_guess) < 1 or char_length(p_guess) > 200 then
    raise exception 'guess length invalid';
  end if;

  select rm.* into v_room
  from rounds r join rooms rm on rm.id = r.room_id
  where r.id = p_round_id;
  if not found then raise exception 'round not found'; end if;

  if v_room.phase <> 'guessing' or v_room.phase_ends_at <= now() then
    raise exception 'guessing closed';
  end if;

  if not exists (select 1 from room_players rp where rp.room_id = v_room.id and rp.player_id = auth.uid()) then
    raise exception 'not in room';
  end if;

  insert into guesses (round_id, player_id, guess)
    values (p_round_id, auth.uid(), p_guess)
    on conflict (round_id, player_id) do nothing
    returning id into v_guess_id;

  if v_guess_id is null then
    raise exception 'already guessed this round';
  end if;

  return v_guess_id;
end;
$$;
revoke all on function submit_guess(uuid, text) from public;
grant execute on function submit_guess(uuid, text) to authenticated;

-- Storage bucket: round-images (public read, service-role write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'round-images',
  'round-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Storage policy: anyone can read images; service_role bypasses RLS for writes.
create policy round_images_public_read on storage.objects for select using (bucket_id = 'round-images');
