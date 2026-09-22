-- ============================================================
-- HelloPx - Phase 11
-- Confirmation call completion + atomic rescheduling
-- ============================================================


-- ============================================================
-- 1. Finish confirmation call by authoritative attempt_id
-- ============================================================

create or replace function public.finish_appointment_confirmation_call_by_attempt(
  p_attempt_id uuid,
  p_appointment_id uuid,
  p_retell_call_id text,
  p_agent_id text,
  p_outcome text
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
  v_final_status text;
begin

  if p_attempt_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_ID_REQUIRED'
    );
  end if;


  if p_appointment_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_REQUIRED'
    );
  end if;


  if nullif(btrim(p_retell_call_id), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_REQUIRED'
    );
  end if;


  if nullif(btrim(p_agent_id), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'AGENT_ID_REQUIRED'
    );
  end if;


  if p_outcome not in (
    'COMPLETED',
    'NO_ANSWER',
    'INTERRUPTED'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_CALL_OUTCOME'
    );
  end if;


  -- ----------------------------------------------------------
  -- Lock attempt.
  -- ----------------------------------------------------------

  select *
  into v_attempt
  from public.appointment_confirmation_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CONFIRMATION_CALL_NOT_FOUND'
    );
  end if;


  if v_attempt.appointment_id <> p_appointment_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id
    );
  end if;


  -- ----------------------------------------------------------
  -- Lock appointment.
  -- ----------------------------------------------------------

  select *
  into v_appointment
  from public.appointments
  where id = v_attempt.appointment_id
    and doctor_id = v_attempt.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND',
      'attempt_id', v_attempt.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Validate doctor / Retell agent.
  -- ----------------------------------------------------------

  select d.retell_agent_id
  into v_expected_agent_id
  from public.doctors d
  where d.id = v_attempt.doctor_id;

  if not found
     or nullif(btrim(v_expected_agent_id), '') is null
     or btrim(v_expected_agent_id) <> btrim(p_agent_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'AGENT_MISMATCH',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id
    );

  end if;


  -- ----------------------------------------------------------
  -- Validate or bind Retell call id.
  --
  -- Supports webhook winning the race before the normal
  -- dispatch persistence finishes.
  -- ----------------------------------------------------------

  if v_attempt.retell_call_id is not null
     and v_attempt.retell_call_id <> btrim(p_retell_call_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'attempt_status', v_attempt.status
    );

  end if;


  -- ----------------------------------------------------------
  -- Terminal attempts are immutable.
  -- ----------------------------------------------------------

  if v_attempt.status in (
    'COMPLETED',
    'NO_ANSWER',
    'INTERRUPTED',
    'FAILED'
  ) then

    if v_attempt.retell_call_id is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'TERMINAL_ATTEMPT_WITHOUT_CALL_ID',
        'attempt_id', v_attempt.id,
        'appointment_id', v_attempt.appointment_id,
        'attempt_status', v_attempt.status
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_FINISHED',

      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,

      'attempt_status', v_attempt.status,
      'confirmation_status', v_appointment.confirmation_status,

      'retell_call_id', v_attempt.retell_call_id
    );

  end if;


  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FINISHABLE',

      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,

      'attempt_status', v_attempt.status
    );
  end if;


  -- ----------------------------------------------------------
  -- Business transition takes precedence over Retell outcome.
  --
  -- If patient confirmed, cancelled or reprogrammed through a
  -- tool before call_ended arrived, the call accomplished its
  -- purpose regardless of Retell's disconnect classification.
  -- ----------------------------------------------------------

  if v_appointment.status = 'CANCELLED'
     or v_appointment.confirmation_status in (
       'CONFIRMED',
       'CANCELLED'
     ) then

    v_final_status := 'COMPLETED';

  else

    v_final_status := p_outcome;

  end if;


  -- ----------------------------------------------------------
  -- NO_ANSWER starts the manual handoff flow.
  --
  -- The response window does NOT start here.
  -- It starts only when the doctor actually invokes the
  -- WhatsApp reminder action.
  -- ----------------------------------------------------------

  if v_final_status = 'NO_ANSWER'
     and v_appointment.status = 'CONFIRMED'
     and v_appointment.confirmation_status = 'PENDING' then

    update public.appointments
    set
      confirmation_status = 'REMINDER_PENDING',
      updated_at = now()
    where id = v_appointment.id
    returning *
    into v_appointment;

  end if;


  -- ----------------------------------------------------------
  -- Finalize attempt.
  -- ----------------------------------------------------------

  update public.appointment_confirmation_call_attempts
  set
    retell_call_id = coalesce(
      retell_call_id,
      btrim(p_retell_call_id)
    ),

    status = v_final_status,

    finished_at = coalesce(finished_at, now()),
    updated_at = now()

  where id = v_attempt.id
  returning *
  into v_attempt;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'CONFIRMATION_CALL_FINISHED',

    'attempt_id', v_attempt.id,
    'appointment_id', v_attempt.appointment_id,

    'attempt_status', v_attempt.status,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'retell_call_id', v_attempt.retell_call_id
  );

