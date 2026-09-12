-- Phase 7 — Retell booking foundation
-- Adds traceability between Retell calls, appointment requests and appointments.
-- Does not implement the booking RPC yet.

begin;

-- =========================================================
-- 1. Idempotency / external call trace on appointment_requests
-- =========================================================

alter table public.appointment_requests
  add column if not exists source_external_id text;

comment on column public.appointment_requests.source_external_id is
  'External identifier for the source interaction. For Retell voice flows this stores the Retell call_id.';

-- A given external call may create at most one request per doctor.
create unique index if not exists appointment_requests_doctor_source_external_id_uidx
  on public.appointment_requests (doctor_id, source_external_id)
  where source_external_id is not null;


-- =========================================================
-- 2. Relate appointments to real entities
-- =========================================================

alter table public.appointments
  add column if not exists patient_id uuid,
  add column if not exists appointment_type_id uuid,
  add column if not exists appointment_request_id uuid;

alter table public.appointments
  drop constraint if exists appointments_patient_id_fkey;

alter table public.appointments
  add constraint appointments_patient_id_fkey
  foreign key (patient_id)
  references public.patients(id)
  on delete restrict;

alter table public.appointments
  drop constraint if exists appointments_appointment_type_id_fkey;

alter table public.appointments
  add constraint appointments_appointment_type_id_fkey
  foreign key (appointment_type_id)
  references public.appointment_types(id)
  on delete restrict;

alter table public.appointments
  drop constraint if exists appointments_appointment_request_id_fkey;

alter table public.appointments
  add constraint appointments_appointment_request_id_fkey
  foreign key (appointment_request_id)
  references public.appointment_requests(id)
  on delete restrict;

comment on column public.appointments.patient_id is
  'Patient associated with the appointment. Nullable for legacy/manual appointments.';

comment on column public.appointments.appointment_type_id is
  'Appointment type that determines booking duration. Nullable for legacy/manual appointments.';

comment on column public.appointments.appointment_request_id is
  'Request from which the appointment was confirmed. Nullable for legacy/manual appointments.';

-- A request must not generate more than one final appointment.
create unique index if not exists appointments_appointment_request_id_uidx
  on public.appointments (appointment_request_id)
  where appointment_request_id is not null;


-- =========================================================
-- 3. Guarantee 1 doctor ↔ 1 Retell agent ↔ 1 technical number
-- =========================================================

create unique index if not exists doctors_retell_agent_id_uidx
  on public.doctors (retell_agent_id)
  where retell_agent_id is not null;

create unique index if not exists doctors_twilio_phone_number_uidx
  on public.doctors (twilio_phone_number)
  where twilio_phone_number is not null;


-- =========================================================
-- 4. Basic cross-tenant integrity guards
-- =========================================================
-- PostgreSQL foreign keys alone do not guarantee that doctor_id,
-- patient_id, appointment_type_id and request_id all belong
-- to the same doctor.
--
-- That validation will be enforced in the transactional booking
-- RPC created in the next migration.

commit;