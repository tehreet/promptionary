-- Room-creation rate limit: cap each IP to N rooms per window.
-- Minimal append-only log + a SECURITY DEFINER RPC that atomically counts
-- recent rows and inserts a new one (or returns false if the IP is over limit).
-- Service-role only — the RPC is invoked from the create-room server action
-- via the service client; anon/authenticated roles must not call it directly.
--
-- To tweak the limit later, edit the constants in check_and_log_room_creation
-- below (v_limit, v_window) and push a new migration.

create table if not exists room_creation_log (
  id bigserial primary key,
  ip inet not null,
  created_at timestamptz not null default now()
);

create index if not exists room_creation_log_ip_created_at_idx
  on room_creation_log (ip, created_at desc);

alter table room_creation_log enable row level security;
-- No policies: service-role bypasses RLS; nothing else should read/write.

-- Atomic count-and-log. Returns true if the caller is allowed to proceed
-- (and logs the attempt), false if they've hit the limit (and does NOT log,
-- so retries don't keep extending the window).
create or replace function check_and_log_room_creation(p_ip inet)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit constant int := 5;
  v_window constant interval := interval '1 hour';
  v_count int;
begin
  if p_ip is null then
    -- Be permissive on missing IP so we never lock out legitimate users.
    return true;
  end if;

  select count(*) into v_count
    from room_creation_log
    where ip = p_ip
      and created_at > now() - v_window;

  if v_count >= v_limit then
    return false;
  end if;

  insert into room_creation_log (ip) values (p_ip);
  return true;
end;
$$;

revoke all on function check_and_log_room_creation(inet) from public, anon, authenticated;
grant execute on function check_and_log_room_creation(inet) to service_role;

-- Retention: trim rows older than 24h. Scheduled hourly via pg_cron below.
create or replace function prune_room_creation_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from room_creation_log where created_at < now() - interval '24 hours';
$$;

revoke all on function prune_room_creation_log() from public, anon, authenticated;
grant execute on function prune_room_creation_log() to service_role;

-- Schedule pruning once per hour. pg_cron is already enabled on this project
-- (see the safety-net tick migration). Wrapped in a DO block so reruns no-op.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'prune_room_creation_log_hourly') then
      perform cron.unschedule('prune_room_creation_log_hourly');
    end if;
    perform cron.schedule(
      'prune_room_creation_log_hourly',
      '7 * * * *',
      $cron$select public.prune_room_creation_log();$cron$
    );
  end if;
end$$;
