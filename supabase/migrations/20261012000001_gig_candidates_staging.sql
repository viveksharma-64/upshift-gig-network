-- ====================================================================
-- DRAFT MIGRATION: GIG CANDIDATES STAGING TABLE (STRICTLY UNAPPLIED)
-- File: supabase/migrations/20261012000001_gig_candidates_staging.sql
-- ====================================================================
-- Purpose:
--   Persistent staging table for AI-discovered gig candidates.
--   Enforces strict Row-Level Security (RLS) so unapproved candidates
--   are never visible to learners or unauthenticated users.
--
-- STATUS:
--   DRAFT FOR CODE REVIEW ONLY. DO NOT APPLY TO PRODUCTION UNTIL
--   PREFLIGHT VERIFICATION SCRIPT AND MANUAL APPROVAL ARE COMPLETED.
-- ====================================================================

-- --------------------------------------------------------------------
-- STEP 1: Create canonical public.gig_candidates staging table
-- --------------------------------------------------------------------
create table if not exists public.gig_candidates (
  id                      text primary key,
  source_name             text not null,
  source_type             text not null,
  source_listing_id       text,
  original_url            text not null,
  canonical_url           text not null,
  application_url         text,
  title                   text not null,
  organization            text not null,
  description             text,
  responsibilities        text,
  requirements            text,
  payment_amount          text,
  min_amount              numeric default 0,
  max_amount              numeric default 0,
  currency                text default 'USD',
  compensation_type       text default 'hourly',
  location                text default 'Remote',
  work_arrangement        text default 'remote',
  posted_date             date,
  deadline                date,
  first_discovered_at     timestamptz default now(),
  last_checked_at         timestamptz default now(),
  track_id                text not null default 'M3'
                          check (track_id in ('M1', 'M2', 'M3', 'M4', 'M5', 'M6')),
  matched_modules         jsonb default '["M3"]'::jsonb,
  module_fit_scores       jsonb default '{}'::jsonb,
  module_evidence         jsonb default '{}'::jsonb,
  activity_status         text not null default 'uncertain'
                          check (activity_status in ('active', 'uncertain', 'inactive')),
  activity_confidence     integer default 50,
  activity_evidence       jsonb default '[]'::jsonb,
  activity_reason         text,
  module_fit_score        integer default 50,
  source_reliability      integer default 80,
  data_completeness       integer default 70,
  review_priority         integer default 60,
  duplicate_cluster_id    text,
  is_duplicate            boolean default false,
  duplicate_of            text,
  llm_provider            text,
  llm_model               text,
  llm_evaluation          jsonb,
  status                  text not null default 'pending_review' 
                          check (status in ('pending_review', 'approved', 'rejected', 'duplicate', 'needs_recheck')),
  admin_notes             text,
  rejection_reason        text,
  reviewed_by             uuid references auth.users(id),
  reviewed_at             timestamptz,
  published_gig_id        uuid references public.gigs(id),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- --------------------------------------------------------------------
-- STEP 2: Indexes for high-performance administrative filtering
-- --------------------------------------------------------------------
create index if not exists idx_gig_candidates_status on public.gig_candidates(status);
create index if not exists idx_gig_candidates_track on public.gig_candidates(track_id);
create index if not exists idx_gig_candidates_priority on public.gig_candidates(review_priority desc);
create index if not exists idx_gig_candidates_canonical on public.gig_candidates(canonical_url);
create index if not exists idx_gig_candidates_published on public.gig_candidates(published_gig_id);

-- --------------------------------------------------------------------
-- STEP 3: Row Level Security on public.gig_candidates
-- --------------------------------------------------------------------
alter table public.gig_candidates enable row level security;

-- Drop legacy/existing policies idempotently
drop policy if exists "Admins have full access to gig_candidates" on public.gig_candidates;
drop policy if exists "Admins can view gig_candidates" on public.gig_candidates;
drop policy if exists "Admins can insert gig_candidates" on public.gig_candidates;
drop policy if exists "Admins can update gig_candidates" on public.gig_candidates;
drop policy if exists "Admins can delete gig_candidates" on public.gig_candidates;

-- Explicit, least-privilege policies restricted strictly to verified admins:

-- SELECT: Only verified admins can view staged candidates. Learners and anon get 0 rows.
create policy "Admins can view gig_candidates"
  on public.gig_candidates for select
  to authenticated
  using (public.is_admin());

-- INSERT: Only verified admins can insert candidates via authenticated client.
create policy "Admins can insert gig_candidates"
  on public.gig_candidates for insert
  to authenticated
  with check (public.is_admin());

-- UPDATE: Only verified admins can update candidate review status or notes.
create policy "Admins can update gig_candidates"
  on public.gig_candidates for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: Only verified admins can remove candidates from staging.
create policy "Admins can delete gig_candidates"
  on public.gig_candidates for delete
  to authenticated
  using (public.is_admin());

-- --------------------------------------------------------------------
-- STEP 4: Privilege Revocation and Grants
-- --------------------------------------------------------------------
-- Revoke all direct privileges from public and anon
revoke all on table public.gig_candidates from public, anon;

-- Grant standard DML to authenticated role (gated by RLS policies above)
grant select, insert, update, delete on table public.gig_candidates to authenticated;
grant usage on schema public to authenticated;

-- Note on Backend Worker:
-- The discovery worker running with SUPABASE_SERVICE_ROLE_KEY automatically
-- bypasses RLS and has full write permissions to public.gig_candidates.
