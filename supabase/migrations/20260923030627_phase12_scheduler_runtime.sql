-- ============================================================
-- Phase 12 — Scheduler runtime
-- ============================================================
--
-- Responsibilities:
--
-- 1. Find appointments whose confirmation call is due.
-- 2. Respect the "created after confirmation due" skip rule.
-- 3. Prevent REMINDER_PENDING from being callable again.
-- 4. Atomically process expired confirmation response windows.
--
-- This migration DOES NOT install or schedule pg_cron yet.
-- ============================================================


-- ============================================================
-- 1. Minimal audit marker for automatic cancellation
-- ============================================================

alter table public.appointments
add column if not exists confirmation_auto_cancelled_at timestamptz;


-- ============================================================
-- 2. Index for expired reminder lookup
-- ============================================================
--
-- We already have appointments_confirmation_runtime_idx for:
-- doctor_id, status, confirmation_status, start_at
--
-- Expiration processing uses confirmation_response_due_at,
-- so keep this lookup small and targeted.
-- ============================================================

create index if not exists appointments_confirmation_due_idx
on public.appointments (confirmation_response_due_at)
where
  status = 'CONFIRMED'
  and confirmation_status = 'REMINDER_STARTED'
  and confirmation_response_due_at is not null;


-- ============================================================
-- 3. Get appointment confirmations that are due
-- ============================================================
--
-- Important product rule:
--
-- confirmation_due_at =
--   appointment.start_at - confirmation_lead_minutes
--
-- If an appointment was created at or after confirmation_due_at,
-- that confirmation cycle is skipped.
--
-- Example:
--
-- appointment: Wednesday 10:00
-- lead:        24 hours
-- due:         Tuesday 10:00
--
-- created Monday:
--   eligible Tuesday at 10:00
--
-- created Tuesday at 18:00:
--   never eligible for this confirmation cycle
--
-- This RPC only FINDS candidates.
-- It does NOT create attempts and does NOT claim calls.
--
-- claim_appointment_confirmation_call remains the authoritative
-- atomic call claim from Phase 11.
-- ============================================================

