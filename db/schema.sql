-- Memorial feedback schema for Supabase (Postgres).
--
-- Run this once in the Supabase SQL Editor for a fresh project. Safe to re-run;
-- every statement is idempotent.
--
-- After running:
--   * Copy your project URL       -> Vercel env SUPABASE_URL
--   * Copy the service-role key   -> Vercel env SUPABASE_SERVICE_ROLE_KEY
--     (settings -> API -> service_role. Server-side only — never expose to the browser.)
--
-- Row-level security is intentionally disabled on these tables because the
-- serverless function talks to them with the service-role key; the key
-- bypasses RLS regardless, and leaving RLS off avoids surprising "empty
-- select" behavior during local debugging.

create table if not exists feedback (
  photo       text primary key,
  doc         jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists feedback_updated_at_idx on feedback (updated_at desc);

create table if not exists rate_limits (
  key             text primary key,
  count           integer not null default 0,
  window_ends_at  timestamptz not null
);

-- Atomic per-key rate limiter. Returns true if the caller is within `p_max`
-- requests during a rolling `p_window_seconds` window, false otherwise.
create or replace function fb_rate_limit(
  p_key             text,
  p_max             integer,
  p_window_seconds  integer
) returns boolean
language plpgsql
as $$
declare
  v_now           timestamptz := now();
  v_count         integer;
  v_window_ends   timestamptz;
begin
  select count, window_ends_at
    into v_count, v_window_ends
    from rate_limits
    where key = p_key
    for update;

  if v_count is null or v_window_ends <= v_now then
    insert into rate_limits (key, count, window_ends_at)
      values (p_key, 1, v_now + make_interval(secs => p_window_seconds))
      on conflict (key) do update
        set count = 1,
            window_ends_at = v_now + make_interval(secs => p_window_seconds);
    return true;
  end if;

  update rate_limits
    set count = count + 1
    where key = p_key
    returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Housekeeping: sweep expired rate-limit rows. Optional; you can wire this to
-- a Supabase scheduled function or just run it ad-hoc.
create or replace function fb_rate_limit_sweep()
returns integer
language sql
as $$
  with removed as (
    delete from rate_limits
      where window_ends_at < now() - interval '1 hour'
      returning 1
  )
  select coalesce(count(*), 0)::integer from removed;
$$;
