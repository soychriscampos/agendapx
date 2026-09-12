-- ============================================================
-- HelloPx - Phase 6
-- Patients, contacts and appointment requests
-- ============================================================
--
-- Core rule:
-- phone != patient
--
-- This migration intentionally DOES NOT modify:
-- - appointments
-- - getAvailableSlots()
-- - appointment scheduling logic
-- - Phase 5 assistant configuration
--
-- ============================================================


-- ============================================================
-- 1. PATIENTS
-- ============================================================

create table public.patients (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  full_name text not null
    check (length(trim(full_name)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, doctor_id)
);

create index patients_doctor_id_idx
  on public.patients (doctor_id);

create index patients_doctor_name_idx
  on public.patients (doctor_id, full_name);


-- ============================================================
-- 2. CONTACTS
-- ============================================================
--
-- A contact is the PERSON interacting with the office.
-- It may or may not be the patient.
--
-- Example:
-- patient = María López
-- contact = Ana López
-- relationship = CHILD
-- ============================================================

create table public.contacts (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  full_name text not null
    check (length(trim(full_name)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, doctor_id)
);

create index contacts_doctor_id_idx
  on public.contacts (doctor_id);

create index contacts_doctor_name_idx
  on public.contacts (doctor_id, full_name);


-- ============================================================
-- 3. CONTACT PHONES
-- ============================================================
--
-- Phones belong to contacts, not patients.
--
-- Stored as E.164:
-- +526691234567
--
-- Within one doctor/tenant, one phone identifies one contact.
-- The same phone may exist independently under another doctor.
-- ============================================================

create table public.contact_phones (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  contact_id uuid not null,

  phone_e164 text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contact_phones_e164_check
    check (
      phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
    ),

  constraint contact_phones_contact_tenant_fk
    foreign key (contact_id, doctor_id)
    references public.contacts (id, doctor_id)
    on delete cascade,

  constraint contact_phones_doctor_phone_unique
    unique (doctor_id, phone_e164),

  unique (id, doctor_id),

  unique (id, contact_id, doctor_id)
);

create index contact_phones_doctor_id_idx
  on public.contact_phones (doctor_id);

create index contact_phones_contact_id_idx
  on public.contact_phones (contact_id);


-- ============================================================
-- 4. PATIENT <-> CONTACT RELATIONSHIP
-- ============================================================
--
-- Allows:
--
-- Juan -> Juan = SELF
-- Ana -> María = CHILD
-- Pedro -> María = PARTNER
--
-- We intentionally use text + CHECK instead of PostgreSQL enum
-- so this can evolve more easily after pilot usage.
-- ============================================================

create table public.patient_contacts (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  patient_id uuid not null,
  contact_id uuid not null,

  relationship text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint patient_contacts_relationship_check
    check (
      relationship in (
        'SELF',
        'MOTHER',
        'FATHER',
        'CHILD',
        'PARTNER',
        'RELATIVE',
        'OTHER'
      )
    ),

  constraint patient_contacts_patient_tenant_fk
    foreign key (patient_id, doctor_id)
    references public.patients (id, doctor_id)
    on delete cascade,

  constraint patient_contacts_contact_tenant_fk
    foreign key (contact_id, doctor_id)
    references public.contacts (id, doctor_id)
    on delete cascade,

  constraint patient_contacts_unique_relation
    unique (doctor_id, patient_id, contact_id),

  unique (id, doctor_id)
);

create index patient_contacts_doctor_id_idx
  on public.patient_contacts (doctor_id);

create index patient_contacts_patient_id_idx
  on public.patient_contacts (patient_id);

create index patient_contacts_contact_id_idx
  on public.patient_contacts (contact_id);


-- ============================================================
-- 5. APPOINTMENT REQUESTS
-- ============================================================
--
-- A request is NOT an appointment.
--
-- It represents the process before / while trying to create one.
--
-- Base states:
-- NEW
-- WAITING_DEPOSIT
-- DEPOSIT_CONFIRMED
-- WAITING_SCHEDULING
-- CONFIRMED
-- CANCELLED
-- ============================================================

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  patient_id uuid not null,

  origin_contact_id uuid not null,

  origin_contact_phone_id uuid not null,

  appointment_type_id uuid null
    references public.appointment_types(id)
    on delete set null,

  status text not null default 'NEW',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointment_requests_status_check
    check (
      status in (
        'NEW',
        'WAITING_DEPOSIT',
        'DEPOSIT_CONFIRMED',
        'WAITING_SCHEDULING',
        'CONFIRMED',
        'CANCELLED'
      )
    ),

  -- The originating contact MUST actually be associated
  -- with the patient under the same doctor.
  constraint appointment_requests_patient_contact_fk
    foreign key (
      doctor_id,
      patient_id,
      origin_contact_id
    )
    references public.patient_contacts (
      doctor_id,
      patient_id,
      contact_id
    ),

  -- The phone used for this request must belong to
  -- that same originating contact and doctor.
  constraint appointment_requests_origin_phone_fk
    foreign key (
      origin_contact_phone_id,
      origin_contact_id,
      doctor_id
    )
    references public.contact_phones (
      id,
      contact_id,
      doctor_id
    ),

  unique (id, doctor_id)
);

create index appointment_requests_doctor_id_idx
  on public.appointment_requests (doctor_id);

create index appointment_requests_doctor_status_idx
  on public.appointment_requests (doctor_id, status);

create index appointment_requests_patient_id_idx
  on public.appointment_requests (patient_id);

create index appointment_requests_origin_contact_id_idx
  on public.appointment_requests (origin_contact_id);

create index appointment_requests_created_at_idx
  on public.appointment_requests (doctor_id, created_at desc);


-- ============================================================
-- 6. REQUEST INTAKE ANSWERS
-- ============================================================
--
-- Phase 5 assistant_intake_fields defines QUESTIONS.
-- This table stores the ANSWERS collected for a request.
--
-- field_key and field_label are snapshots.
--
-- Therefore historical requests remain understandable even if
-- the doctor later changes the intake field configuration.
-- ============================================================

create table public.appointment_request_intake_answers (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  request_id uuid not null,

  intake_field_id uuid null
    references public.assistant_intake_fields(id)
    on delete set null,

  field_key text not null
    check (length(trim(field_key)) > 0),

  field_label text not null
    check (length(trim(field_label)) > 0),

  value text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint request_intake_answers_request_tenant_fk
    foreign key (request_id, doctor_id)
    references public.appointment_requests (id, doctor_id)
    on delete cascade,

  constraint request_intake_answers_request_field_unique
    unique (request_id, field_key)
);

create index request_intake_answers_doctor_id_idx
  on public.appointment_request_intake_answers (doctor_id);

create index request_intake_answers_request_id_idx
  on public.appointment_request_intake_answers (request_id);


-- ============================================================
-- 7. TENANT VALIDATION FOR EXISTING PHASE 5 REFERENCES
-- ============================================================
--
-- appointment_types and assistant_intake_fields already existed
-- before Phase 6.
--
-- We validate that a request cannot reference configuration
-- belonging to another doctor.
--
-- Keeping these as triggers also allows the existing records
-- to continue being deleted later with ON DELETE SET NULL.
-- ============================================================


create or replace function private.phase6_validate_request_references()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin

  if new.appointment_type_id is not null then
    if not exists (
      select 1
      from public.appointment_types at
      where at.id = new.appointment_type_id
        and at.doctor_id = new.doctor_id
    ) then
      raise exception
        'appointment_type_id does not belong to doctor_id';
    end if;
  end if;

  return new;
end;
$$;


create trigger appointment_requests_validate_references
before insert or update
on public.appointment_requests
for each row
execute function private.phase6_validate_request_references();


create or replace function private.phase6_validate_intake_answer_reference()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin

  if new.intake_field_id is not null then
    if not exists (
      select 1
      from public.assistant_intake_fields aif
      where aif.id = new.intake_field_id
        and aif.doctor_id = new.doctor_id
    ) then
      raise exception
        'intake_field_id does not belong to doctor_id';
    end if;
  end if;

  return new;
end;
$$;


create trigger appointment_request_intake_answers_validate_reference
before insert or update
on public.appointment_request_intake_answers
for each row
execute function private.phase6_validate_intake_answer_reference();


-- ============================================================
-- 8. UPDATED_AT
-- ============================================================

create or replace function private.phase6_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


create trigger patients_set_updated_at
before update on public.patients
for each row
execute function private.phase6_set_updated_at();


create trigger contacts_set_updated_at
before update on public.contacts
for each row
execute function private.phase6_set_updated_at();


create trigger contact_phones_set_updated_at
before update on public.contact_phones
for each row
execute function private.phase6_set_updated_at();


create trigger patient_contacts_set_updated_at
before update on public.patient_contacts
for each row
execute function private.phase6_set_updated_at();


create trigger appointment_requests_set_updated_at
before update on public.appointment_requests
for each row
execute function private.phase6_set_updated_at();


create trigger appointment_request_intake_answers_set_updated_at
before update on public.appointment_request_intake_answers
for each row
execute function private.phase6_set_updated_at();


-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================
--
-- Existing HelloPx tenancy pattern:
--
-- DOCTOR:
--   doctor_id = private.current_doctor_id()
--
-- MASTER:
--   may operate across doctors
-- ============================================================

alter table public.patients
  enable row level security;

alter table public.contacts
  enable row level security;

alter table public.contact_phones
  enable row level security;

alter table public.patient_contacts
  enable row level security;

alter table public.appointment_requests
  enable row level security;

alter table public.appointment_request_intake_answers
  enable row level security;


create policy "phase6_patients_tenant_access"
on public.patients
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


create policy "phase6_contacts_tenant_access"
on public.contacts
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


create policy "phase6_contact_phones_tenant_access"
on public.contact_phones
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


create policy "phase6_patient_contacts_tenant_access"
on public.patient_contacts
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


create policy "phase6_appointment_requests_tenant_access"
on public.appointment_requests
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


create policy "phase6_request_intake_answers_tenant_access"
on public.appointment_request_intake_answers
for all
to authenticated
using (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
)
with check (
  private.current_user_role() = 'MASTER'
  or doctor_id = private.current_doctor_id()
);


-- ============================================================
-- 10. GRANTS
-- ============================================================

grant select, insert, update, delete
on public.patients
to authenticated;

grant select, insert, update, delete
on public.contacts
to authenticated;

grant select, insert, update, delete
on public.contact_phones
to authenticated;

grant select, insert, update, delete
on public.patient_contacts
to authenticated;

grant select, insert, update, delete
on public.appointment_requests
to authenticated;

grant select, insert, update, delete
on public.appointment_request_intake_answers
to authenticated;


-- ============================================================
-- 11. DOCUMENTATION
-- ============================================================

comment on table public.patients is
  'Persistent administrative patient identities. Not a clinical record.';

comment on table public.contacts is
  'People who communicate with the medical office. A contact is not necessarily the patient.';

comment on table public.contact_phones is
  'Normalized E.164 phone numbers belonging to contacts.';

comment on table public.patient_contacts is
  'Relationship between a patient and a person who may manage appointments for them.';

comment on table public.appointment_requests is
  'Operational appointment request lifecycle before or during appointment confirmation.';

comment on table public.appointment_request_intake_answers is
  'Snapshot of assistant intake answers collected for a specific appointment request.';