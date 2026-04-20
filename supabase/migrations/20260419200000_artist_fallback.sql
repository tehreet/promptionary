-- Artist-mode resilience: when the artist ghosts the prompting timer entirely
-- (nothing typed, no submission), the host's tab calls /api/artist-gave-up to
-- hand the round off to Gemini's party-mode author. This column flags those
-- rounds so the reveal can show a "🤖 The AI took over" badge — we keep
-- artist_player_id pointing at the (absent) artist since scoring (avg of
-- guessers) still lands on them.

alter table rounds
  add column if not exists ai_took_over boolean not null default false;

comment on column rounds.ai_took_over is
  'Artist-mode only: true when the artist ghosted and Gemini authored the prompt instead.';

-- Re-declare rounds_public to include the new flag. Drop/recreate matches
-- the pattern used when chosen_modifier was added — can't just alter a view
-- in place and keep column ordering stable.
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
  r.chosen_modifier,
  r.chosen_modifier_spectator_id,
  -- Taboo and ai_took_over are metadata players see live — no phase gate.
  r.taboo_words,
  r.ai_took_over
from rounds r
join rooms rm on rm.id = r.room_id;
