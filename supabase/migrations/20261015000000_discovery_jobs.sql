-- ====================================================================
-- PROPOSED MIGRATION: DISCOVERY & HEALTH MONITORING JOBS TABLE
-- File: supabase/migrations/20261015000000_discovery_jobs.sql
-- ====================================================================
-- Purpose:
--   Durable job queue and coordination table for scheduled and
--   admin-triggered discovery runs and daily health checks.
--
-- STATUS:
--   DRAFT FOR CODE REVIEW ONLY. DO NOT APPLY TO PRODUCTION UNTIL
--   FORMAL REVIEW AND EXPLICIT APPROVAL ARE GRANTED.
-- ====================================================================

-- --------------------------------------------------------------------
-- STEP 1: Create public.discovery_jobs table
-- --------------------------------------------------------------------
create table if not exists public.discovery_jobs (
  id                  text primary key default ('job_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 8)),
  trigger_type        text not null check (trigger_type in ('scheduled', 'admin')),
  requested_by_id     uuid references auth.users(id) on delete set null,
  job_type            text not null check (job_type in ('discovery', 'health_check')),
  status              text not null default 'pending'
                      check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  params              jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  heartbeat_at        timestamptz,
  lease_expires_at    timestamptz,
  claimed_by          text,
  result_summary      jsonb default '{}'::jsonb,
  error_message       text,
  updated_at          timestamptz default now()
);

-- --------------------------------------------------------------------
-- STEP 2: Indexes for job queue polling and metrics
-- --------------------------------------------------------------------
create index if not exists idx_discovery_jobs_status on public.discovery_jobs(status);
create index if not exists idx_discovery_jobs_type on public.discovery_jobs(job_type);
create index if not exists idx_discovery_jobs_created on public.discovery_jobs(created_at desc);
create index if not exists idx_discovery_jobs_lease on public.discovery_jobs(lease_expires_at);

-- --------------------------------------------------------------------
-- STEP 3: Atomic Claim Function with SKIP LOCKED (Concurrency Protection)
-- --------------------------------------------------------------------
create or replace function public.claim_discovery_job(
  p_worker_id text,
  p_lease_seconds int default 900
)
returns setof public.discovery_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.discovery_jobs;
begin
  select *
  into v_job
  from public.discovery_jobs
  where status = 'pending'
     or (status = 'running' and lease_expires_at < now())
  order by created_at asc
  limit 1
  for update skip locked;

  if found then
    update public.discovery_jobs
    set status = 'running',
        claimed_by = p_worker_id,
        started_at = coalesce(started_at, now()),
        heartbeat_at = now(),
        lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
        updated_at = now()
    where id = v_job.id
    returning * into v_job;

    return next v_job;
  end if;

  return;
end;
$$;

-- --------------------------------------------------------------------
-- STEP 4: Row Level Security on public.discovery_jobs
-- --------------------------------------------------------------------
alter table public.discovery_jobs enable row level security;

-- Drop legacy policies idempotently
drop policy if exists "Admins can view discovery_jobs" on public.discovery_jobs;
drop policy if exists "Admins can insert discovery_jobs" on public.discovery_jobs;
drop policy if exists "Admins can update discovery_jobs" on public.discovery_jobs;

-- Explicit RLS: Only verified administrators can view and insert jobs
create policy "Admins can view discovery_jobs"
  on public.discovery_jobs for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert discovery_jobs"
  on public.discovery_jobs for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update discovery_jobs"
  on public.discovery_jobs for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --------------------------------------------------------------------
-- STEP 5: Privilege Grants & Function Hardening
-- --------------------------------------------------------------------
revoke all on table public.discovery_jobs from public, anon;
grant select, insert, update on table public.discovery_jobs to authenticated;
grant select, insert, update, delete on table public.discovery_jobs to service_role;

-- Strictly revoke execute on security-definer claim function from all public roles
revoke all on function public.claim_discovery_job(text, int) from public, anon, authenticated;
grant execute on function public.claim_discovery_job(text, int) to service_role;

-- Note on Backend Runner:
-- The private Node.js runner running with SUPABASE_SERVICE_ROLE_KEY
-- can execute claim_discovery_job and update completion status.
