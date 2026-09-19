-- ============================================================
-- HelloPx — Phase 9
-- Actionable deposit email
--
-- Responsibilities:
--   1. Persistent confirmation action per deposit request.
--   2. Persistent delivery state for the deposit email.
--   3. Service-only payload RPC for building the email.
--   4. Atomic/idempotent deposit confirmation RPC.
--
-- IMPORTANT:
--   - Deposit runtime is FIXED only.
--   - This phase does NOT trigger the outbound Retell call.
--   - Confirmation transition is only:
--       WAITING_DEPOSIT -> DEPOSIT_CONFIRMED
-- ============================================================


-- ============================================================
-- 1. Deposit confirmation action
-- ============================================================
--
-- The public link will NOT use action_id alone as authorization.
--
-- HelloPx will create a signature server-side:
--
--   HMAC(DEPOSIT_ACTION_SECRET, action_id + purpose)
--
-- The URL can therefore contain:
--
--   action=<action_id>
--   signature=<signature>
--
-- The application verifies the signature before calling the
-- service-role-only confirmation RPC.
--
-- Keeping action_id persistent means the same secure link can
-- be reconstructed for email retries without storing the bearer
-- credential itself in the database.
-- ============================================================

create table public.deposit_confirmation_actions (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null
    references public.appointment_requests(id)
    on delete cascade,

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  consumed_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deposit_confirmation_actions_request_unique
    unique (request_id),

  constraint deposit_confirmation_actions_request_doctor_unique
    unique (request_id, doctor_id)
);

comment on table public.deposit_confirmation_actions is
  'Server-only confirmation capability metadata for a WAITING_DEPOSIT appointment request. The action id is signed by HelloPx before being exposed in a public link.';

comment on column public.deposit_confirmation_actions.consumed_at is
  'Timestamp of the first successful WAITING_DEPOSIT -> DEPOSIT_CONFIRMED transition. A consumed action remains resolvable so the public page can show the current state.';


-- ============================================================
-- 2. Deposit email delivery
-- ============================================================

create table public.deposit_email_deliveries (
  id uuid primary key default gen_random_uuid(),

  request_id uuid not null
    references public.appointment_requests(id)
    on delete cascade,

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  action_id uuid not null
    references public.deposit_confirmation_actions(id)
    on delete cascade,

  recipient_email text null,

  status text not null default 'PENDING',

  attempt_count integer not null default 0,

  last_attempt_at timestamptz null,
  sent_at timestamptz null,

  resend_email_id text null,
  last_error text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deposit_email_deliveries_request_unique
    unique (request_id),

  constraint deposit_email_deliveries_action_unique
    unique (action_id),

  constraint deposit_email_deliveries_status_check
    check (
      status in (
        'PENDING',
        'SENDING',
        'SENT',
        'FAILED'
      )
    ),

  constraint deposit_email_deliveries_attempt_count_check
    check (attempt_count >= 0)
);

comment on table public.deposit_email_deliveries is
  'Persistent delivery state for the Phase 9 actionable deposit email. One operational email per appointment request.';

comment on column public.deposit_email_deliveries.recipient_email is
  'Snapshot of the doctor email actually used when the notification is sent.';

comment on column public.deposit_email_deliveries.resend_email_id is
  'Provider identifier returned by Resend after accepting the email.';


-- ============================================================
-- 3. Indexes
-- ============================================================

create index deposit_confirmation_actions_doctor_id_idx
  on public.deposit_confirmation_actions (doctor_id);

create index deposit_email_deliveries_doctor_status_idx
  on public.deposit_email_deliveries (doctor_id, status);

create index deposit_email_deliveries_pending_idx
  on public.deposit_email_deliveries (status, created_at)
  where status in ('PENDING', 'FAILED');


-- ============================================================
-- 4. RLS
-- ============================================================
--
-- These tables are operational infrastructure.
-- They are intentionally NOT directly exposed to authenticated
-- doctor clients in Phase 9.
-- ============================================================

alter table public.deposit_confirmation_actions
  enable row level security;

alter table public.deposit_email_deliveries
  enable row level security;


-- Remove implicit API access.
revoke all on table public.deposit_confirmation_actions
  from anon, authenticated;

revoke all on table public.deposit_email_deliveries
  from anon, authenticated;

-- Server runtime may operate them.
grant all on table public.deposit_confirmation_actions
  to service_role;

grant all on table public.deposit_email_deliveries
  to service_role;


