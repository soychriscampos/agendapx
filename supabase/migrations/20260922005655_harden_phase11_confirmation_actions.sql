-- ============================================================
-- HelloPx - Phase 11
-- Harden confirmation mutations against stale/terminal attempts
-- ============================================================


-- ============================================================
-- 1. Confirm attendance
-- ============================================================

create or replace function public.confirm_appointment_attendance(
  p_appointment_id uuid,
  p_attempt_id uuid,
  p_agent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.appointment_confirmation_call_attempts%rowtype;
  v_appointment public.appointments%rowtype;
  v_expected_agent_id text;
begin

  select *
  into v_attempt
  from public.appointment_confirmation_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FOUND'
    );
  end if;


  if v_attempt.appointment_id <> p_appointment_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_MISMATCH'
    );
  end if;


  select retell_agent_id
  into v_expected_agent_id
  from public.doctors
  where id = v_attempt.doctor_id;

  if not found
     or nullif(btrim(v_expected_agent_id), '') is null
     or btrim(v_expected_agent_id) <> btrim(p_agent_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'AGENT_MISMATCH'
    );

  end if;


  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
    and doctor_id = v_attempt.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  if v_appointment.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CANCELLED'
    );
  end if;


  -- Exact business result already persisted:
  -- harmless duplicate, even if call_ended already arrived.
  if v_appointment.confirmation_status = 'CONFIRMED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'ATTENDANCE_ALREADY_CONFIRMED',
      'appointment_id', v_appointment.id,
      'attendance_confirmed_at',
        v_appointment.attendance_confirmed_at
    );
  end if;


  -- A stale tool call from a terminal Retell attempt must not
  -- mutate the appointment.
  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_ACTIVE',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.appointments
  set
    confirmation_status = 'CONFIRMED',
    attendance_confirmed_at = now(),

    reminder_started_at = null,
    confirmation_response_due_at = null,
    confirmation_response_window_minutes_snapshot = null,
    unconfirmed_action_snapshot = null,

    updated_at = now()
  where id = v_appointment.id
  returning *
  into v_appointment;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'ATTENDANCE_CONFIRMED',
    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,
    'attendance_confirmed_at',
      v_appointment.attendance_confirmed_at
  );

end;
$function$;



-- ============================================================
-- 2. Cancel appointment
-- ============================================================

create or replace function public.cancel_appointment_from_confirmation(
  p_appointment_id uuid,
  p_attempt_id uuid,
  p_agent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.appointment_confirmation_call_attempts%rowtype;
  v_appointment public.appointments%rowtype;
  v_expected_agent_id text;
begin

  select *
  into v_attempt
  from public.appointment_confirmation_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FOUND'
    );
  end if;


  if v_attempt.appointment_id <> p_appointment_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_MISMATCH'
    );
  end if;


  select retell_agent_id
  into v_expected_agent_id
  from public.doctors
  where id = v_attempt.doctor_id;

  if not found
     or nullif(btrim(v_expected_agent_id), '') is null
     or btrim(v_expected_agent_id) <> btrim(p_agent_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'AGENT_MISMATCH'
    );

  end if;


  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
    and doctor_id = v_attempt.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  -- Exact result already persisted.
  if v_appointment.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'APPOINTMENT_ALREADY_CANCELLED',
      'appointment_id', v_appointment.id
    );
  end if;


  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_ACTIVE',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.appointments
  set
    status = 'CANCELLED',
    confirmation_status = 'CANCELLED',

    confirmation_response_due_at = null,
    confirmation_response_window_minutes_snapshot = null,
    unconfirmed_action_snapshot = null,

    updated_at = now()
  where id = v_appointment.id
  returning *
  into v_appointment;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'APPOINTMENT_CANCELLED',
    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status
  );

end;
$function$;



-- ============================================================
-- 3. Make exact rescheduling retries idempotent
-- ============================================================

