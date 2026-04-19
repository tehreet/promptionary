-- Enable Realtime replication on gameplay tables so clients can subscribe
-- to Postgres Changes for live updates (phase transitions, new players,
-- new guesses, etc).
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table room_players;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table guesses;