-- ============================================================
-- 5. Prepare Phase 9 email operation
-- ============================================================
--
-- Called after resolve_deposit_for_request() succeeds.
--
-- Responsibilities:
--   - lock the appointment request;
--   - ensure it is still WAITING_DEPOSIT;
--   - require a FIXED deposit snapshot;
--   - require a positive resolved amount;
--   - create/reuse exactly one confirmation action;
--   - create/reuse exactly one email-delivery record;
--   - return action_id and current delivery status.
--
-- It intentionally DOES NOT send email.
-- ============================================================

create or replace function public.prepare_deposit_email_action(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_request public.appointment_requests%rowtype;

  v_action public.deposit_confirmation_actions%rowtype;
  v_delivery public.deposit_email_deliveries%rowtype;

  v_doctor_email text;
begin

  -- ----------------------------------------------------------
  -- 1. Lock request
  -- ----------------------------------------------------------

  select ar.*
  into v_request
  from public.appointment_requests ar
  where ar.id = p_request_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 2. Request must still need the deposit
  -- ----------------------------------------------------------

  if v_request.status <> 'WAITING_DEPOSIT' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_WAITING_DEPOSIT',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Phase 9 accepts only the final FIXED snapshot
  -- ----------------------------------------------------------

  if v_request.deposit_type is distinct from 'FIXED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_DEPOSIT_SNAPSHOT',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;

  if v_request.deposit_amount is null
     or v_request.deposit_amount <= 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEPOSIT_AMOUNT_REQUIRED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 4. Resolve doctor's authenticated email
  -- ----------------------------------------------------------
  --
  -- public.users.id references auth.users.id.
  -- Prefer the DOCTOR user belonging to this doctor.
  -- ----------------------------------------------------------

  select au.email
  into v_doctor_email
  from public.users pu
  join auth.users au
    on au.id = pu.id
  where pu.doctor_id = v_request.doctor_id
    and pu.role = 'DOCTOR'
    and nullif(btrim(au.email), '') is not null
  order by pu.created_at asc
  limit 1;

  if v_doctor_email is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_EMAIL_NOT_FOUND',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 5. Ensure exactly one action per request
  -- ----------------------------------------------------------

  insert into public.deposit_confirmation_actions (
    request_id,
    doctor_id
  )
  values (
    v_request.id,
    v_request.doctor_id
  )
  on conflict (request_id)
  do nothing;

  select dca.*
  into v_action
  from public.deposit_confirmation_actions dca
  where dca.request_id = v_request.id
  for update;


  -- Tenant invariant
  if v_action.doctor_id <> v_request.doctor_id then
    raise exception
      'Deposit confirmation action tenant mismatch';
  end if;


  -- ----------------------------------------------------------
  -- 6. Ensure exactly one delivery record
  -- ----------------------------------------------------------

  insert into public.deposit_email_deliveries (
    request_id,
    doctor_id,
    action_id,
    recipient_email,
    status
  )
  values (
    v_request.id,
    v_request.doctor_id,
    v_action.id,
    v_doctor_email,
    'PENDING'
  )
  on conflict (request_id)
  do nothing;

  select ded.*
  into v_delivery
  from public.deposit_email_deliveries ded
  where ded.request_id = v_request.id
  for update;


  -- Tenant/action invariants
  if v_delivery.doctor_id <> v_request.doctor_id
     or v_delivery.action_id <> v_action.id then
    raise exception
      'Deposit email delivery invariant violation';
  end if;


  -- ----------------------------------------------------------
  -- 7. Stable response
  -- ----------------------------------------------------------

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'request_status', v_request.status,

    'action_id', v_action.id,
    'action_consumed',
      v_action.consumed_at is not null,

    'recipient_email', v_delivery.recipient_email,

    'delivery', jsonb_build_object(
      'id', v_delivery.id,
      'status', v_delivery.status,
      'attempt_count', v_delivery.attempt_count,
      'sent_at', v_delivery.sent_at,
      'resend_email_id', v_delivery.resend_email_id
    )
  );

end;
$function$;


-- ============================================================
-- 6. Get complete email payload
-- ============================================================
--
-- Server-only.
--
-- This avoids widening direct SELECT grants over patients,
-- contacts, intake answers, payment instructions and auth.users.
--
-- The application will still construct presentation/UI/HTML.
-- ============================================================