create or replace function public.get_due_appointment_confirmations(
  p_limit integer default 50
)
returns table (
  appointment_id uuid,
  doctor_id uuid,
  confirmation_due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin

  if p_limit is null or p_limit <= 0 then
    p_limit := 50;
  end if;

  -- Avoid an accidentally enormous scheduler batch.
  p_limit := least(p_limit, 200);

  return query
  select
    a.id as appointment_id,
    a.doctor_id,
    (
      a.start_at
      - make_interval(mins => s.confirmation_lead_minutes)
    ) as confirmation_due_at

  from public.appointments a

  join public.assistant_settings s
    on s.doctor_id = a.doctor_id

  join public.doctors d
    on d.id = a.doctor_id

  where
    -- Appointment must still occupy the slot.
    a.status = 'CONFIRMED'

    -- Only the initial confirmation state is callable.
    and a.confirmation_status = 'PENDING'

    -- Confirmation must still be enabled for the doctor.
    and s.confirmation_enabled is true

    -- Lead time must exist.
    and s.confirmation_lead_minutes is not null
    and s.confirmation_lead_minutes >= 0

    -- Doctor must still be operational.
    and d.status = 'ACTIVE'

    -- Never call after appointment start.
    and a.start_at > now()

    -- The scheduled confirmation moment has arrived.
    and (
      a.start_at
      - make_interval(mins => s.confirmation_lead_minutes)
    ) <= now()

    -- Product rule:
    -- appointment must have existed BEFORE its confirmation
    -- moment arrived.
    and a.created_at < (
      a.start_at
      - make_interval(mins => s.confirmation_lead_minutes)
    )

    -- An active Phase 11 attempt means this appointment has
    -- already been claimed/dispatched.
    and not exists (
      select 1
      from public.appointment_confirmation_call_attempts aca
      where aca.appointment_id = a.id
        and aca.status in ('CREATING', 'DISPATCHED')
    )

  order by confirmation_due_at asc, a.start_at asc

  limit p_limit;

end;
$function$;


-- Server-side scheduler only.
revoke all
on function public.get_due_appointment_confirmations(integer)
from public;

grant execute
on function public.get_due_appointment_confirmations(integer)
to service_role;


-- ============================================================
-- 4. Process one expired confirmation response window
-- ============================================================
--
-- This is intentionally appointment-scoped.
--
-- The future scheduler can first fetch expired appointments and
-- call this RPC for each one.
--
-- The appointment row is locked before evaluating the state.
-- This makes the terminal transition atomic and idempotent.
--
-- IMPORTANT:
-- We use confirmation_response_due_at and the persisted
-- unconfirmed_action_snapshot.
--
-- We DO NOT recalculate from current doctor configuration.
-- ============================================================

create or replace function public.process_expired_appointment_confirmation(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_appointment public.appointments%rowtype;
  v_action text;
begin

  if p_appointment_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_ID_REQUIRED'
    );
  end if;


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
  -- Already resolved.
  --
  -- Never revive or overwrite a terminal/resolved state.
  -- ----------------------------------------------------------

  if v_appointment.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'APPOINTMENT_ALREADY_RESOLVED',

      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  if v_appointment.confirmation_status in (
    'CONFIRMED',
    'CANCELLED',
    'MANUAL_REQUIRED'
  ) then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'APPOINTMENT_ALREADY_RESOLVED',

      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  -- ----------------------------------------------------------
  -- Only a reminder whose response window actually started
  -- can expire.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_status <> 'REMINDER_STARTED' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CONFIRMATION_NOT_EXPIRABLE',

      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  -- ----------------------------------------------------------
  -- Missing due timestamp means Phase 11 lifecycle is
  -- inconsistent. Do not guess or rebuild it here.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_response_due_at is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFIRMATION_RESPONSE_DUE_AT_MISSING',

      'appointment_id', v_appointment.id,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  -- ----------------------------------------------------------
  -- Window has not expired yet.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_response_due_at > now() then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CONFIRMATION_WINDOW_NOT_EXPIRED',

      'appointment_id', v_appointment.id,
      'confirmation_status', v_appointment.confirmation_status,
      'confirmation_response_due_at',
        v_appointment.confirmation_response_due_at
    );
  end if;


  -- ----------------------------------------------------------
  -- Snapshot is authoritative.
  --
  -- Never use assistant_settings.unconfirmed_action here.
  -- ----------------------------------------------------------

  v_action := v_appointment.unconfirmed_action_snapshot;


  if v_action not in ('CANCEL', 'MANUAL')
     or v_action is null then

    return jsonb_build_object(
      'ok', false,
      'code', 'UNCONFIRMED_ACTION_SNAPSHOT_INVALID',

      'appointment_id', v_appointment.id,
      'unconfirmed_action_snapshot', v_action
    );

  end if;


  -- ----------------------------------------------------------
  -- CANCEL
  --
  -- Cancelling appointments.status automatically releases
  -- the slot because availability only considers CONFIRMED
  -- appointments.
  -- ----------------------------------------------------------

  if v_action = 'CANCEL' then

    update public.appointments
    set
      status = 'CANCELLED',
      confirmation_status = 'CANCELLED',

      confirmation_auto_cancelled_at =
        coalesce(confirmation_auto_cancelled_at, now()),

      updated_at = now()

    where id = v_appointment.id

    returning *
    into v_appointment;


    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'code', 'APPOINTMENT_AUTO_CANCELLED',

      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status,

      'unconfirmed_action', v_action,

      'confirmation_response_due_at',
        v_appointment.confirmation_response_due_at,

      'confirmation_auto_cancelled_at',
        v_appointment.confirmation_auto_cancelled_at
    );

  end if;


  -- ----------------------------------------------------------
  -- MANUAL
  --
  -- Keep appointments.status = CONFIRMED so the appointment
  -- continues occupying availability.
  -- ----------------------------------------------------------

  update public.appointments
  set
    confirmation_status = 'MANUAL_REQUIRED',
    updated_at = now()

  where id = v_appointment.id

  returning *
  into v_appointment;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'APPOINTMENT_MANUAL_REQUIRED',

    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'unconfirmed_action', v_action,

    'confirmation_response_due_at',
      v_appointment.confirmation_response_due_at
  );

end;
$function$;


revoke all
on function public.process_expired_appointment_confirmation(uuid)
from public;

grant execute
on function public.process_expired_appointment_confirmation(uuid)
to service_role;


-- ============================================================
-- 5. Helper: get expired confirmation response windows
-- ============================================================
--
-- Like get_due_appointment_confirmations, this only returns
-- candidates.
--
-- The actual transition is performed by the atomic RPC above.
-- ============================================================

create or replace function public.get_expired_appointment_confirmations(
  p_limit integer default 50
)
returns table (
  appointment_id uuid,
  doctor_id uuid,
  confirmation_response_due_at timestamptz,
  unconfirmed_action_snapshot text
)
language plpgsql
security definer
set search_path = public
as $function$
begin

  if p_limit is null or p_limit <= 0 then
    p_limit := 50;
  end if;

  p_limit := least(p_limit, 200);

  return query
  select
    a.id,
    a.doctor_id,
    a.confirmation_response_due_at,
    a.unconfirmed_action_snapshot

  from public.appointments a

  where
    a.status = 'CONFIRMED'
    and a.confirmation_status = 'REMINDER_STARTED'
    and a.confirmation_response_due_at is not null
    and a.confirmation_response_due_at <= now()

  order by a.confirmation_response_due_at asc

  limit p_limit;

end;
$function$;


revoke all
on function public.get_expired_appointment_confirmations(integer)
from public;

grant execute
on function public.get_expired_appointment_confirmations(integer)
to service_role;