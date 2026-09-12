-- ============================================================
-- HelloPx - Phase 6
-- Create appointment request using existing identities
-- ============================================================
--
-- Reuses:
-- - existing patient
-- - existing contact
-- - existing contact_phone
-- - existing patient_contact relationship
--
-- Creates:
-- - appointment_request
-- - optional intake answers
--
-- ============================================================

create or replace function public.create_appointment_request_for_existing_contact(
  p_patient_id uuid,
  p_contact_id uuid,
  p_origin_contact_phone_id uuid,
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
  v_request_id uuid;

  v_answer jsonb;
  v_intake_field_id uuid;
  v_field_key text;
  v_field_label text;
  v_value text;
begin

  -- ==========================================================
  -- 1. Resolve tenant
  -- ==========================================================

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


  -- ==========================================================
  -- 2. Validate status
  -- ==========================================================

  if p_status not in (
    'NEW',
    'WAITING_DEPOSIT',
    'DEPOSIT_CONFIRMED',
    'WAITING_SCHEDULING',
    'CONFIRMED',
    'CANCELLED'
  ) then
    raise exception 'Invalid appointment request status';
  end if;


  -- ==========================================================
  -- 3. Validate patient/contact relationship
  --
  -- This simultaneously proves:
  -- - patient exists
  -- - contact exists
  -- - both belong to this doctor
  -- - contact is related to patient
  -- ==========================================================

  if not exists (
    select 1
    from public.patient_contacts pc
    where pc.doctor_id = v_doctor_id
      and pc.patient_id = p_patient_id
      and pc.contact_id = p_contact_id
  ) then
    raise exception
      'Contact is not related to patient for this doctor';
  end if;


  -- ==========================================================
  -- 4. Validate originating phone
  --
  -- Phone must belong to the same contact and doctor.
  -- ==========================================================

  if not exists (
    select 1
    from public.contact_phones cp
    where cp.id = p_origin_contact_phone_id
      and cp.contact_id = p_contact_id
      and cp.doctor_id = v_doctor_id
  ) then
    raise exception
      'Origin phone does not belong to contact for this doctor';
  end if;


  -- ==========================================================
  -- 5. Validate appointment type
  -- ==========================================================

  if p_appointment_type_id is not null
     and not exists (
       select 1
       from public.appointment_types at
       where at.id = p_appointment_type_id
         and at.doctor_id = v_doctor_id
     ) then
    raise exception
      'Appointment type does not belong to doctor';
  end if;


  -- ==========================================================
  -- 6. Create request
  -- ==========================================================

  insert into public.appointment_requests (
    doctor_id,
    patient_id,
    origin_contact_id,
    origin_contact_phone_id,
    appointment_type_id,
    status
  )
  values (
    v_doctor_id,
    p_patient_id,
    p_contact_id,
    p_origin_contact_phone_id,
    p_appointment_type_id,
    p_status
  )
  returning id into v_request_id;


  -- ==========================================================
  -- 7. Intake answers
  --
  -- Expected JSON:
  --
  -- [
  --   {
  --     "intake_field_id": "...",
  --     "field_key": "origin_city",
  --     "field_label": "Ciudad de origen",
  --     "value": "Escuinapa"
  --   }
  -- ]
  -- ==========================================================

  if p_intake_answers is null then
    p_intake_answers := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_intake_answers) <> 'array' then
    raise exception 'p_intake_answers must be a JSON array';
  end if;


  for v_answer in
    select value
    from jsonb_array_elements(p_intake_answers)
  loop

    v_field_key :=
      nullif(trim(v_answer ->> 'field_key'), '');

    v_field_label :=
      nullif(trim(v_answer ->> 'field_label'), '');

    v_value :=
      v_answer ->> 'value';


    if v_answer ? 'intake_field_id'
       and nullif(v_answer ->> 'intake_field_id', '') is not null then

      begin
        v_intake_field_id :=
          (v_answer ->> 'intake_field_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'Invalid intake_field_id';
      end;

    else
      v_intake_field_id := null;
    end if;


    if v_field_key is null then
      raise exception 'Intake answer field_key is required';
    end if;

    if v_field_label is null then
      raise exception 'Intake answer field_label is required';
    end if;


    if v_intake_field_id is not null
       and not exists (
         select 1
         from public.assistant_intake_fields aif
         where aif.id = v_intake_field_id
           and aif.doctor_id = v_doctor_id
       ) then
      raise exception
        'Intake field does not belong to doctor';
    end if;


    insert into public.appointment_request_intake_answers (
      doctor_id,
      request_id,
      intake_field_id,
      field_key,
      field_label,
      value
    )
    values (
      v_doctor_id,
      v_request_id,
      v_intake_field_id,
      v_field_key,
      v_field_label,
      v_value
    );

  end loop;


  return v_request_id;

end;
$$;


revoke all
on function public.create_appointment_request_for_existing_contact(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  uuid
)
from public;


grant execute
on function public.create_appointment_request_for_existing_contact(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  uuid
)
to authenticated;


comment on function public.create_appointment_request_for_existing_contact(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  uuid
)
is
  'Creates an appointment request using an existing HelloPx patient, contact, phone and patient-contact relationship. Validates tenant ownership and creates optional intake answers atomically.';