create or replace function public.get_deposit_email_payload(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_request public.appointment_requests%rowtype;

  v_patient_name text;
  v_contact_name text;
  v_contact_phone text;

  v_appointment_type_name text;
  v_doctor_name text;

  v_action_id uuid;

  v_recipient_email text;

  v_intake_answers jsonb;
  v_payment_instructions jsonb;
begin

  -- ----------------------------------------------------------
  -- 1. Request
  -- ----------------------------------------------------------

  select ar.*
  into v_request
  from public.appointment_requests ar
  where ar.id = p_request_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 2. Snapshot must be a valid Phase 9 deposit request
  -- ----------------------------------------------------------

  if v_request.deposit_type is distinct from 'FIXED'
     or v_request.deposit_amount is null
     or v_request.deposit_amount <= 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_DEPOSIT_SNAPSHOT',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Confirmation action must already exist
  -- ----------------------------------------------------------

  select dca.id
  into v_action_id
  from public.deposit_confirmation_actions dca
  where dca.request_id = v_request.id
    and dca.doctor_id = v_request.doctor_id;

  if v_action_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEPOSIT_ACTION_NOT_PREPARED',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 4. Patient/contact/phone/type/doctor
  -- ----------------------------------------------------------

  select p.full_name
  into v_patient_name
  from public.patients p
  where p.id = v_request.patient_id
    and p.doctor_id = v_request.doctor_id;

  select c.full_name
  into v_contact_name
  from public.contacts c
  where c.id = v_request.origin_contact_id
    and c.doctor_id = v_request.doctor_id;

  select cp.phone_e164
  into v_contact_phone
  from public.contact_phones cp
  where cp.id = v_request.origin_contact_phone_id
    and cp.contact_id = v_request.origin_contact_id
    and cp.doctor_id = v_request.doctor_id;

  select at.name
  into v_appointment_type_name
  from public.appointment_types at
  where at.id = v_request.appointment_type_id
    and at.doctor_id = v_request.doctor_id;

  select d.display_name
  into v_doctor_name
  from public.doctors d
  where d.id = v_request.doctor_id;


  -- ----------------------------------------------------------
  -- 5. Recipient snapshot
  -- ----------------------------------------------------------

  select ded.recipient_email
  into v_recipient_email
  from public.deposit_email_deliveries ded
  where ded.request_id = v_request.id
    and ded.doctor_id = v_request.doctor_id;


  -- ----------------------------------------------------------
  -- 6. Intake snapshot
  -- ----------------------------------------------------------

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field_key', aria.field_key,
        'field_label', aria.field_label,
        'value', aria.value
      )
      order by aria.created_at asc, aria.id asc
    ),
    '[]'::jsonb
  )
  into v_intake_answers
  from public.appointment_request_intake_answers aria
  where aria.request_id = v_request.id
    and aria.doctor_id = v_request.doctor_id;


  -- ----------------------------------------------------------
  -- 7. Current configured payment instructions
  -- ----------------------------------------------------------
  --
  -- The deposit amount is immutable request snapshot data.
  -- Payment destination/instructions are doctor configuration
  -- used to construct the operational WhatsApp message.
  -- ----------------------------------------------------------

  select jsonb_build_object(
    'bank_name', dpi.bank_name,
    'account_holder', dpi.account_holder,
    'clabe', dpi.clabe,
    'account_number', dpi.account_number,
    'instructions', dpi.instructions,
    'message_template', dpi.message_template
  )
  into v_payment_instructions
  from public.doctor_payment_instructions dpi
  where dpi.doctor_id = v_request.doctor_id;


  -- ----------------------------------------------------------
  -- 8. Payload
  -- ----------------------------------------------------------

  return jsonb_build_object(
    'ok', true,

    'request', jsonb_build_object(
      'id', v_request.id,
      'status', v_request.status,
      'created_at', v_request.created_at
    ),

    'doctor', jsonb_build_object(
      'id', v_request.doctor_id,
      'name', v_doctor_name,
      'email', v_recipient_email
    ),

    'patient', jsonb_build_object(
      'id', v_request.patient_id,
      'name', v_patient_name
    ),

    'contact', jsonb_build_object(
      'id', v_request.origin_contact_id,
      'name', v_contact_name,
      'phone_e164', v_contact_phone
    ),

    'appointment_type', jsonb_build_object(
      'id', v_request.appointment_type_id,
      'name', v_appointment_type_name
    ),

    'deposit', jsonb_build_object(
      'type', v_request.deposit_type,
      'amount', v_request.deposit_amount,
      'rule_name', v_request.deposit_rule_name,
      'payment_instructions', v_payment_instructions
    ),

    'intake_answers', v_intake_answers,

    'action', jsonb_build_object(
      'id', v_action_id
    )
  );

end;
$function$;


