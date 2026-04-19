-- Artist Mode: one player per round writes the secret prompt, the AI paints
-- it, and everyone else guesses. Rotates through non-spectator players.

-- 1) Enum additions
alter type room_mode add value if not exists 'artist';
alter type room_phase add value if not exists 'prompting';

-- 2) Track which player is the artist for a round
alter table rounds
  add column if not exists artist_player_id uuid;
