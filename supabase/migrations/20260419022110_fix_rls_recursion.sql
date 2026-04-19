-- The room_players_select policy self-references room_players inside EXISTS,
-- which Postgres detects as infinite recursion (42P17). Move the membership
-- check into a SECURITY DEFINER helper so the lookup bypasses RLS internally.

create or replace function is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_players
    where room_id = p_room_id and player_id = auth.uid()
  );
$$;
revoke all on function is_room_member(uuid) from public;
grant execute on function is_room_member(uuid) to authenticated;

-- Rebuild the policies that referenced room_players from room_players.
drop policy if exists room_players_select on room_players;
create policy room_players_select on room_players for select to authenticated
  using (is_room_member(room_id));

drop policy if exists rounds_select on rounds;
create policy rounds_select on rounds for select to authenticated
  using (is_room_member(room_id));

drop policy if exists round_prompt_tokens_select on round_prompt_tokens;
create policy round_prompt_tokens_select on round_prompt_tokens for select to authenticated
  using (
    exists (
      select 1 from rounds r
      join rooms rm on rm.id = r.room_id
      where r.id = round_prompt_tokens.round_id
        and rm.phase in ('reveal', 'game_over')
        and is_room_member(rm.id)
    )
  );

drop policy if exists guesses_select_reveal on guesses;
create policy guesses_select_reveal on guesses for select to authenticated
  using (
    exists (
      select 1 from rounds r
      join rooms rm on rm.id = r.room_id
      where r.id = guesses.round_id
        and rm.phase in ('reveal', 'game_over')
        and is_room_member(rm.id)
    )
  );