-- ============================================================
-- 7. Register email send attempt
-- ============================================================
--
-- Called immediately before contacting Resend.
--
-- This is intentionally small; Phase 9 is not introducing a
-- general-purpose background job/outbox framework.
-- ============================================================

create or replace function public.mark_deposit_email_sending(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.deposit_email_deliveries%rowtype;
begin

  select ded.*
  into v_delivery
  from public.deposit_email_deliveries ded
  where ded.request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DELIVERY_NOT_FOUND'
    );
  end if;

  if v_delivery.status = 'SENT' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_delivery.request_id,
      'delivery_status', v_delivery.status,
      'attempt_count', v_delivery.attempt_count,
      'sent_at', v_delivery.sent_at,
      'resend_email_id', v_delivery.resend_email_id
    );
  end if;

  update public.deposit_email_deliveries
  set
    status = 'SENDING',
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    last_error = null,
    updated_at = now()
  where id = v_delivery.id
  returning *
  into v_delivery;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'request_id', v_delivery.request_id,
    'delivery_status', v_delivery.status,
    'attempt_count', v_delivery.attempt_count
  );

end;
$function$;


-- ============================================================
-- 8. Mark successful email delivery
-- ============================================================

create or replace function public.mark_deposit_email_sent(
  p_request_id uuid,
  p_resend_email_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.deposit_email_deliveries%rowtype;
begin

  select ded.*
  into v_delivery
  from public.deposit_email_deliveries ded
  where ded.request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DELIVERY_NOT_FOUND'
    );
  end if;


  if v_delivery.status = 'SENT' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_delivery.request_id,
      'delivery_status', v_delivery.status,
      'sent_at', v_delivery.sent_at,
      'resend_email_id', v_delivery.resend_email_id
    );
  end if;


  update public.deposit_email_deliveries
  set
    status = 'SENT',
    sent_at = now(),
    resend_email_id = nullif(btrim(p_resend_email_id), ''),
    last_error = null,
    updated_at = now()
  where id = v_delivery.id
  returning *
  into v_delivery;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'request_id', v_delivery.request_id,
    'delivery_status', v_delivery.status,
    'sent_at', v_delivery.sent_at,
    'resend_email_id', v_delivery.resend_email_id
  );

end;
$function$;


-- ============================================================
-- 9. Mark failed email delivery
-- ============================================================

create or replace function public.mark_deposit_email_failed(
  p_request_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.deposit_email_deliveries%rowtype;
begin

  select ded.*
  into v_delivery
  from public.deposit_email_deliveries ded
  where ded.request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DELIVERY_NOT_FOUND'
    );
  end if;


  -- Never downgrade a confirmed successful send.
  if v_delivery.status = 'SENT' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_delivery.request_id,
      'delivery_status', v_delivery.status,
      'sent_at', v_delivery.sent_at
    );
  end if;


  update public.deposit_email_deliveries
  set
    status = 'FAILED',
    last_error =
      case
        when p_error is null then null
        else left(p_error, 2000)
      end,
    updated_at = now()
  where id = v_delivery.id
  returning *
  into v_delivery;


  return jsonb_build_object(
    'ok', true,
    'request_id', v_delivery.request_id,
    'delivery_status', v_delivery.status,
    'attempt_count', v_delivery.attempt_count
  );

end;
$function$;


-- ============================================================
-- 10. Read public confirmation-action state
-- ============================================================
--
-- IMPORTANT:
-- The application MUST verify the HMAC signature BEFORE calling
-- this function.
--
-- action_id alone is not authorization.
-- ============================================================

create or replace function public.get_deposit_confirmation_action_state(
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action public.deposit_confirmation_actions%rowtype;
  v_request public.appointment_requests%rowtype;

  v_patient_name text;
  v_doctor_name text;
  v_amount numeric;
begin

  select dca.*
  into v_action
  from public.deposit_confirmation_actions dca
  where dca.id = p_action_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTION_NOT_FOUND'
    );
  end if;


  select ar.*
  into v_request
  from public.appointment_requests ar
  where ar.id = v_action.request_id
    and ar.doctor_id = v_action.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND'
    );
  end if;


  select p.full_name
  into v_patient_name
  from public.patients p
  where p.id = v_request.patient_id
    and p.doctor_id = v_request.doctor_id;

  select d.display_name
  into v_doctor_name
  from public.doctors d
  where d.id = v_request.doctor_id;

  v_amount := v_request.deposit_amount;


  return jsonb_build_object(
    'ok', true,
    'action_id', v_action.id,
    'request_id', v_request.id,
    'request_status', v_request.status,
    'action_consumed', v_action.consumed_at is not null,
    'consumed_at', v_action.consumed_at,
    'patient_name', v_patient_name,
    'doctor_name', v_doctor_name,
    'deposit_amount', v_amount
  );

