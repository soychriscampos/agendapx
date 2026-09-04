-- AgendaPX
-- Foundation: identity, roles and doctor tenancy.

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

create type public.user_role as enum (
  'MASTER',
  'DOCTOR'
);

create type public.doctor_status as enum (
  'ACTIVE',
  'INACTIVE'
);

-- ---------------------------------------------------------------------------
-- DOCTORS
-- One row represents one AgendaPX tenant / medical practice.
-- ---------------------------------------------------------------------------

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  status public.doctor_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- USERS
-- public.users.id is the same UUID as auth.users.id.
--
-- MASTER:
--   doctor_id must be NULL.
--
-- DOCTOR:
--   doctor_id must reference one doctor tenant.
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete restrict,
  role public.user_role not null,
  full_name text not null,
  created_at timestamptz not null default now(),

  constraint users_role_doctor_consistency
    check (
      (role = 'MASTER' and doctor_id is null)
      or
      (role = 'DOCTOR' and doctor_id is not null)
    )
);

create index users_doctor_id_idx
  on public.users (doctor_id);

-- ---------------------------------------------------------------------------
-- PRIVATE AUTHORIZATION HELPERS
--
-- These functions live outside the exposed public schema.
-- They are used by RLS policies to resolve the current AgendaPX user without
-- creating recursive RLS lookups on public.users.
-- ---------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;

grant usage on schema private to authenticated;

create function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users u
  where (select auth.uid()) is not null
    and u.id = (select auth.uid())
  limit 1;
$$;

create function private.current_doctor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.doctor_id
  from public.users u
  where (select auth.uid()) is not null
    and u.id = (select auth.uid())
  limit 1;
$$;

revoke all on function private.current_user_role() from public;
revoke all on function private.current_doctor_id() from public;

grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_doctor_id() to authenticated;

-- ---------------------------------------------------------------------------
-- DATA API PRIVILEGES
--
-- AgendaPX was created with "Automatically expose new tables" disabled.
-- Therefore privileges are granted explicitly.
--
-- Phase 1 only requires authenticated users to read these tables.
-- Mutation policies will be added only when the corresponding product flow
-- exists.
-- ---------------------------------------------------------------------------

revoke all on table public.doctors from anon;
revoke all on table public.users from anon;

grant select on table public.doctors to authenticated;
grant select on table public.users to authenticated;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.doctors enable row level security;
alter table public.users enable row level security;

-- MASTER can read every doctor.
-- DOCTOR can read only its own tenant.

create policy "doctors_select_by_tenant"
on public.doctors
for select
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or id = private.current_doctor_id()
);

-- MASTER can read every AgendaPX user.
-- A DOCTOR can read only its own application user record.

create policy "users_select_self_or_master"
on public.users
for select
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or id = (select auth.uid())
);