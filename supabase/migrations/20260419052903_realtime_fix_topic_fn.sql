-- The previous realtime RLS pulled the topic from realtime.messages.topic,
-- but Supabase evaluates these policies via realtime.topic() — a function
-- exposing the subscriber's requested topic. Rewrite the policies to use
-- the function so subscribe + broadcast auth both work.

drop policy if exists promptionary_room_members_read on realtime.messages;
drop policy if exists promptionary_room_members_write on realtime.messages;

create policy promptionary_room_members_read
on realtime.messages for select to authenticated
using (
  (select public.is_room_member(public.realtime_topic_room(realtime.topic())))
);

create policy promptionary_room_members_write
on realtime.messages for insert to authenticated
with check (
  (select public.is_room_member(public.realtime_topic_room(realtime.topic())))
);