end;
$function$;


-- ============================================================
-- 11. Confirm deposit atomically
-- ============================================================
--
-- IMPORTANT:
-- The application MUST verify the HMAC signature BEFORE calling
-- this function.
--
-- This RPC is service-role-only.
--
-- Phase 9 ends at DEPOSIT_CONFIRMED.
-- It does NOT:
--   - create an appointment;
--   - move to WAITING_SCHEDULING;
--   - call Retell;
--   - reserve a preferred slot.
-- ============================================================

create or replace function public.confirm_deposit_from_action(
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action public.deposit_confirmation_actions%rowtype;
  v_request public.appointment_requests%rowtype;
begin

  -- ----------------------------------------------------------
  -- 1. Lock action
  -- ----------------------------------------------------------

  select dca.*
  into v_action
  from public.deposit_confirmation_actions dca
  where dca.id = p_action_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTION_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 2. Lock request
  -- ----------------------------------------------------------

  select ar.*
  into v_request
  from public.appointment_requests ar
  where ar.id = v_action.request_id
    and ar.doctor_id = v_action.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Already confirmed by this action
  -- ----------------------------------------------------------

  if v_request.status = 'DEPOSIT_CONFIRMED' then

    if v_action.consumed_at is null then
      update public.deposit_confirmation_actions
      set
        consumed_at = now(),
        updated_at = now()
      where id = v_action.id
      returning *
      into v_action;
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'DEPOSIT_ALREADY_CONFIRMED',
      'action_id', v_action.id,
      'request_id', v_request.id,
      'request_status', v_request.status,
      'consumed_at', v_action.consumed_at
    );
  end if;


  -- ----------------------------------------------------------
  -- 4. Request already moved elsewhere
  -- ----------------------------------------------------------

  if v_request.status <> 'WAITING_DEPOSIT' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'REQUEST_ALREADY_PROCESSED',
      'action_id', v_action.id,
      'request_id', v_request.id,
      'request_status', v_request.status,
      'consumed_at', v_action.consumed_at
    );
  end if;


  -- ----------------------------------------------------------
  -- 5. Validate immutable deposit snapshot
  -- ----------------------------------------------------------

  if v_request.deposit_type is distinct from 'FIXED'
     or v_request.deposit_amount is null
     or v_request.deposit_amount <= 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_DEPOSIT_SNAPSHOT',
      'action_id', v_action.id,
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 6. Single Phase 9 transition
  -- ----------------------------------------------------------

  update public.appointment_requests
  set
    status = 'DEPOSIT_CONFIRMED',
    updated_at = now()
  where id = v_request.id;


  update public.deposit_confirmation_actions
  set
    consumed_at = coalesce(consumed_at, now()),
    updated_at = now()
  where id = v_action.id
  returning *
  into v_action;


  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'code', 'DEPOSIT_CONFIRMED',
    'action_id', v_action.id,
    'request_id', v_request.id,
    'request_status', 'DEPOSIT_CONFIRMED',
    'consumed_at', v_action.consumed_at
  );

end;
$function$;


-- ============================================================
-- 12. Function permissions
-- ============================================================

revoke all on function public.prepare_deposit_email_action(uuid)
  from public, anon, authenticated;

revoke all on function public.get_deposit_email_payload(uuid)
  from public, anon, authenticated;

revoke all on function public.mark_deposit_email_sending(uuid)
  from public, anon, authenticated;

revoke all on function public.mark_deposit_email_sent(uuid, text)
  from public, anon, authenticated;

revoke all on function public.mark_deposit_email_failed(uuid, text)
  from public, anon, authenticated;

revoke all on function public.get_deposit_confirmation_action_state(uuid)
  from public, anon, authenticated;

revoke all on function public.confirm_deposit_from_action(uuid)
  from public, anon, authenticated;


grant execute on function public.prepare_deposit_email_action(uuid)
  to service_role;

grant execute on function public.get_deposit_email_payload(uuid)
  to service_role;

grant execute on function public.mark_deposit_email_sending(uuid)
  to service_role;

grant execute on function public.mark_deposit_email_sent(uuid, text)
  to service_role;

grant execute on function public.mark_deposit_email_failed(uuid, text)
  to service_role;

grant execute on function public.get_deposit_confirmation_action_state(uuid)
  to service_role;

grant execute on function public.confirm_deposit_from_action(uuid)
  to service_role;