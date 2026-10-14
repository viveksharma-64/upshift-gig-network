-- ================================================================
-- UpShift – Complete Supabase Schema Baseline
-- ================================================================

-- 1. Profiles table (extends auth.users)
create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  full_name   text,
  role        text not null default 'learner' check (role in ('admin', 'learner')),
  avatar_url  text,
  track_id    text,                          -- preferred track M1-M6
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 2. Gigs table (opportunity directory)
create table if not exists public.gigs (
  id                  uuid primary key default gen_random_uuid(),
  external_gig_id     text,
  title               text not null,
  track_id            text not null check (track_id in ('M1', 'M2', 'M3', 'M4', 'M5', 'M6')),
  payment_amount      text not null,
  compensation_type   text default 'hourly',
  min_amount          numeric default 0,
  max_amount          numeric default 0,
  currency            text default 'USD',
  priority            text default 'Standard',
  is_featured         boolean default false,
  is_local_business   boolean default false,
  posted_at           date default current_date,
  origin_url          text not null,
  short_description   text,
  overview            text,
  responsibilities    text,
  deliverables        text,
  requirements        text,
  proof_spec          text,
  status              text default 'Active',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.gigs enable row level security;

-- 3. Non-recursive admin check function
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

-- 4. Trigger to prevent unauthorized role escalation on public.profiles
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

-- 5. RLS Policies on profiles
create policy "Users can view own profile or admins view all"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (
    (auth.uid() = id and role = 'learner')
    or public.is_admin()
  );

-- 6. RLS Policies on gigs
-- SELECT: Public visitors and learners see active published gigs; admins see all
create policy "Read published gigs"
  on public.gigs for select
  using (
    coalesce(status, 'Active') = 'Active'
    or public.is_admin()
  );

create policy "Admins can insert gigs"
  on public.gigs for insert
  with check (public.is_admin());

create policy "Admins can update gigs"
  on public.gigs for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete gigs"
  on public.gigs for delete
  using (public.is_admin());

-- 7. Permissions & Grants
revoke all on table public.gigs from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
revoke truncate on table public.gigs from public, anon, authenticated;
revoke truncate on table public.profiles from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on table public.gigs to anon;
grant select, insert, update, delete on table public.gigs to authenticated;
grant select, insert, update on table public.profiles to authenticated;
revoke all on function public.protect_profile_role() from public, anon, authenticated;
grant execute on function public.is_admin to anon, authenticated;

-- 8. Auto-create profile on signup via trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'learner' -- STRICT SECURITY: All signups default to learner
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 9. Indexes
create index if not exists idx_gigs_created_at on public.gigs(created_at desc);
create index if not exists idx_gigs_track_id on public.gigs(track_id);
create index if not exists idx_gigs_status on public.gigs(status);
create index if not exists idx_gigs_external_id on public.gigs(external_gig_id);