end;
$function$;



-- ============================================================
-- 2. Finish confirmation call by retell_call_id fallback
-- ============================================================

create or replace function public.finish_appointment_confirmation_call(
  p_retell_call_id text,
  p_agent_id text,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.appointment_confirmation_call_attempts%rowtype;
begin

  if nullif(btrim(p_retell_call_id), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_REQUIRED'
    );
  end if;


  select *
  into v_attempt
  from public.appointment_confirmation_call_attempts
  where retell_call_id = btrim(p_retell_call_id)
  limit 1;


  if not found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CONFIRMATION_CALL_NOT_FOUND'
    );
  end if;


  return public.finish_appointment_confirmation_call_by_attempt(
    v_attempt.id,
    v_attempt.appointment_id,
    p_retell_call_id,
    p_agent_id,
    p_outcome
  );

end;
$function$;



-- ============================================================
-- 3. Atomic appointment rescheduling from confirmation call
--
-- Keeps the duration already reserved:
-- existing end_at - start_at.
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


  -- ----------------------------------------------------------
  -- Lock confirmation attempt.
  -- ----------------------------------------------------------

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


  -- A terminal call cannot later mutate the appointment.
  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_ACTIVE',
      'attempt_status', v_attempt.status
    );
  end if;


  -- ----------------------------------------------------------
  -- Validate Retell agent.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Lock appointment.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Preserve duration already reserved.
  -- ----------------------------------------------------------

  v_duration := v_appointment.end_at - v_appointment.start_at;

  if v_duration <= interval '0 seconds' then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_APPOINTMENT_DURATION'
    );
  end if;


  v_new_end_at := p_start_at + v_duration;


  -- ----------------------------------------------------------
  -- Keep same minimum lead semantics as availability/booking.
  -- ----------------------------------------------------------

  if p_start_at < now() + interval '30 minutes' then
    return jsonb_build_object(
      'ok', false,
      'code', 'TOO_SOON',
      'retryable', true
    );
  end if;


  -- ----------------------------------------------------------
  -- Resolve doctor's local date/time.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Must fit inside one normal schedule window.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Match getAvailableSlots() 30-minute grid.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Recurring unavailability.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Punctual unavailability.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Other confirmed appointments.
  --
  -- Exclude the appointment being moved.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Update appointment.
  --
  -- Exclusion constraint remains final concurrency guarantee.
  -- The patient selected the new slot during this live call,
  -- therefore attendance confirmation is satisfied.
  -- ----------------------------------------------------------

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
-- 4. Permissions
-- ============================================================

revoke all on function
  public.finish_appointment_confirmation_call_by_attempt(
    uuid,
    uuid,
    text,
    text,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.finish_appointment_confirmation_call_by_attempt(
    uuid,
    uuid,
    text,
    text,
    text
  )
to service_role;


revoke all on function
  public.finish_appointment_confirmation_call(
    text,
    text,
    text
  )
from public, anon, authenticated;

grant execute on function
  public.finish_appointment_confirmation_call(
    text,
    text,
    text
  )
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