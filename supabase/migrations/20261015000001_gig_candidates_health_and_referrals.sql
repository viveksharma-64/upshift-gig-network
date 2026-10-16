-- ====================================================================
-- PROPOSED MIGRATION: GIG CANDIDATES HEALTH & REFERRAL SCHEMA EXTENSION
-- File: supabase/migrations/20261015000001_gig_candidates_health_and_referrals.sql
-- ====================================================================
-- Purpose:
--   Extends public.gig_candidates staging table with missing production
--   columns for health check error tracking (monitor.js) and referral gate
--   metadata (REF-01 through REF-04).
--   Also updates check constraints for status and activity_status to allow
--   lifecycle states ('paused', 'stopped', 'Active', 'Needs Review').
--
-- STATUS:
--   REVIEWED DRAFT FOR HUMAN APPROVAL.
--   Idempotent and safe to execute against production Supabase SQL Editor.
-- ====================================================================

-- --------------------------------------------------------------------
-- STEP 1: Add missing health check monitoring and referral columns
-- --------------------------------------------------------------------
alter table public.gig_candidates add column if not exists health_check_error text;
alter table public.gig_candidates add column if not exists last_health_check_at timestamptz;
alter table public.gig_candidates add column if not exists referral_id text default '';
alter table public.gig_candidates add column if not exists referral_url text default '';
alter table public.gig_candidates add column if not exists referral_required boolean default false;
alter table public.gig_candidates add column if not exists referral_history jsonb default '[]'::jsonb;

-- --------------------------------------------------------------------
-- STEP 2: Update candidate lifecycle status check constraint
--   Allows 'paused' and 'stopped' in addition to original review statuses
-- --------------------------------------------------------------------
alter table public.gig_candidates drop constraint if exists gig_candidates_status_check;
alter table public.gig_candidates add constraint gig_candidates_status_check
  check (status in ('pending_review', 'approved', 'rejected', 'duplicate', 'needs_recheck', 'paused', 'stopped'));

-- --------------------------------------------------------------------
-- STEP 3: Update candidate activity status check constraint
--   Allows canonical FRD format ('Active', 'Paused', 'Stopped', 'Needs Review')
--   alongside lowercase equivalents for full backward compatibility
-- --------------------------------------------------------------------
alter table public.gig_candidates drop constraint if exists gig_candidates_activity_status_check;
alter table public.gig_candidates add constraint gig_candidates_activity_status_check
  check (activity_status in (
    'active', 'uncertain', 'inactive', 'paused', 'stopped', 'needs_review',
    'Active', 'Uncertain', 'Inactive', 'Paused', 'Stopped', 'Needs Review'
  ));

-- --------------------------------------------------------------------
-- STEP 4: Indexes for health check monitoring and referral lookups
-- --------------------------------------------------------------------
create index if not exists idx_gig_candidates_health_check on public.gig_candidates(last_health_check_at);
create index if not exists idx_gig_candidates_referral on public.gig_candidates(referral_id)
  where referral_id is not null and referral_id <> '';

-- --------------------------------------------------------------------
-- STEP 5: Notify PostgREST to reload schema cache immediately
-- --------------------------------------------------------------------
notify pgrst, 'reload schema';
