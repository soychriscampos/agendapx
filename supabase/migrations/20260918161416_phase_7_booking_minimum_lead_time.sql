-- Phase 7 — Minimum booking lead time
--
-- Changes:
-- - appointments must start at least 30 minutes in the future
-- - TOO_SOON replaces START_TIME_NOT_IN_FUTURE for this rule
-- - all other atomic booking guarantees remain unchanged

begin;

create or replace function public.book_appointment_from_request(
  p_request_id uuid,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.appointment_requests%rowtype;
  v_patient public.patients%rowtype;
  v_type public.appointment_types%rowtype;

  v_timezone text;

  v_local_start timestamp without time zone;
  v_local_end timestamp without time zone;
  v_end_at timestamptz;

  v_local_date date;
  v_weekday integer;
  v_local_start_time time without time zone;
  v_local_end_time time without time zone;

  v_schedule_start time without time zone;

  v_existing_appointment public.appointments%rowtype;
  v_created_appointment public.appointments%rowtype;
begin
  -- -------------------------------------------------------
  -- Idempotency:
  -- if this request already produced an appointment,
  -- return it instead of creating another.
  -- -------------------------------------------------------

  select *
  into v_existing_appointment
  from public.appointments
  where appointment_request_id = p_request_id
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'appointment_id', v_existing_appointment.id,
      'request_id', p_request_id,
      'start_at', v_existing_appointment.start_at,
      'end_at', v_existing_appointment.end_at,
      'status', v_existing_appointment.status
    );
  end if;


  -- -------------------------------------------------------
  -- Lock request so the same request cannot be booked
  -- concurrently by two executions.
  -- -------------------------------------------------------

  select *
  into v_request
  from public.appointment_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND'
    );
  end if;


  -- -------------------------------------------------------
  -- Phase 7 only closes normal scheduling flows.
  --
  -- WAITING_DEPOSIT must never become a confirmed
  -- appointment through this RPC.
  --
  -- DEPOSIT_CONFIRMED belongs to Phase 8; that flow can move
  -- the request to WAITING_SCHEDULING before using this RPC.
  -- -------------------------------------------------------

  if v_request.status not in ('NEW', 'WAITING_SCHEDULING') then
    return jsonb_build_object(
      'ok', false,
      'code',
        case
          when v_request.status = 'WAITING_DEPOSIT'
            then 'DEPOSIT_REQUIRED'
          when v_request.status = 'CONFIRMED'
            then 'REQUEST_ALREADY_CONFIRMED'
          when v_request.status = 'CANCELLED'
            then 'REQUEST_CANCELLED'
          else 'REQUEST_NOT_BOOKABLE'
        end,
      'request_status', v_request.status
    );
  end if;


  -- -------------------------------------------------------
  -- Appointment type is mandatory for booking.
  -- -------------------------------------------------------

  if v_request.appointment_type_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_TYPE_REQUIRED'
    );
  end if;

  select *
  into v_type
  from public.appointment_types
  where id = v_request.appointment_type_id
    and doctor_id = v_request.doctor_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_TYPE_NOT_AVAILABLE'
    );
  end if;


  -- -------------------------------------------------------
  -- Patient must belong to the same doctor.
  -- -------------------------------------------------------

  select *
  into v_patient
  from public.patients
  where id = v_request.patient_id
    and doctor_id = v_request.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PATIENT_NOT_FOUND'
    );
  end if;


  -- -------------------------------------------------------
  -- Doctor / timezone
  -- -------------------------------------------------------

  select timezone
  into v_timezone
  from public.doctors
  where id = v_request.doctor_id
    and status = 'ACTIVE';

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_NOT_AVAILABLE'
    );
  end if;

  if v_timezone is null or btrim(v_timezone) = '' then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_TIMEZONE_NOT_CONFIGURED'
    );
  end if;


  -- -------------------------------------------------------
  -- MVP minimum booking lead time.
  --
  -- Keep aligned with MIN_BOOKING_LEAD_MINUTES = 30
  -- in the application availability layer.
  --
  -- A slot exactly 30 minutes from now is allowed.
  -- -------------------------------------------------------

  if p_start_at < now() + interval '30 minutes' then
    return jsonb_build_object(
      'ok', false,
      'code', 'TOO_SOON',
      'retryable', true
    );
  end if;


  -- -------------------------------------------------------
  -- Resolve local start/end using doctor timezone.
  --
  -- End time is derived exclusively from the configured
  -- appointment duration.
  -- -------------------------------------------------------

  v_local_start := p_start_at at time zone v_timezone;

  v_local_end :=
    v_local_start
    + make_interval(mins => v_type.duration_minutes);

  v_end_at :=
    v_local_end at time zone v_timezone;

  v_local_date := v_local_start::date;

  -- ISO weekday:
  -- Monday = 1 ... Sunday = 7
  v_weekday := extract(isodow from v_local_start)::integer;

  v_local_start_time := v_local_start::time;
  v_local_end_time := v_local_end::time;


  -- -------------------------------------------------------
  -- Appointment cannot cross into another local calendar day.
  -- Mirrors existing application conflict validation.
  -- -------------------------------------------------------

  if v_local_end::date <> v_local_date then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CROSSES_DAY'
    );
  end if;


  -- -------------------------------------------------------
  -- Must fit completely inside one normal schedule window.
  --
  -- Capture that window's start because available slots are
  -- generated every 30 minutes from the beginning of each
  -- configured schedule window.
  -- -------------------------------------------------------

  select dsw.start_local
  into v_schedule_start
  from public.doctor_schedule_windows dsw
  where dsw.doctor_id = v_request.doctor_id
    and dsw.weekday = v_weekday
    and v_local_start_time >= dsw.start_local
    and v_local_end_time <= dsw.end_local
  order by dsw.start_local
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'OUTSIDE_SCHEDULE'
    );
  end if;


  -- -------------------------------------------------------
  -- Preserve current getAvailableSlots() semantics:
  -- generated slots advance every 30 minutes from the start
  -- of the configured schedule window.
  -- -------------------------------------------------------

  if mod(
    (
      extract(epoch from (v_local_start_time - v_schedule_start))
      / 60
    )::integer,
    30
  ) <> 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SLOT_ALIGNMENT'
    );
  end if;


  -- -------------------------------------------------------
  -- Recurring unavailability.
  -- -------------------------------------------------------

  if exists (
    select 1
    from public.doctor_recurring_unavailability dru
    where dru.doctor_id = v_request.doctor_id
      and dru.weekday = v_weekday
      and v_local_start_time < dru.end_local
      and v_local_end_time > dru.start_local
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'SLOT_UNAVAILABLE',
      'retryable', true
    );
  end if;


  -- -------------------------------------------------------
  -- Punctual unavailability.
  -- -------------------------------------------------------

  if exists (
    select 1
    from public.doctor_unavailability du
    where du.doctor_id = v_request.doctor_id
      and p_start_at < du.end_at
      and v_end_at > du.start_at
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'SLOT_UNAVAILABLE',
      'retryable', true
    );
  end if;


  -- -------------------------------------------------------
  -- Fast pre-check against current confirmed appointments.
  --
  -- The exclusion constraint below remains the final
  -- concurrency guarantee.
  -- -------------------------------------------------------

  if exists (
    select 1
    from public.appointments a
    where a.doctor_id = v_request.doctor_id
      and a.status = 'CONFIRMED'
      and p_start_at < a.end_at
      and v_end_at > a.start_at
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'SLOT_UNAVAILABLE',
      'retryable', true
    );
  end if;


  -- -------------------------------------------------------
  -- Create appointment.
  -- created_by_user_id intentionally remains NULL because
  -- Retell is a technical actor, not a logged-in user.
  -- -------------------------------------------------------

  begin
    insert into public.appointments (
      doctor_id,
      patient_name,
      start_at,
      end_at,
      status,
      created_source,
      created_by_user_id,
      patient_id,
      appointment_type_id,
      appointment_request_id
    )
    values (
      v_request.doctor_id,
      v_patient.full_name,
      p_start_at,
      v_end_at,
      'CONFIRMED',
      'AGENT',
      null,
      v_patient.id,
      v_type.id,
      v_request.id
    )
    returning *
    into v_created_appointment;

  exception
    when exclusion_violation then
      return jsonb_build_object(
        'ok', false,
        'code', 'SLOT_UNAVAILABLE',
        'retryable', true
      );

    when unique_violation then
      -- Another execution may have completed the same
      -- request concurrently. Return the existing result
      -- when possible.
      select *
      into v_existing_appointment
      from public.appointments
      where appointment_request_id = p_request_id
      limit 1;

      if found then
        return jsonb_build_object(
          'ok', true,
          'idempotent', true,
          'appointment_id', v_existing_appointment.id,
          'request_id', p_request_id,
          'start_at', v_existing_appointment.start_at,
          'end_at', v_existing_appointment.end_at,
          'status', v_existing_appointment.status
        );
      end if;

      raise;
  end;


  -- -------------------------------------------------------
  -- Request becomes confirmed in the same transaction.
  -- -------------------------------------------------------

  update public.appointment_requests
  set
    status = 'CONFIRMED',
    updated_at = now()
  where id = v_request.id;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'appointment_id', v_created_appointment.id,
    'request_id', v_request.id,
    'patient_id', v_patient.id,
    'appointment_type_id', v_type.id,
    'start_at', v_created_appointment.start_at,
    'end_at', v_created_appointment.end_at,
    'status', v_created_appointment.status
  );
end;
$$;


-- =========================================================
-- RPC security
-- =========================================================

revoke all on function public.book_appointment_from_request(uuid, timestamptz)
from public;

revoke all on function public.book_appointment_from_request(uuid, timestamptz)
from anon;

revoke all on function public.book_appointment_from_request(uuid, timestamptz)
from authenticated;

grant execute on function public.book_appointment_from_request(uuid, timestamptz)
to service_role;

commit;