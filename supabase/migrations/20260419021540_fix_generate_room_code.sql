-- generate_room_code had a local variable named `code` that shadowed rooms.code,
-- producing 42702 "column reference 'code' is ambiguous" on the existence check.
-- Rename the local to v_code to eliminate the shadow.

create or replace function generate_room_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chars constant text := 'BCDFGHJKLMNPRSTVWXYZAEIO';
  v_code text;
  attempt int := 0;
begin
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if not exists (select 1 from rooms where rooms.code = v_code) then
      return v_code;
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
