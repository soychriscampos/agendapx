-- ============================================================
-- Phase 10
-- Outbound scheduling after confirmed deposit
-- ============================================================


-- ============================================================
-- 1. Optional scheduling preference
--
-- Precision levels:
--
-- date only
-- date + MORNING / AFTERNOON
-- date + exact local time
--
-- This is preference only. It NEVER reserves availability.
-- ============================================================

alter table public.appointment_requests
add column preferred_local_date date,
add column preferred_local_period text,
add column preferred_local_time time without time zone;


alter table public.appointment_requests
add constraint appointment_requests_preferred_local_period_check
check (
  preferred_local_period is null
  or preferred_local_period in ('MORNING', 'AFTERNOON')
);


alter table public.appointment_requests
add constraint appointment_requests_preference_requires_date_check
check (
  (
    preferred_local_period is null
    and preferred_local_time is null
  )
  or preferred_local_date is not null
);


alter table public.appointment_requests
add constraint appointment_requests_preference_precision_check
check (
  not (
    preferred_local_period is not null
    and preferred_local_time is not null
  )
);


-- ============================================================
-- 2. Scheduling outbound attempts
--
-- A request can have multiple attempts over time:
--
-- attempt 1 -> no answer
-- attempt 2 -> interrupted
-- attempt 3 -> completed
--
-- But only one active outbound attempt may exist at once.
-- ============================================================

create table public.scheduling_call_attempts (
  id uuid primary key default gen_random_uuid(),

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  request_id uuid not null
    references public.appointment_requests(id)
    on delete cascade,

  attempt_number integer not null,

  status text not null default 'CREATING',

  retell_call_id text,

  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  dispatched_at timestamptz,
  finished_at timestamptz,

  constraint scheduling_call_attempts_attempt_number_check
    check (attempt_number > 0),

  constraint scheduling_call_attempts_status_check
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

  constraint scheduling_call_attempts_request_attempt_unique
    unique (request_id, attempt_number),

  constraint scheduling_call_attempts_retell_call_id_unique
    unique (retell_call_id)
);


create index scheduling_call_attempts_doctor_request_idx
on public.scheduling_call_attempts (
  doctor_id,
  request_id,
  created_at desc
);


create index scheduling_call_attempts_request_status_idx
on public.scheduling_call_attempts (
  request_id,
  status
);


-- At most one call can currently be creating/running for a request.
create unique index scheduling_call_attempts_one_active_per_request_uidx
on public.scheduling_call_attempts (request_id)
where status in ('CREATING', 'DISPATCHED');


-- ============================================================
-- 3. RLS
--
-- Runtime mutation is server-side only.
-- ============================================================

alter table public.scheduling_call_attempts enable row level security;


revoke all
on public.scheduling_call_attempts
from anon, authenticated;


grant select, insert, update, delete
on public.scheduling_call_attempts
to service_role;


-- ============================================================
-- 4. Claim scheduling outbound
--
-- Responsibilities:
--
-- - preserve confirmed deposit
-- - DEPOSIT_CONFIRMED -> WAITING_SCHEDULING
-- - accept WAITING_SCHEDULING retries
-- - reject closed/non-eligible requests
-- - never create two active attempts
-- - return authoritative data needed to call Retell
--
-- IMPORTANT:
-- This does NOT call Retell.
-- External effects happen only after this transaction commits.
-- ============================================================

