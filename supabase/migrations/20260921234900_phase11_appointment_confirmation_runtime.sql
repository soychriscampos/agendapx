-- ============================================================
-- HelloPx - Phase 11
-- Appointment confirmation runtime
--
-- This migration intentionally leaves Phase 10 scheduling
-- persistence untouched.
-- ============================================================


-- ============================================================
-- 1. Appointment confirmation state
-- ============================================================

alter table public.appointments
add column confirmation_status text not null default 'PENDING';

alter table public.appointments
add constraint appointments_confirmation_status_check
check (
  confirmation_status in (
    'PENDING',
    'CONFIRMED',
    'CANCELLED',
    'REMINDER_PENDING',
    'REMINDER_STARTED',
    'MANUAL_REQUIRED'
  )
);


alter table public.appointments
add column attendance_confirmed_at timestamptz;


alter table public.appointments
add column reminder_started_at timestamptz;


alter table public.appointments
add column confirmation_response_due_at timestamptz;


alter table public.appointments
add column confirmation_response_window_minutes_snapshot integer;

alter table public.appointments
add constraint appointments_confirmation_window_snapshot_check
check (
  confirmation_response_window_minutes_snapshot is null
  or confirmation_response_window_minutes_snapshot > 0
);


alter table public.appointments
add column unconfirmed_action_snapshot text;

alter table public.appointments
add constraint appointments_unconfirmed_action_snapshot_check
check (
  unconfirmed_action_snapshot is null
  or unconfirmed_action_snapshot in ('CANCEL', 'MANUAL')
);


comment on column public.appointments.confirmation_status is
'Operational attendance-confirmation state. Independent from appointments.status, which represents whether the appointment occupies availability.';

comment on column public.appointments.attendance_confirmed_at is
'Timestamp when the patient explicitly confirmed attendance.';

comment on column public.appointments.reminder_started_at is
'Timestamp when the doctor initiated the manual WhatsApp reminder after a failed confirmation call.';

comment on column public.appointments.confirmation_response_due_at is
'Deadline persisted when the manual reminder starts. Evaluated by Phase 12.';

comment on column public.appointments.confirmation_response_window_minutes_snapshot is
'Snapshot of the configured response window when the manual reminder starts.';

comment on column public.appointments.unconfirmed_action_snapshot is
'Snapshot of CANCEL or MANUAL when the manual reminder starts.';


create index appointments_confirmation_runtime_idx
on public.appointments (
  doctor_id,
  status,
  confirmation_status,
  start_at
);


-- ============================================================
-- 2. Confirmation call attempts
--
-- Separate from scheduling_call_attempts on purpose.
-- scheduling_call_attempts remains owned by Phase 10 /
-- deposit_follow_up.
-- ============================================================

create table public.appointment_confirmation_call_attempts (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  appointment_id uuid not null
    references public.appointments(id)
    on delete cascade,

  attempt_number integer not null
    check (attempt_number > 0),

  status text not null default 'CREATING'
    check (
      status in (
        'CREATING',
        'DISPATCHED',
        'COMPLETED',
        'NO_ANSWER',
        'INTERRUPTED',
        'FAILED'
      )
    ),

  retell_call_id text unique,

  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  dispatched_at timestamptz,
  finished_at timestamptz,

  constraint appointment_confirmation_attempt_number_unique
    unique (appointment_id, attempt_number)
);


comment on table public.appointment_confirmation_call_attempts is
'Outbound Retell lifecycle for appointment-confirmation calls. Separate from Phase 10 scheduling_call_attempts.';


create unique index appointment_confirmation_one_active_uidx
on public.appointment_confirmation_call_attempts (appointment_id)
where status in ('CREATING', 'DISPATCHED');


create index appointment_confirmation_doctor_appointment_idx
on public.appointment_confirmation_call_attempts (
  doctor_id,
  appointment_id,
  created_at desc
);


create index appointment_confirmation_appointment_status_idx
on public.appointment_confirmation_call_attempts (
  appointment_id,
  status
);


