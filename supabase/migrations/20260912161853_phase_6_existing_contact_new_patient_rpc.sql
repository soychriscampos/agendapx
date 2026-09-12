-- ============================================================
-- HelloPx - Phase 6
-- Existing contact requesting for a new patient
-- ============================================================
--
-- Reuses:
-- - existing contact
-- - existing contact_phone
--
-- Creates atomically:
-- - patient
-- - patient_contact relationship
-- - appointment_request
-- - optional intake answers
--
-- ============================================================

create or replace function public.create_appointment_request_for_new_patient(
  p_patient_name text,
  p_contact_id uuid,
  p_origin_contact_phone_id uuid,
  p_relationship text,
  p_appointment_type_id uuid default null,
  p_status text default 'NEW',
  p_intake_answers jsonb default '[]'::jsonb,
  p_doctor_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_role text;
  v_doctor_id uuid;
  v_patient_id uuid;
  v_request_id uuid;
begin

  -- ----------------------------------------------------------
  -- 1. Resolve tenant
  -- ----------------------------------------------------------

  v_role := private.current_user_role()::text;

  if v_role = 'DOCTOR' then

    v_doctor_id := private.current_doctor_id();

    if v_doctor_id is null then
      raise exception 'Authenticated doctor has no doctor_id';
    end if;

    if p_doctor_id is not null
       and p_doctor_id <> v_doctor_id then
      raise exception 'Doctor cannot create requests for another doctor';
    end if;

  elsif v_role = 'MASTER' then

    if p_doctor_id is null then
      raise exception 'MASTER must provide p_doctor_id';
    end if;

    if not exists (
      select 1
      from public.doctors d
      where d.id = p_doctor_id
    ) then
      raise exception 'Doctor not found';
    end if;

    v_doctor_id := p_doctor_id;

  else
    raise exception 'Unauthorized role';
  end if;


  -- ----------------------------------------------------------
  -- 2. Validate patient name
  -- ----------------------------------------------------------

  if nullif(trim(p_patient_name), '') is null then
    raise exception 'Patient name is required';
  end if;


  -- ----------------------------------------------------------
  -- 3. Validate relationship
  -- ----------------------------------------------------------

  if p_relationship not in (
    'SELF',
    'MOTHER',
    'FATHER',
    'CHILD',
    'PARTNER',
    'RELATIVE',
    'OTHER'
  ) then
    raise exception 'Invalid patient-contact relationship';
  end if;


  -- ----------------------------------------------------------
  -- 4. Validate existing contact
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.contacts c
    where c.id = p_contact_id
      and c.doctor_id = v_doctor_id
  ) then
    raise exception 'Contact does not belong to doctor';
  end if;


  -- ----------------------------------------------------------
  -- 5. Validate existing phone
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.contact_phones cp
    where cp.id = p_origin_contact_phone_id
      and cp.contact_id = p_contact_id
      and cp.doctor_id = v_doctor_id
  ) then
    raise exception 'Origin phone does not belong to contact for this doctor';
  end if;


  -- ----------------------------------------------------------
  -- 6. Create new patient
  -- ----------------------------------------------------------

  insert into public.patients (
    doctor_id,
    full_name
  )
  values (
    v_doctor_id,
    trim(p_patient_name)
  )
  returning id into v_patient_id;


  -- ----------------------------------------------------------
  -- 7. Relate existing contact to new patient
  -- ----------------------------------------------------------

  insert into public.patient_contacts (
    doctor_id,
    patient_id,
    contact_id,
    relationship
  )
  values (
    v_doctor_id,
    v_patient_id,
    p_contact_id,
    p_relationship
  );


  -- ----------------------------------------------------------
  -- 8. Reuse existing RPC to create request + intake answers
  --
  -- If this fails, this entire function call rolls back,
  -- including the patient and relationship created above.
  -- ----------------------------------------------------------

  v_request_id :=
    public.create_appointment_request_for_existing_contact(
      p_patient_id := v_patient_id,
      p_contact_id := p_contact_id,
      p_origin_contact_phone_id := p_origin_contact_phone_id,
      p_appointment_type_id := p_appointment_type_id,
      p_status := p_status,
      p_intake_answers := p_intake_answers,
      p_doctor_id := p_doctor_id
    );


  return v_request_id;

end;
$$;


revoke all
on function public.create_appointment_request_for_new_patient(
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  jsonb,
  uuid
)
from public;


grant execute
on function public.create_appointment_request_for_new_patient(
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  jsonb,
  uuid
)
to authenticated;


comment on function public.create_appointment_request_for_new_patient(
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  jsonb,
  uuid
)
is
  'Creates a new patient and request for an existing HelloPx contact and phone, atomically reusing the existing contact identity.';