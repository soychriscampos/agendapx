create or replace function public.claim_appointment_confirmation_call(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_appointment public.appointments%rowtype;
  v_doctor public.doctors%rowtype;
  v_settings public.assistant_settings%rowtype;

  v_existing_attempt public.appointment_confirmation_call_attempts%rowtype;
  v_created_attempt public.appointment_confirmation_call_attempts%rowtype;

  v_attempt_number integer;

  v_phone text;
  v_appointment_type_name text;
begin

  -- ----------------------------------------------------------
  -- Lock appointment.
  -- ----------------------------------------------------------

  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- Appointment must still occupy the slot.
  -- ----------------------------------------------------------

  if v_appointment.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CANCELLED',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Explicit patient confirmation is terminal for this cycle.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_status = 'CONFIRMED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ALREADY_CONFIRMED',
      'appointment_id', v_appointment.id
    );
  end if;


  if v_appointment.confirmation_status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CONFIRMATION_CANCELLED',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Once the appointment entered reminder/manual handoff,
  -- the original confirmation call cycle must never restart.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_status in (
    'REMINDER_PENDING',
    'REMINDER_STARTED',
    'MANUAL_REQUIRED'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CONFIRMATION_NOT_CALLABLE',
      'appointment_id', v_appointment.id,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  -- Do not confirm appointments which have already started.
  if v_appointment.start_at <= now() then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ALREADY_STARTED',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Doctor and confirmation configuration.
  -- ----------------------------------------------------------

  select *
  into v_doctor
  from public.doctors
  where id = v_appointment.doctor_id
    and status = 'ACTIVE';

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_NOT_AVAILABLE',
      'appointment_id', v_appointment.id
    );
  end if;


  select *
  into v_settings
  from public.assistant_settings
  where doctor_id = v_appointment.doctor_id;

  if not found
     or v_settings.confirmation_enabled is distinct from true then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFIRMATION_DISABLED',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Idempotency: only one active confirmation call.
  -- ----------------------------------------------------------

  select *
  into v_existing_attempt
  from public.appointment_confirmation_call_attempts aca
  where aca.appointment_id = v_appointment.id
    and aca.status in ('CREATING', 'DISPATCHED')
  order by aca.attempt_number desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CONFIRMATION_CALL_ALREADY_ACTIVE',

      'appointment_id', v_appointment.id,

      'attempt_id', v_existing_attempt.id,
      'attempt_number', v_existing_attempt.attempt_number,
      'attempt_status', v_existing_attempt.status,
      'retell_call_id', v_existing_attempt.retell_call_id
    );
  end if;


  -- ----------------------------------------------------------
  -- Resolve authoritative contact phone.
  -- ----------------------------------------------------------

  if v_appointment.appointment_request_id is not null then

    select cp.phone_e164
    into v_phone
    from public.appointment_requests ar
    join public.contact_phones cp
      on cp.id = ar.origin_contact_phone_id
     and cp.contact_id = ar.origin_contact_id
     and cp.doctor_id = ar.doctor_id
    where ar.id = v_appointment.appointment_request_id
      and ar.doctor_id = v_appointment.doctor_id;

  end if;


  if v_phone is null
     and v_appointment.patient_id is not null then

    select cp.phone_e164
    into v_phone
    from public.patient_contacts pc
    join public.contact_phones cp
      on cp.contact_id = pc.contact_id
     and cp.doctor_id = pc.doctor_id
    where pc.patient_id = v_appointment.patient_id
      and pc.doctor_id = v_appointment.doctor_id
      and pc.relationship = 'SELF'
    order by cp.created_at
    limit 1;

  end if;


  if nullif(btrim(v_phone), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONTACT_PHONE_NOT_FOUND',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Technical Retell configuration.
  -- ----------------------------------------------------------

  if nullif(btrim(v_doctor.retell_agent_id), '') is null
     or nullif(btrim(v_doctor.twilio_phone_number), '') is null then

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_NOT_CONFIGURED',
      'appointment_id', v_appointment.id
    );

  end if;


  -- ----------------------------------------------------------
  -- Optional appointment type context.
  -- ----------------------------------------------------------

  if v_appointment.appointment_type_id is not null then

    select at.name
    into v_appointment_type_name
    from public.appointment_types at
    where at.id = v_appointment.appointment_type_id
      and at.doctor_id = v_appointment.doctor_id;

  end if;


  -- ----------------------------------------------------------
  -- Create next attempt while appointment row is locked.
  -- ----------------------------------------------------------

  select coalesce(max(attempt_number), 0) + 1
  into v_attempt_number
  from public.appointment_confirmation_call_attempts
  where appointment_id = v_appointment.id;


  insert into public.appointment_confirmation_call_attempts (
    doctor_id,
    appointment_id,
    attempt_number,
    status
  )
  values (
    v_appointment.doctor_id,
    v_appointment.id,
    v_attempt_number,
    'CREATING'
  )
  returning *
  into v_created_attempt;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'CONFIRMATION_CALL_CLAIMED',

    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'attempt_id', v_created_attempt.id,
    'attempt_number', v_created_attempt.attempt_number,
    'attempt_status', v_created_attempt.status,

    'doctor_id', v_doctor.id,
    'doctor_name', v_doctor.display_name,
    'doctor_timezone', v_doctor.timezone,

    'retell_agent_id', v_doctor.retell_agent_id,
    'from_number', v_doctor.twilio_phone_number,
    'to_number', v_phone,

    'patient_name', v_appointment.patient_name,
    'appointment_type_name', v_appointment_type_name,

    'start_at', v_appointment.start_at,
    'end_at', v_appointment.end_at
  );

end;
$function$;