-- DO NOT APPLY. Kept as reference for the private-channel investigation only.
-- When applied, `supabase_realtime.messages` RLS caused CHANNEL_ERROR with no
-- surfaced message on subscribe(). Live features ride public broadcast +
-- polling instead; see CLAUDE.md "Architectural notes" for the rationale.

-- Enable authorization on private Realtime channels. Every channel name
-- used in this app is "room:<uuid>" — room members can read/write messages
-- on their own room's topic; nobody else can.
--
-- realtime.messages is where Supabase records channel subscriptions and
-- broadcast envelopes. Postgres Changes subscribers have to pass the SELECT
-- check to receive WAL-sourced events on a private channel; Broadcast
-- senders have to pass the INSERT check to emit.

-- Helper: pull the room id out of a "room:<uuid>" topic. Returns null if the
-- topic isn't shaped like that.
create or replace function public.realtime_topic_room(topic text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when topic like 'room:%'
      then nullif(split_part(topic, ':', 2), '')::uuid
    else null
  end;
$$;

-- Enable RLS on realtime.messages if it isn't already. (Supabase turns it on
-- by default in recent versions, but be defensive.)
alter table realtime.messages enable row level security;

-- Drop policies if re-running (pg doesn't support create-or-replace on policies).
drop policy if exists promptionary_room_members_read on realtime.messages;
drop policy if exists promptionary_room_members_write on realtime.messages;

create policy promptionary_room_members_read
on realtime.messages for select to authenticated
using (
  (select public.is_room_member(public.realtime_topic_room(topic)))
);

create policy promptionary_room_members_write
on realtime.messages for insert to authenticated
with check (
  (select public.is_room_member(public.realtime_topic_room(topic)))
);
