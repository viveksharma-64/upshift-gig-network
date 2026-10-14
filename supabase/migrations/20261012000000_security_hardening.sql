-- ====================================================================
-- UpShift Security Hardening & RLS Policy Migration
-- File: supabase/migrations/20261012000000_security_hardening.sql
-- Description:
--   1. Drops ALL legacy/permissive policies dynamically on gigs and profiles.
--   2. Enforces explicit RLS on public.gigs:
--      - SELECT: Public & learners see active gigs (coalesce(status, 'Active') = 'Active'); admins see all.
--      - INSERT / UPDATE / DELETE: Strictly restricted to public.is_admin().
--   3. Enforces profile-role protection via BEFORE UPDATE trigger (trg_protect_profile_role).
--   4. Strips excessive grants from PUBLIC, anon, and authenticated.
--   5. Safely adds missing optional columns to public.gigs without data loss or locks.
--   6. Adds performance indexes on foreign keys and filter columns.
-- ====================================================================

-- --------------------------------------------------------------------
-- STEP 1: Safe Table Schema Verification & Additive Columns
-- --------------------------------------------------------------------
create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  external_gig_id text,
  title text not null,
  track_id text not null check (track_id in ('M1', 'M2', 'M3', 'M4', 'M5', 'M6')),
  payment_amount text not null,
  compensation_type text default 'hourly',
  min_amount numeric default 0,
  max_amount numeric default 0,
  currency text default 'USD',
  priority text default 'Standard',
  is_featured boolean default false,
  is_local_business boolean default false,
  posted_at date default current_date,
  origin_url text not null,
  short_description text,
  overview text,
  responsibilities text,
  deliverables text,
  requirements text,
  proof_spec text,
  status text default 'Active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Ensure all optional columns exist on existing production tables safely
alter table public.gigs add column if not exists external_gig_id text;
alter table public.gigs add column if not exists compensation_type text default 'hourly';
alter table public.gigs add column if not exists min_amount numeric default 0;
alter table public.gigs add column if not exists max_amount numeric default 0;
alter table public.gigs add column if not exists currency text default 'USD';
alter table public.gigs add column if not exists priority text default 'Standard';
alter table public.gigs add column if not exists is_featured boolean default false;
alter table public.gigs add column if not exists is_local_business boolean default false;
alter table public.gigs add column if not exists posted_at date default current_date;
alter table public.gigs add column if not exists short_description text;
alter table public.gigs add column if not exists overview text;
alter table public.gigs add column if not exists responsibilities text;
alter table public.gigs add column if not exists deliverables text;
alter table public.gigs add column if not exists requirements text;
alter table public.gigs add column if not exists proof_spec text;
alter table public.gigs add column if not exists status text default 'Active';
alter table public.gigs add column if not exists created_at timestamptz default now();
alter table public.gigs add column if not exists updated_at timestamptz default now();

-- Ensure Row Level Security is enabled
alter table public.gigs enable row level security;
alter table public.profiles enable row level security;

-- --------------------------------------------------------------------
-- STEP 2: Administrator Check Function (Security Definer)
-- --------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- --------------------------------------------------------------------
-- STEP 3: Remove All Legacy / Permissive Policies on gigs and profiles
-- --------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- Drop every existing policy on public.gigs so no permissive rule survives
  for r in (select policyname from pg_policies where schemaname = 'public' and tablename = 'gigs') loop
    execute format('drop policy if exists %I on public.gigs', r.policyname);
  end loop;

  -- Drop existing update/insert policies on public.profiles to replace with hardened versions
  for r in (select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles') loop
    execute format('drop policy if exists %I on public.profiles', r.policyname);
  end loop;
end $$;

-- --------------------------------------------------------------------
-- STEP 4: Explicit, Least-Privilege RLS Policies on public.gigs
-- --------------------------------------------------------------------
-- SELECT: Public visitors and learners can read active published gigs; admins can inspect all gigs
create policy "Read published gigs"
  on public.gigs for select
  using (
    coalesce(status, 'Active') = 'Active'
    or public.is_admin()
  );

-- INSERT: Strictly restricted to verified administrators
create policy "Admins can insert gigs"
  on public.gigs for insert
  with check (public.is_admin());

-- UPDATE: Strictly restricted to verified administrators
create policy "Admins can update gigs"
  on public.gigs for update
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: Strictly restricted to verified administrators
create policy "Admins can delete gigs"
  on public.gigs for delete
  using (public.is_admin());

-- --------------------------------------------------------------------
-- STEP 5: Hardened Role Protection on public.profiles
-- --------------------------------------------------------------------
-- Trigger function: Prevents non-admins from changing their role column
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role) and not public.is_admin() then
    raise exception 'Unauthorized: Only administrators can modify user roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
  before update on public.profiles
  for each row
  execute function public.protect_profile_role();

-- RLS: Users can view own profile or admins view all
create policy "Users can view own profile or admins view all"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- RLS: Users can update own profile (role modifications are blocked by trigger)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- RLS: Users can insert own profile, but non-admins cannot insert as admin
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (
    (auth.uid() = id and role = 'learner')
    or public.is_admin()
  );

-- --------------------------------------------------------------------
-- STEP 6: Revoke Broad Privileges and Grant Least-Privilege Access
-- --------------------------------------------------------------------
-- 1. Strip ALL privileges from PUBLIC, anon, and authenticated to eliminate inherited broad grants
revoke all on table public.gigs from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;

-- 2. Explicitly revoke TRUNCATE so it cannot be executed by non-superusers
revoke truncate on table public.gigs from public, anon, authenticated;
revoke truncate on table public.profiles from public, anon, authenticated;

-- 3. Grant schema usage
grant usage on schema public to anon, authenticated;

-- 4. Unauthenticated (anon): Read-only access to gigs (filtered by RLS)
grant select on table public.gigs to anon;

-- 5. Authenticated users:
-- - gigs: SELECT for learners; INSERT/UPDATE/DELETE strictly gated by is_admin() RLS policies
grant select, insert, update, delete on table public.gigs to authenticated;
-- - profiles: SELECT, UPDATE, INSERT strictly gated by user id & trigger
grant select, insert, update on table public.profiles to authenticated;

-- 6. Function execution privileges
revoke all on function public.protect_profile_role() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- --------------------------------------------------------------------
-- STEP 7: Performance & Integrity Indexes
-- --------------------------------------------------------------------
create index if not exists idx_gigs_created_at on public.gigs(created_at desc);
create index if not exists idx_gigs_track_id on public.gigs(track_id);
create index if not exists idx_gigs_status on public.gigs(status);
create index if not exists idx_gigs_external_id on public.gigs(external_gig_id);