create or replace function public.reschedule_appointment_from_confirmation(
  p_appointment_id uuid,
  p_attempt_id uuid,
  p_agent_id text,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.appointment_confirmation_call_attempts%rowtype;
  v_appointment public.appointments%rowtype;

  v_timezone text;
  v_expected_agent_id text;

  v_duration interval;
  v_new_end_at timestamptz;

  v_local_start timestamp without time zone;
  v_local_end timestamp without time zone;

  v_local_date date;
  v_weekday integer;

  v_local_start_time time without time zone;
  v_local_end_time time without time zone;

  v_schedule_start time without time zone;
begin

  if p_start_at is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'START_AT_REQUIRED'
    );
  end if;


  select *
  into v_attempt
  from public.appointment_confirmation_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FOUND'
    );
  end if;


  if v_attempt.appointment_id <> p_appointment_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_MISMATCH'
    );
  end if;


  select d.retell_agent_id, d.timezone
  into v_expected_agent_id, v_timezone
  from public.doctors d
  where d.id = v_attempt.doctor_id
    and d.status = 'ACTIVE';

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_NOT_AVAILABLE'
    );
  end if;


  if nullif(btrim(v_expected_agent_id), '') is null
     or btrim(v_expected_agent_id) <> btrim(p_agent_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'AGENT_MISMATCH'
    );

  end if;


  if nullif(btrim(v_timezone), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_TIMEZONE_NOT_CONFIGURED'
    );
  end if;


  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
    and doctor_id = v_attempt.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  if v_appointment.status <> 'CONFIRMED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_ACTIVE',
      'appointment_status', v_appointment.status
    );
  end if;


  -- Exact retry after a successful reschedule.
  if v_appointment.start_at = p_start_at
     and v_appointment.confirmation_status = 'CONFIRMED' then

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'APPOINTMENT_ALREADY_RESCHEDULED',

      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status,

      'start_at', v_appointment.start_at,
      'end_at', v_appointment.end_at,

      'attendance_confirmed_at',
        v_appointment.attendance_confirmed_at
    );

  end if;


  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_ACTIVE',
      'attempt_status', v_attempt.status
    );
  end if;


  v_duration := v_appointment.end_at - v_appointment.start_at;

  if v_duration <= interval '0 seconds' then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_APPOINTMENT_DURATION'
    );
  end if;


  v_new_end_at := p_start_at + v_duration;


  if p_start_at < now() + interval '30 minutes' then
    return jsonb_build_object(
      'ok', false,
      'code', 'TOO_SOON',
      'retryable', true
    );
  end if;


  v_local_start := p_start_at at time zone v_timezone;
  v_local_end := v_new_end_at at time zone v_timezone;

  v_local_date := v_local_start::date;
  v_weekday := extract(isodow from v_local_start)::integer;

  v_local_start_time := v_local_start::time;
  v_local_end_time := v_local_end::time;


  if v_local_end::date <> v_local_date then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_CROSSES_DAY'
    );
  end if;


  select dsw.start_local
  into v_schedule_start
  from public.doctor_schedule_windows dsw
  where dsw.doctor_id = v_appointment.doctor_id
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


  if mod(
    (
      extract(
        epoch from (
          v_local_start_time - v_schedule_start
        )
      ) / 60
    )::integer,
    30
  ) <> 0 then

    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SLOT_ALIGNMENT'
    );

  end if;


  if exists (
    select 1
    from public.doctor_recurring_unavailability dru
    where dru.doctor_id = v_appointment.doctor_id
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


  if exists (
    select 1
    from public.doctor_unavailability du
    where du.doctor_id = v_appointment.doctor_id
      and p_start_at < du.end_at
      and v_new_end_at > du.start_at
  ) then

    return jsonb_build_object(
      'ok', false,
      'code', 'SLOT_UNAVAILABLE',
      'retryable', true
    );

  end if;


  if exists (
    select 1
    from public.appointments a
    where a.doctor_id = v_appointment.doctor_id
      and a.status = 'CONFIRMED'
      and a.id <> v_appointment.id
      and p_start_at < a.end_at
      and v_new_end_at > a.start_at
  ) then

    return jsonb_build_object(
      'ok', false,
      'code', 'SLOT_UNAVAILABLE',
      'retryable', true
    );

  end if;


  begin

    update public.appointments
    set
      start_at = p_start_at,
      end_at = v_new_end_at,

      confirmation_status = 'CONFIRMED',
      attendance_confirmed_at = now(),

      reminder_started_at = null,
      confirmation_response_due_at = null,
      confirmation_response_window_minutes_snapshot = null,
      unconfirmed_action_snapshot = null,

      updated_at = now()

    where id = v_appointment.id
    returning *
    into v_appointment;

  exception
    when exclusion_violation then

      return jsonb_build_object(
        'ok', false,
        'code', 'SLOT_UNAVAILABLE',
        'retryable', true
      );

  end;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'APPOINTMENT_RESCHEDULED',

    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'start_at', v_appointment.start_at,
    'end_at', v_appointment.end_at,

    'attendance_confirmed_at',
      v_appointment.attendance_confirmed_at
  );

end;
$function$;


-- ============================================================
-- 4. Preserve server-only permissions
-- ============================================================

revoke all on function
  public.confirm_appointment_attendance(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.confirm_appointment_attendance(uuid, uuid, text)
to service_role;


revoke all on function
  public.cancel_appointment_from_confirmation(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.cancel_appointment_from_confirmation(uuid, uuid, text)
to service_role;


revoke all on function
  public.reschedule_appointment_from_confirmation(
    uuid,
    uuid,
    text,
    timestamptz
  )
from public, anon, authenticated;

grant execute on function
  public.reschedule_appointment_from_confirmation(
    uuid,
    uuid,
    text,
    timestamptz
  )
to service_role;