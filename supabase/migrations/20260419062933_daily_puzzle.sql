-- Daily puzzle: one shared prompt per UTC date, one guess per player, global
-- leaderboard, shareable result. Prompt and token roles stay server-side
-- (service-role access only) so guessing isn't compromised.

create table if not exists daily_prompts (
  date date primary key,
  prompt text not null default '',
  image_url text,
  image_storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists daily_prompt_tokens (
  date date not null references daily_prompts(date) on delete cascade,
  position int not null,
  token text not null,
  role token_role not null,
  primary key (date, position)
);

create table if not exists daily_guesses (
  id uuid primary key default gen_random_uuid(),
  date date not null references daily_prompts(date) on delete cascade,
  player_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  guess text not null check (char_length(guess) between 1 and 200),
  subject_score int not null default 0,
  style_score int not null default 0,
  semantic_score int not null default 0,
  total_score int generated always as (
    subject_score + style_score + semantic_score
  ) stored,
  submitted_at timestamptz not null default now(),
  unique (date, player_id)
);

create index if not exists daily_guesses_date_score_idx
  on daily_guesses (date, total_score desc);

-- A tiny public view that exposes only the image_url (not the prompt) so
-- clients can see the picture before guessing. The underlying table stays
-- service-role only.
create or replace view daily_puzzle as
  select date, image_url, created_at
  from daily_prompts;
grant select on daily_puzzle to authenticated, anon;

alter table daily_prompts enable row level security;
alter table daily_prompt_tokens enable row level security;
alter table daily_guesses enable row level security;

-- No select policies on daily_prompts / daily_prompt_tokens for clients —
-- service role bypasses RLS. Keeps the secret prompt truly secret.

-- Players can read every scored guess for the leaderboard.
create policy daily_guesses_select
  on daily_guesses for select to authenticated using (true);
create policy daily_guesses_select_anon
  on daily_guesses for select to anon using (true);
-- Inserts land via /api/daily/guess (service role) after scoring.