create or replace function public.claim_scheduling_call(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request public.appointment_requests%rowtype;
  v_existing_attempt public.scheduling_call_attempts%rowtype;
  v_created_attempt public.scheduling_call_attempts%rowtype;

  v_doctor public.doctors%rowtype;
  v_phone text;
  v_patient_name text;
  v_appointment_type_name text;

  v_attempt_number integer;
begin

  -- ----------------------------------------------------------
  -- 1. Lock request
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- 2. Closed requests must never dispatch another call
  -- ----------------------------------------------------------

  if v_request.status = 'CONFIRMED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_ALREADY_CONFIRMED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  if v_request.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_CANCELLED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Only confirmed-deposit scheduling flow is eligible
  -- ----------------------------------------------------------

  if v_request.status not in (
    'DEPOSIT_CONFIRMED',
    'WAITING_SCHEDULING'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_READY_FOR_SCHEDULING',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 4. Deposit-confirmed request becomes operationally ready
  --
  -- Deposit is NOT reverted by later failures.
  -- ----------------------------------------------------------

  if v_request.status = 'DEPOSIT_CONFIRMED' then

    update public.appointment_requests
    set
      status = 'WAITING_SCHEDULING',
      updated_at = now()
    where id = v_request.id
    returning *
    into v_request;

  end if;


  -- ----------------------------------------------------------
  -- 5. Defensive check: appointment already exists
  -- ----------------------------------------------------------

  if exists (
    select 1
    from public.appointments a
    where a.appointment_request_id = v_request.id
      and a.status = 'CONFIRMED'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_ALREADY_BOOKED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 6. If a call is already being created/running,
  -- return it idempotently.
  -- ----------------------------------------------------------

  select *
  into v_existing_attempt
  from public.scheduling_call_attempts sca
  where sca.request_id = v_request.id
    and sca.status in ('CREATING', 'DISPATCHED')
  order by sca.attempt_number desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'SCHEDULING_CALL_ALREADY_ACTIVE',

      'request_id', v_request.id,
      'request_status', v_request.status,

      'attempt_id', v_existing_attempt.id,
      'attempt_number', v_existing_attempt.attempt_number,
      'attempt_status', v_existing_attempt.status,
      'retell_call_id', v_existing_attempt.retell_call_id
    );
  end if;


  -- ----------------------------------------------------------
  -- 7. Load authoritative outbound context
  -- ----------------------------------------------------------

  select *
  into v_doctor
  from public.doctors d
  where d.id = v_request.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_NOT_FOUND',
      'request_id', v_request.id
    );
  end if;


  select cp.phone_e164
  into v_phone
  from public.contact_phones cp
  where cp.id = v_request.origin_contact_phone_id
    and cp.contact_id = v_request.origin_contact_id
    and cp.doctor_id = v_request.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONTACT_PHONE_NOT_FOUND',
      'request_id', v_request.id
    );
  end if;


  select p.full_name
  into v_patient_name
  from public.patients p
  where p.id = v_request.patient_id
    and p.doctor_id = v_request.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PATIENT_NOT_FOUND',
      'request_id', v_request.id
    );
  end if;


  if v_request.appointment_type_id is not null then

    select at.name
    into v_appointment_type_name
    from public.appointment_types at
    where at.id = v_request.appointment_type_id
      and at.doctor_id = v_request.doctor_id;

  end if;


  -- ----------------------------------------------------------
  -- 8. Technical Retell configuration
  -- ----------------------------------------------------------

  if nullif(btrim(v_doctor.retell_agent_id), '') is null
     or nullif(btrim(v_doctor.twilio_phone_number), '') is null then

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_NOT_CONFIGURED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );

  end if;


  -- ----------------------------------------------------------
  -- 9. Create next attempt
  -- ----------------------------------------------------------

  select coalesce(max(sca.attempt_number), 0) + 1
  into v_attempt_number
  from public.scheduling_call_attempts sca
  where sca.request_id = v_request.id;


  insert into public.scheduling_call_attempts (
    doctor_id,
    request_id,
    attempt_number,
    status
  )
  values (
    v_request.doctor_id,
    v_request.id,
    v_attempt_number,
    'CREATING'
  )
  returning *
  into v_created_attempt;


  -- ----------------------------------------------------------
  -- 10. Stable runtime contract
  -- ----------------------------------------------------------

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'SCHEDULING_CALL_CLAIMED',

    'request_id', v_request.id,
    'request_status', v_request.status,

    'attempt_id', v_created_attempt.id,
    'attempt_number', v_created_attempt.attempt_number,
    'attempt_status', v_created_attempt.status,

    'doctor_id', v_request.doctor_id,
    'retell_agent_id', v_doctor.retell_agent_id,
    'from_number', v_doctor.twilio_phone_number,
    'to_number', v_phone,
    'timezone', v_doctor.timezone,

    'patient_name', v_patient_name,
    'appointment_type_id', v_request.appointment_type_id,
    'appointment_type_name', v_appointment_type_name,

    'preferred_local_date', v_request.preferred_local_date,
    'preferred_local_period', v_request.preferred_local_period,
    'preferred_local_time', v_request.preferred_local_time
  );

end;
$function$;


-- Runtime-only RPC.
revoke all
on function public.claim_scheduling_call(uuid)
from public, anon, authenticated;

grant execute
on function public.claim_scheduling_call(uuid)
to service_role;


-- ============================================================
-- 5. Retell accepted outbound call
-- ============================================================

create or replace function public.mark_scheduling_call_dispatched(
  p_attempt_id uuid,
  p_retell_call_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.scheduling_call_attempts%rowtype;
begin

  if nullif(btrim(p_retell_call_id), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_REQUIRED'
    );
  end if;


  select *
  into v_attempt
  from public.scheduling_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FOUND'
    );
  end if;


  -- Exact retry after successful persistence.
  if v_attempt.status = 'DISPATCHED'
     and v_attempt.retell_call_id = btrim(p_retell_call_id) then

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_DISPATCHED',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'retell_call_id', v_attempt.retell_call_id
    );

  end if;


  if v_attempt.status <> 'CREATING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_CREATING',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.scheduling_call_attempts
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
    'request_id', v_attempt.request_id,
    'attempt_status', v_attempt.status,
    'retell_call_id', v_attempt.retell_call_id
  );

end;
$function$;


revoke all
on function public.mark_scheduling_call_dispatched(uuid, text)
from public, anon, authenticated;

grant execute
on function public.mark_scheduling_call_dispatched(uuid, text)
to service_role;


-- ============================================================
-- 6. Retell creation failed before a known call_id
--
-- A FAILED attempt is terminal and allows a later retry.
-- ============================================================

create or replace function public.mark_scheduling_call_failed(
  p_attempt_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.scheduling_call_attempts%rowtype;
begin

  select *
  into v_attempt
  from public.scheduling_call_attempts
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
      'request_id', v_attempt.request_id
    );
  end if;


  -- Once Retell gave us a known call, a generic dispatch failure
  -- must not overwrite its lifecycle.
  if v_attempt.status <> 'CREATING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_CREATING',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status
    );
  end if;


  update public.scheduling_call_attempts
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
    'request_id', v_attempt.request_id,
    'attempt_status', v_attempt.status
  );

end;
$function$;


revoke all
on function public.mark_scheduling_call_failed(uuid, text)
from public, anon, authenticated;

grant execute
on function public.mark_scheduling_call_failed(uuid, text)
to service_role;