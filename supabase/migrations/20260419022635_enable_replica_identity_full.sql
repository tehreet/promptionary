-- Supabase Realtime's Postgres Changes feed requires REPLICA IDENTITY FULL
-- on tables that have RLS policies so the server can evaluate row-level
-- access on each change event. Without this, the realtime server silently
-- drops events for RLS-gated subscribers even when they're authenticated.

alter table rooms replica identity full;
alter table room_players replica identity full;
alter table rounds replica identity full;
alter table round_prompt_tokens replica identity full;
alter table guesses replica identity full;
