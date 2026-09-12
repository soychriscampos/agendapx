-- Phase 7 — Prepare booking from voice call
--
-- Server-side transactional preparation for Retell/voice flows.
--
-- Responsibilities:
-- - idempotency by doctor_id + source_external_id
-- - reuse/create contact from phone
-- - reuse/create patient
-- - ensure patient/contact relationship
-- - validate appointment type
-- - persist intake answers using DB-owned field metadata
-- - evaluate whether any active deposit rule applies
-- - create appointment_request atomically
--
-- This RPC does NOT create an appointment.
-- Final booking remains responsibility of:
-- public.book_appointment_from_request(...)

begin;

create or replace function public.prepare_booking_from_call(
  p_doctor_id uuid,
  p_source_external_id text,
  p_contact_name text,
  p_phone_e164 text,
  p_patient_name text,
  p_relationship text,
  p_appointment_type_id uuid,
  p_intake_answers jsonb default '[]'::jsonb,
  p_patient_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_request public.appointment_requests%rowtype;

  v_contact_id uuid;
  v_contact_phone_id uuid;
  v_patient_id uuid;

  v_candidate_patient_id uuid;
  v_candidate_count integer;

  v_request_id uuid;
  v_request_status text;

  v_answer jsonb;
  v_intake_field_id uuid;
  v_intake_value text;
  v_field_key text;
  v_field_label text;

  v_requires_deposit boolean := false;
begin

  -- =======================================================
  -- 1. Basic validation
  -- =======================================================

  if p_doctor_id is null then
    raise exception 'Doctor is required';
  end if;

  if not exists (
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.status = 'ACTIVE'
  ) then
    raise exception 'Doctor not found or inactive';
  end if;

  if nullif(btrim(p_source_external_id), '') is null then
    raise exception 'source_external_id is required';
  end if;

  if p_phone_e164 is null
     or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Phone must use E.164 format';
  end if;

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

  if p_appointment_type_id is null then
    raise exception 'Appointment type is required';
  end if;

  if not exists (
    select 1
    from public.appointment_types at
    where at.id = p_appointment_type_id
      and at.doctor_id = p_doctor_id
      and at.is_active = true
  ) then
    raise exception 'Appointment type not found or inactive';
  end if;

  if p_intake_answers is null then
    p_intake_answers := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_intake_answers) <> 'array' then
    raise exception 'p_intake_answers must be a JSON array';
  end if;


  -- =======================================================
  -- 2. Serialize retries for the same external call
  -- =======================================================
  --
  -- Retell may retry a tool invocation after timeout.
  -- Only one execution for the same doctor + call may prepare
  -- the request at a time.
  -- =======================================================

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_doctor_id::text || ':call:' || btrim(p_source_external_id),
      0
    )
  );


  -- =======================================================
  -- 3. Idempotency
  -- =======================================================

  select *
  into v_existing_request
  from public.appointment_requests ar
  where ar.doctor_id = p_doctor_id
    and ar.source_external_id = btrim(p_source_external_id)
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_existing_request.id,
      'patient_id', v_existing_request.patient_id,
      'contact_id', v_existing_request.origin_contact_id,
      'contact_phone_id', v_existing_request.origin_contact_phone_id,
      'appointment_type_id', v_existing_request.appointment_type_id,
      'requires_deposit',
        v_existing_request.status = 'WAITING_DEPOSIT',
      'request_status', v_existing_request.status
    );
  end if;


  -- =======================================================
  -- 4. Serialize identity resolution for same phone
  -- =======================================================
  --
  -- Different simultaneous calls from the same phone should
  -- not create duplicate contacts before the unique phone
  -- constraint can intervene.
  -- =======================================================

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_doctor_id::text || ':phone:' || p_phone_e164,
      0
    )
  );


  -- =======================================================
  -- 5. Resolve or create contact
  -- =======================================================

  select
    cp.contact_id,
    cp.id
  into
    v_contact_id,
    v_contact_phone_id
  from public.contact_phones cp
  where cp.doctor_id = p_doctor_id
    and cp.phone_e164 = p_phone_e164
  limit 1;

  if not found then

    if nullif(btrim(p_contact_name), '') is null then
      raise exception 'Contact name is required for a new contact';
    end if;

    insert into public.contacts (
      doctor_id,
      full_name
    )
    values (
      p_doctor_id,
      btrim(p_contact_name)
    )
    returning id
    into v_contact_id;

    insert into public.contact_phones (
      doctor_id,
      contact_id,
      phone_e164
    )
    values (
      p_doctor_id,
      v_contact_id,
      p_phone_e164
    )
    returning id
    into v_contact_phone_id;

  end if;


  -- =======================================================
  -- 6. Resolve patient
  -- =======================================================
  --
  -- Priority:
  --
  -- A) explicit patient_id already resolved by HelloPx
  -- B) existing SELF relationship for this caller
  -- C) exactly one already-related patient with matching name
  -- D) create a new patient
  --
  -- We intentionally do NOT search every patient belonging to
  -- the doctor just by name. That could incorrectly merge two
  -- different people with the same name.
  -- =======================================================

  if p_patient_id is not null then

    select p.id
    into v_patient_id
    from public.patients p
    where p.id = p_patient_id
      and p.doctor_id = p_doctor_id;

    if not found then
      raise exception 'Patient does not belong to doctor';
    end if;

  else

    -- -------------------------------------------------------
    -- Existing SELF patient for this contact
    -- -------------------------------------------------------

    if p_relationship = 'SELF' then

      select
        count(*)::integer,
        max(pc.patient_id::text)::uuid
      into
        v_candidate_count,
        v_candidate_patient_id
      from public.patient_contacts pc
      where pc.doctor_id = p_doctor_id
        and pc.contact_id = v_contact_id
        and pc.relationship = 'SELF';

      if v_candidate_count = 1 then
        v_patient_id := v_candidate_patient_id;
      end if;

    end if;


    -- -------------------------------------------------------
    -- If not SELF-resolved, reuse only when exactly one
    -- patient already linked to this contact matches name.
    -- -------------------------------------------------------

    if v_patient_id is null
       and nullif(btrim(p_patient_name), '') is not null then

      select
        count(*)::integer,
        max(p.id::text)::uuid
      into
        v_candidate_count,
        v_candidate_patient_id
      from public.patient_contacts pc
      join public.patients p
        on p.id = pc.patient_id
       and p.doctor_id = pc.doctor_id
      where pc.doctor_id = p_doctor_id
        and pc.contact_id = v_contact_id
        and lower(btrim(p.full_name))
            = lower(btrim(p_patient_name));

      if v_candidate_count = 1 then
        v_patient_id := v_candidate_patient_id;
      end if;

    end if;


    -- -------------------------------------------------------
    -- Otherwise create new patient
    -- -------------------------------------------------------

    if v_patient_id is null then

      if nullif(btrim(p_patient_name), '') is null then
        raise exception 'Patient name is required';
      end if;

      insert into public.patients (
        doctor_id,
        full_name
      )
      values (
        p_doctor_id,
        btrim(p_patient_name)
      )
      returning id
      into v_patient_id;

    end if;

  end if;


  -- =======================================================
  -- 7. Ensure patient/contact relationship
  -- =======================================================

  if not exists (
    select 1
    from public.patient_contacts pc
    where pc.doctor_id = p_doctor_id
      and pc.patient_id = v_patient_id
      and pc.contact_id = v_contact_id
  ) then

    insert into public.patient_contacts (
      doctor_id,
      patient_id,
      contact_id,
      relationship
    )
    values (
      p_doctor_id,
      v_patient_id,
      v_contact_id,
      p_relationship
    );

  end if;


  -- =======================================================
  -- 8. Create request initially as NEW
  -- =======================================================

  insert into public.appointment_requests (
    doctor_id,
    patient_id,
    origin_contact_id,
    origin_contact_phone_id,
    appointment_type_id,
    status,
    source_external_id
  )
  values (
    p_doctor_id,
    v_patient_id,
    v_contact_id,
    v_contact_phone_id,
    p_appointment_type_id,
    'NEW',
    btrim(p_source_external_id)
  )
  returning id
  into v_request_id;


  -- =======================================================
  -- 9. Persist intake answers
  -- =======================================================
  --
  -- Retell supplies only:
  --
  -- {
  --   "intake_field_id": "...",
  --   "value": "..."
  -- }
  --
  -- field_key and field_label are loaded from HelloPx so the
  -- caller cannot forge the snapshot metadata.
  -- =======================================================

  for v_answer in
    select value
    from jsonb_array_elements(p_intake_answers)
  loop

    if nullif(v_answer ->> 'intake_field_id', '') is null then
      raise exception 'intake_field_id is required';
    end if;

    begin
      v_intake_field_id :=
        (v_answer ->> 'intake_field_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Invalid intake_field_id';
    end;

    v_intake_value := v_answer ->> 'value';

    select
      aif.field_key,
      aif.label
    into
      v_field_key,
      v_field_label
    from public.assistant_intake_fields aif
    where aif.id = v_intake_field_id
      and aif.doctor_id = p_doctor_id
      and aif.is_active = true;

    if not found then
      raise exception 'Intake field not found or inactive';
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
      p_doctor_id,
      v_request_id,
      v_intake_field_id,
      v_field_key,
      v_field_label,
      v_intake_value
    );

  end loop;


  -- =======================================================
  -- 10. Validate required intake fields
  -- =======================================================

  if exists (
    select 1
    from public.assistant_intake_fields aif
    where aif.doctor_id = p_doctor_id
      and aif.is_active = true
      and aif.is_required = true
      and not exists (
        select 1
        from public.appointment_request_intake_answers aria
        where aria.request_id = v_request_id
          and aria.doctor_id = p_doctor_id
          and aria.intake_field_id = aif.id
          and nullif(btrim(coalesce(aria.value, '')), '') is not null
      )
  ) then
    raise exception 'Required intake answers are missing';
  end if;


  -- =======================================================
  -- 11. Evaluate deposit rules
  -- =======================================================
  --
  -- Phase 7 only needs a boolean decision:
  --
  -- ANY matching active rule
  --      ↓
  -- WAITING_DEPOSIT
  --
  -- Monetary precedence belongs to Phase 8.
  -- =======================================================

  select exists (
    select 1
    from public.deposit_rules dr
    where dr.doctor_id = p_doctor_id
      and dr.is_active = true
      and (
        dr.scope = 'ALL'

        or (
          dr.scope = 'APPOINTMENT_TYPE'
          and dr.appointment_type_id = p_appointment_type_id
        )

        or (
          dr.scope = 'INTAKE_FIELD'
          and exists (
            select 1
            from public.appointment_request_intake_answers aria
            where aria.request_id = v_request_id
              and aria.doctor_id = p_doctor_id
              and aria.intake_field_id = dr.intake_field_id
              and dr.operator = 'EQUALS'
              and btrim(coalesce(aria.value, ''))
                  = btrim(coalesce(dr.condition_value, ''))
          )
        )
      )
  )
  into v_requires_deposit;


  -- =======================================================
  -- 12. Final request state
  -- =======================================================

  if v_requires_deposit then
    v_request_status := 'WAITING_DEPOSIT';
  else
    v_request_status := 'NEW';
  end if;

  update public.appointment_requests
  set
    status = v_request_status,
    updated_at = now()
  where id = v_request_id;


  -- =======================================================
  -- 13. Stable response contract
  -- =======================================================

  return jsonb_build_object(
    'ok',
      case
        when v_requires_deposit then false
        else true
      end,

    'idempotent', false,

    'requires_deposit', v_requires_deposit,

    'request_id', v_request_id,
    'patient_id', v_patient_id,
    'contact_id', v_contact_id,
    'contact_phone_id', v_contact_phone_id,
    'appointment_type_id', p_appointment_type_id,
    'request_status', v_request_status
  );

end;
$$;


-- =========================================================
-- 14. Security
-- =========================================================
--
-- This RPC is exclusively for the HelloPx server integration.
-- Browsers, DOCTOR and MASTER sessions must continue using
-- their existing Fase 6 flows.
-- =========================================================

revoke all
on function public.prepare_booking_from_call(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  uuid
)
from public;

revoke all
on function public.prepare_booking_from_call(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  uuid
)
from anon;

revoke all
on function public.prepare_booking_from_call(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  uuid
)
from authenticated;

grant execute
on function public.prepare_booking_from_call(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  uuid
)
to service_role;

commit;