alter table public.appointment_confirmation_call_attempts
enable row level security;


-- ============================================================
-- 3. Claim confirmation call
-- ============================================================

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


  if v_appointment.confirmation_status in (
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
  --
  -- For appointments created by the agent, use the contact
  -- that originated the appointment request.
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


  -- Future-compatible fallback for appointments that have a
  -- linked patient but no originating request.
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


-- ============================================================
-- 4. Mark confirmation call dispatched
-- ============================================================

create or replace function public.mark_appointment_confirmation_call_dispatched(
  p_attempt_id uuid,
  p_retell_call_id text
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
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FOUND'
    );
  end if;


  -- Webhook may have won the race.
  -- Never revive terminal attempts.
  if v_attempt.status in (
    'COMPLETED',
    'NO_ANSWER',
    'INTERRUPTED',
    'FAILED'
  ) then

    if v_attempt.retell_call_id = btrim(p_retell_call_id) then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'code', 'CALL_ALREADY_FINISHED',
        'attempt_id', v_attempt.id,
        'appointment_id', v_attempt.appointment_id,
        'attempt_status', v_attempt.status,
        'retell_call_id', v_attempt.retell_call_id
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id
    );

  end if;


  if v_attempt.status = 'DISPATCHED'
     and v_attempt.retell_call_id = btrim(p_retell_call_id) then

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_DISPATCHED',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'retell_call_id', v_attempt.retell_call_id
    );

  end if;


  if v_attempt.status = 'DISPATCHED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id
    );
  end if;


  if v_attempt.status <> 'CREATING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_CREATING',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.appointment_confirmation_call_attempts
  set
    status = 'DISPATCHED',
    retell_call_id = btrim(p_retell_call_id),
    dispatched_at = now(),
    updated_at = now(),
    last_error = null
  where id = v_attempt.id
  returning *
  into v_attempt;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'CALL_DISPATCHED',
    'attempt_id', v_attempt.id,
    'appointment_id', v_attempt.appointment_id,
    'attempt_status', v_attempt.status,
    'retell_call_id', v_attempt.retell_call_id
  );

end;
$function$;


-- ============================================================
-- 5. Mark technical dispatch failure
-- ============================================================

create or replace function public.mark_appointment_confirmation_call_failed(
  p_attempt_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.appointment_confirmation_call_attempts%rowtype;
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


  if v_attempt.status = 'FAILED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_FAILED',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id
    );
  end if;


  if v_attempt.status <> 'CREATING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_CREATING',
      'attempt_id', v_attempt.id,
      'appointment_id', v_attempt.appointment_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.appointment_confirmation_call_attempts
  set
    status = 'FAILED',
    last_error = nullif(left(p_error, 2000), ''),
    finished_at = now(),
    updated_at = now()
  where id = v_attempt.id
  returning *
  into v_attempt;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'CALL_FAILED',
    'attempt_id', v_attempt.id,
    'appointment_id', v_attempt.appointment_id,
    'attempt_status', v_attempt.status
  );

end;
$function$;


-- ============================================================
-- 6. Confirm patient attendance
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
-- 7. Cancel appointment from confirmation call
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


  if v_appointment.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'APPOINTMENT_ALREADY_CANCELLED',
      'appointment_id', v_appointment.id
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
-- 8. Permissions
--
-- Same server-only pattern already used by the Phase 7-10 RPCs.
-- ============================================================

revoke all on function
  public.claim_appointment_confirmation_call(uuid)
from public, anon, authenticated;

grant execute on function
  public.claim_appointment_confirmation_call(uuid)
to service_role;


revoke all on function
  public.mark_appointment_confirmation_call_dispatched(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.mark_appointment_confirmation_call_dispatched(uuid, text)
to service_role;


revoke all on function
  public.mark_appointment_confirmation_call_failed(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.mark_appointment_confirmation_call_failed(uuid, text)
to service_role;


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