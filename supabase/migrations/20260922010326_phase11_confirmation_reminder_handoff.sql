-- ============================================================
-- HelloPx - Phase 11
-- Confirmation NO_ANSWER -> email -> WhatsApp handoff
-- ============================================================


-- ============================================================
-- 1. Signed reminder action
-- ============================================================

create table public.appointment_confirmation_reminder_actions (
  id uuid primary key default gen_random_uuid(),

  appointment_id uuid not null unique
    references public.appointments(id)
    on delete cascade,

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  consumed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


comment on table public.appointment_confirmation_reminder_actions is
'Server-only capability metadata for the manual WhatsApp reminder after an appointment-confirmation NO_ANSWER. The action id is signed by HelloPx before being exposed publicly.';


create index appointment_confirmation_reminder_actions_doctor_idx
on public.appointment_confirmation_reminder_actions (
  doctor_id,
  created_at desc
);


alter table public.appointment_confirmation_reminder_actions
enable row level security;



-- ============================================================
-- 2. Email delivery lifecycle
-- ============================================================

create table public.appointment_confirmation_email_deliveries (
  id uuid primary key default gen_random_uuid(),

  appointment_id uuid not null unique
    references public.appointments(id)
    on delete cascade,

  doctor_id uuid not null
    references public.doctors(id)
    on delete cascade,

  action_id uuid not null unique
    references public.appointment_confirmation_reminder_actions(id)
    on delete cascade,

  recipient_email text,

  status text not null default 'PENDING'
    check (
      status in (
        'PENDING',
        'SENDING',
        'SENT',
        'FAILED'
      )
    ),

  attempt_count integer not null default 0
    check (attempt_count >= 0),

  last_attempt_at timestamptz,
  sent_at timestamptz,

  resend_email_id text,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


comment on table public.appointment_confirmation_email_deliveries is
'Persistent delivery state for the Phase 11 appointment-confirmation fallback email. One operational email per appointment.';


create index appointment_confirmation_email_doctor_idx
on public.appointment_confirmation_email_deliveries (
  doctor_id,
  created_at desc
);


alter table public.appointment_confirmation_email_deliveries
enable row level security;



-- ============================================================
-- 3. Prepare reminder action + email delivery
-- ============================================================

create or replace function public.prepare_appointment_confirmation_reminder(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_appointment public.appointments%rowtype;

  v_action public.appointment_confirmation_reminder_actions%rowtype;
  v_delivery public.appointment_confirmation_email_deliveries%rowtype;

  v_doctor_email text;

  v_contact_phone text;
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
  -- Email handoff only belongs to an active appointment that
  -- reached NO_ANSWER / REMINDER_PENDING.
  -- ----------------------------------------------------------

  if v_appointment.status <> 'CONFIRMED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_ACTIVE',
      'appointment_id', v_appointment.id,
      'appointment_status', v_appointment.status
    );
  end if;


  if v_appointment.confirmation_status <> 'REMINDER_PENDING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REMINDER_NOT_PENDING',
      'appointment_id', v_appointment.id,
      'confirmation_status', v_appointment.confirmation_status
    );
  end if;


  -- ----------------------------------------------------------
  -- Ensure there is an actual WhatsApp destination.
  --
  -- Prefer the original appointment-request contact.
  -- ----------------------------------------------------------

  if v_appointment.appointment_request_id is not null then

    select cp.phone_e164
    into v_contact_phone
    from public.appointment_requests ar
    join public.contact_phones cp
      on cp.id = ar.origin_contact_phone_id
     and cp.contact_id = ar.origin_contact_id
     and cp.doctor_id = ar.doctor_id
    where ar.id = v_appointment.appointment_request_id
      and ar.doctor_id = v_appointment.doctor_id;

  end if;


  -- Future-compatible fallback when the appointment has a
  -- patient directly associated but no originating request.
  if v_contact_phone is null
     and v_appointment.patient_id is not null then

    select cp.phone_e164
    into v_contact_phone
    from public.patient_contacts pc
    join public.contact_phones cp
      on cp.contact_id = pc.contact_id
     and cp.doctor_id = pc.doctor_id
    where pc.patient_id = v_appointment.patient_id
      and pc.doctor_id = v_appointment.doctor_id
      and pc.relationship = 'SELF'
    order by cp.created_at asc
    limit 1;

  end if;


  if nullif(btrim(v_contact_phone), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONTACT_PHONE_NOT_FOUND',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Resolve authenticated doctor email.
  -- Same source used by Phase 9.
  -- ----------------------------------------------------------

  select au.email
  into v_doctor_email
  from public.users pu
  join auth.users au
    on au.id = pu.id
  where pu.doctor_id = v_appointment.doctor_id
    and pu.role = 'DOCTOR'
    and nullif(btrim(au.email), '') is not null
  order by pu.created_at asc
  limit 1;


  if v_doctor_email is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DOCTOR_EMAIL_NOT_FOUND',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Exactly one stable action per appointment.
  -- ----------------------------------------------------------

  insert into public.appointment_confirmation_reminder_actions (
    appointment_id,
    doctor_id
  )
  values (
    v_appointment.id,
    v_appointment.doctor_id
  )
  on conflict (appointment_id)
  do nothing;


  select *
  into v_action
  from public.appointment_confirmation_reminder_actions
  where appointment_id = v_appointment.id
  for update;


  if v_action.doctor_id <> v_appointment.doctor_id then
    raise exception
      'Appointment confirmation reminder action tenant mismatch';
  end if;


  -- ----------------------------------------------------------
  -- Exactly one email delivery per appointment.
  -- ----------------------------------------------------------

  insert into public.appointment_confirmation_email_deliveries (
    appointment_id,
    doctor_id,
    action_id,
    recipient_email,
    status
  )
  values (
    v_appointment.id,
    v_appointment.doctor_id,
    v_action.id,
    v_doctor_email,
    'PENDING'
  )
  on conflict (appointment_id)
  do nothing;


  select *
  into v_delivery
  from public.appointment_confirmation_email_deliveries
  where appointment_id = v_appointment.id
  for update;


  if v_delivery.doctor_id <> v_appointment.doctor_id
     or v_delivery.action_id <> v_action.id then
    raise exception
      'Appointment confirmation email delivery invariant violation';
  end if;


  return jsonb_build_object(
    'ok', true,

    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'action_id', v_action.id,
    'action_consumed', v_action.consumed_at is not null,

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
-- 4. Email payload
-- ============================================================

create or replace function public.get_appointment_confirmation_email_payload(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_appointment public.appointments%rowtype;

  v_patient_name text;
  v_contact_name text;
  v_contact_phone text;

  v_doctor_name text;
  v_doctor_timezone text;

  v_appointment_type_name text;

  v_action_id uuid;
  v_recipient_email text;
begin

  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  select acra.id
  into v_action_id
  from public.appointment_confirmation_reminder_actions acra
  where acra.appointment_id = v_appointment.id
    and acra.doctor_id = v_appointment.doctor_id;


  if v_action_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'REMINDER_ACTION_NOT_PREPARED',
      'appointment_id', v_appointment.id
    );
  end if;


  -- ----------------------------------------------------------
  -- Patient
  -- ----------------------------------------------------------

  if v_appointment.patient_id is not null then

    select p.full_name
    into v_patient_name
    from public.patients p
    where p.id = v_appointment.patient_id
      and p.doctor_id = v_appointment.doctor_id;

  end if;


  v_patient_name :=
    coalesce(
      nullif(btrim(v_patient_name), ''),
      v_appointment.patient_name
    );


  -- ----------------------------------------------------------
  -- Contact
  -- ----------------------------------------------------------

  if v_appointment.appointment_request_id is not null then

    select
      c.full_name,
      cp.phone_e164
    into
      v_contact_name,
      v_contact_phone
    from public.appointment_requests ar
    join public.contacts c
      on c.id = ar.origin_contact_id
     and c.doctor_id = ar.doctor_id
    join public.contact_phones cp
      on cp.id = ar.origin_contact_phone_id
     and cp.contact_id = ar.origin_contact_id
     and cp.doctor_id = ar.doctor_id
    where ar.id = v_appointment.appointment_request_id
      and ar.doctor_id = v_appointment.doctor_id;

  end if;


  if v_contact_phone is null
     and v_appointment.patient_id is not null then

    select
      c.full_name,
      cp.phone_e164
    into
      v_contact_name,
      v_contact_phone
    from public.patient_contacts pc
    join public.contacts c
      on c.id = pc.contact_id
     and c.doctor_id = pc.doctor_id
    join public.contact_phones cp
      on cp.contact_id = pc.contact_id
     and cp.doctor_id = pc.doctor_id
    where pc.patient_id = v_appointment.patient_id
      and pc.doctor_id = v_appointment.doctor_id
      and pc.relationship = 'SELF'
    order by cp.created_at asc
    limit 1;

  end if;


  -- ----------------------------------------------------------
  -- Doctor / timezone
  -- ----------------------------------------------------------

  select
    d.display_name,
    d.timezone
  into
    v_doctor_name,
    v_doctor_timezone
  from public.doctors d
  where d.id = v_appointment.doctor_id;


  -- ----------------------------------------------------------
  -- Appointment type
  -- ----------------------------------------------------------

  if v_appointment.appointment_type_id is not null then

    select at.name
    into v_appointment_type_name
    from public.appointment_types at
    where at.id = v_appointment.appointment_type_id
      and at.doctor_id = v_appointment.doctor_id;

  end if;


  -- ----------------------------------------------------------
  -- Recipient snapshot
  -- ----------------------------------------------------------

  select aced.recipient_email
  into v_recipient_email
  from public.appointment_confirmation_email_deliveries aced
  where aced.appointment_id = v_appointment.id
    and aced.doctor_id = v_appointment.doctor_id;


  return jsonb_build_object(
    'ok', true,

    'appointment', jsonb_build_object(
      'id', v_appointment.id,
      'status', v_appointment.status,
      'confirmation_status', v_appointment.confirmation_status,
      'start_at', v_appointment.start_at,
      'end_at', v_appointment.end_at
    ),

    'doctor', jsonb_build_object(
      'id', v_appointment.doctor_id,
      'name', v_doctor_name,
      'timezone', v_doctor_timezone,
      'email', v_recipient_email
    ),

    'patient', jsonb_build_object(
      'id', v_appointment.patient_id,
      'name', v_patient_name
    ),

    'contact', jsonb_build_object(
      'name', v_contact_name,
      'phone_e164', v_contact_phone
    ),

    'appointment_type', jsonb_build_object(
      'id', v_appointment.appointment_type_id,
      'name', v_appointment_type_name
    ),

    'action', jsonb_build_object(
      'id', v_action_id
    )
  );

end;
$function$;



-- ============================================================
-- 5. Claim email send
--
-- Unlike the original Phase 9 helper, repeated concurrent calls
-- while SENDING do not claim another send.
-- ============================================================

create or replace function public.mark_appointment_confirmation_email_sending(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.appointment_confirmation_email_deliveries%rowtype;
begin

  select *
  into v_delivery
  from public.appointment_confirmation_email_deliveries
  where appointment_id = p_appointment_id
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
      'code', 'EMAIL_ALREADY_SENT',
      'appointment_id', v_delivery.appointment_id,
      'delivery_status', v_delivery.status,
      'attempt_count', v_delivery.attempt_count,
      'sent_at', v_delivery.sent_at,
      'resend_email_id', v_delivery.resend_email_id
    );
  end if;


  if v_delivery.status = 'SENDING' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'EMAIL_ALREADY_SENDING',
      'appointment_id', v_delivery.appointment_id,
      'delivery_status', v_delivery.status,
      'attempt_count', v_delivery.attempt_count
    );
  end if;


  update public.appointment_confirmation_email_deliveries
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
    'code', 'EMAIL_SEND_CLAIMED',
    'appointment_id', v_delivery.appointment_id,
    'delivery_status', v_delivery.status,
    'attempt_count', v_delivery.attempt_count
  );

end;
$function$;



-- ============================================================
-- 6. Mark email sent
-- ============================================================

create or replace function public.mark_appointment_confirmation_email_sent(
  p_appointment_id uuid,
  p_resend_email_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.appointment_confirmation_email_deliveries%rowtype;
begin

  select *
  into v_delivery
  from public.appointment_confirmation_email_deliveries
  where appointment_id = p_appointment_id
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
      'code', 'EMAIL_ALREADY_SENT',
      'appointment_id', v_delivery.appointment_id,
      'delivery_status', v_delivery.status,
      'sent_at', v_delivery.sent_at,
      'resend_email_id', v_delivery.resend_email_id
    );
  end if;


  update public.appointment_confirmation_email_deliveries
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
    'code', 'EMAIL_SENT',
    'appointment_id', v_delivery.appointment_id,
    'delivery_status', v_delivery.status,
    'sent_at', v_delivery.sent_at,
    'resend_email_id', v_delivery.resend_email_id
  );

end;
$function$;



-- ============================================================
-- 7. Mark email failed
-- ============================================================

create or replace function public.mark_appointment_confirmation_email_failed(
  p_appointment_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_delivery public.appointment_confirmation_email_deliveries%rowtype;
begin

  select *
  into v_delivery
  from public.appointment_confirmation_email_deliveries
  where appointment_id = p_appointment_id
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
      'code', 'EMAIL_ALREADY_SENT',
      'appointment_id', v_delivery.appointment_id,
      'delivery_status', v_delivery.status,
      'sent_at', v_delivery.sent_at
    );
  end if;


  update public.appointment_confirmation_email_deliveries
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
    'idempotent', false,
    'code', 'EMAIL_FAILED',
    'appointment_id', v_delivery.appointment_id,
    'delivery_status', v_delivery.status,
    'attempt_count', v_delivery.attempt_count
  );

end;
$function$;



-- ============================================================
-- 8. Read signed action state
-- ============================================================

create or replace function public.get_appointment_confirmation_reminder_action_state(
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action public.appointment_confirmation_reminder_actions%rowtype;
  v_appointment public.appointments%rowtype;

  v_patient_name text;
  v_doctor_name text;
begin

  select *
  into v_action
  from public.appointment_confirmation_reminder_actions
  where id = p_action_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTION_NOT_FOUND'
    );
  end if;


  select *
  into v_appointment
  from public.appointments
  where id = v_action.appointment_id
    and doctor_id = v_action.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  select d.display_name
  into v_doctor_name
  from public.doctors d
  where d.id = v_appointment.doctor_id;


  if v_appointment.patient_id is not null then

    select p.full_name
    into v_patient_name
    from public.patients p
    where p.id = v_appointment.patient_id
      and p.doctor_id = v_appointment.doctor_id;

  end if;


  v_patient_name :=
    coalesce(
      nullif(btrim(v_patient_name), ''),
      v_appointment.patient_name
    );


  return jsonb_build_object(
    'ok', true,

    'action_id', v_action.id,
    'action_consumed', v_action.consumed_at is not null,
    'consumed_at', v_action.consumed_at,

    'appointment_id', v_appointment.id,
    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'patient_name', v_patient_name,
    'doctor_name', v_doctor_name,

    'start_at', v_appointment.start_at,

    'reminder_started_at', v_appointment.reminder_started_at,
    'confirmation_response_due_at',
      v_appointment.confirmation_response_due_at
  );

end;
$function$;



-- ============================================================
-- 9. Start manual WhatsApp reminder window
--
-- Called only after HelloPx validates the signed public action.
-- This RPC starts the response window BEFORE redirecting to
-- WhatsApp.
-- ============================================================

create or replace function public.start_appointment_confirmation_reminder(
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action public.appointment_confirmation_reminder_actions%rowtype;
  v_appointment public.appointments%rowtype;
  v_settings public.assistant_settings%rowtype;

  v_patient_name text;
  v_doctor_name text;
  v_doctor_timezone text;

  v_contact_name text;
  v_contact_phone text;

  v_started_at timestamptz;
  v_due_at timestamptz;
begin

  -- ----------------------------------------------------------
  -- Lock action.
  -- ----------------------------------------------------------

  select *
  into v_action
  from public.appointment_confirmation_reminder_actions
  where id = p_action_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'ACTION_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- Lock appointment.
  -- ----------------------------------------------------------

  select *
  into v_appointment
  from public.appointments
  where id = v_action.appointment_id
    and doctor_id = v_action.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- Already resolved: never restart the window.
  -- ----------------------------------------------------------

  if v_appointment.status = 'CANCELLED'
     or v_appointment.confirmation_status in (
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
      'confirmation_status', v_appointment.confirmation_status,

      'reminder_started_at', v_appointment.reminder_started_at,
      'confirmation_response_due_at',
        v_appointment.confirmation_response_due_at
    );

  end if;


  -- ----------------------------------------------------------
  -- Exact retry: keep original timestamps/snapshots.
  -- ----------------------------------------------------------

  if v_appointment.confirmation_status = 'REMINDER_STARTED'
     and v_appointment.reminder_started_at is not null
     and v_appointment.confirmation_response_due_at is not null then

    v_started_at := v_appointment.reminder_started_at;
    v_due_at := v_appointment.confirmation_response_due_at;

  else

    if v_appointment.confirmation_status <> 'REMINDER_PENDING' then
      return jsonb_build_object(
        'ok', false,
        'code', 'REMINDER_NOT_PENDING',

        'appointment_id', v_appointment.id,
        'confirmation_status',
          v_appointment.confirmation_status
      );
    end if;


    select *
    into v_settings
    from public.assistant_settings
    where doctor_id = v_appointment.doctor_id;


    if not found
       or v_settings.confirmation_response_window_minutes is null
       or v_settings.confirmation_response_window_minutes <= 0 then

      return jsonb_build_object(
        'ok', false,
        'code', 'CONFIRMATION_RESPONSE_WINDOW_NOT_CONFIGURED',
        'appointment_id', v_appointment.id
      );

    end if;


    if v_settings.unconfirmed_action not in ('CANCEL', 'MANUAL') then

      return jsonb_build_object(
        'ok', false,
        'code', 'UNCONFIRMED_ACTION_NOT_CONFIGURED',
        'appointment_id', v_appointment.id
      );

    end if;


    v_started_at := now();

    v_due_at :=
      v_started_at
      + make_interval(
          mins => v_settings.confirmation_response_window_minutes
        );


    update public.appointments
    set
      confirmation_status = 'REMINDER_STARTED',

      reminder_started_at = v_started_at,
      confirmation_response_due_at = v_due_at,

      confirmation_response_window_minutes_snapshot =
        v_settings.confirmation_response_window_minutes,

      unconfirmed_action_snapshot =
        v_settings.unconfirmed_action,

      updated_at = now()

    where id = v_appointment.id
    returning *
    into v_appointment;


    update public.appointment_confirmation_reminder_actions
    set
      consumed_at = coalesce(consumed_at, v_started_at),
      updated_at = now()
    where id = v_action.id
    returning *
    into v_action;

  end if;


  -- ----------------------------------------------------------
  -- Resolve context used to construct WhatsApp message.
  -- ----------------------------------------------------------

  select
    d.display_name,
    d.timezone
  into
    v_doctor_name,
    v_doctor_timezone
  from public.doctors d
  where d.id = v_appointment.doctor_id;


  if v_appointment.patient_id is not null then

    select p.full_name
    into v_patient_name
    from public.patients p
    where p.id = v_appointment.patient_id
      and p.doctor_id = v_appointment.doctor_id;

  end if;


  v_patient_name :=
    coalesce(
      nullif(btrim(v_patient_name), ''),
      v_appointment.patient_name
    );


  if v_appointment.appointment_request_id is not null then

    select
      c.full_name,
      cp.phone_e164
    into
      v_contact_name,
      v_contact_phone
    from public.appointment_requests ar
    join public.contacts c
      on c.id = ar.origin_contact_id
     and c.doctor_id = ar.doctor_id
    join public.contact_phones cp
      on cp.id = ar.origin_contact_phone_id
     and cp.contact_id = ar.origin_contact_id
     and cp.doctor_id = ar.doctor_id
    where ar.id = v_appointment.appointment_request_id
      and ar.doctor_id = v_appointment.doctor_id;

  end if;


  if v_contact_phone is null
     and v_appointment.patient_id is not null then

    select
      c.full_name,
      cp.phone_e164
    into
      v_contact_name,
      v_contact_phone
    from public.patient_contacts pc
    join public.contacts c
      on c.id = pc.contact_id
     and c.doctor_id = pc.doctor_id
    join public.contact_phones cp
      on cp.contact_id = pc.contact_id
     and cp.doctor_id = pc.doctor_id
    where pc.patient_id = v_appointment.patient_id
      and pc.doctor_id = v_appointment.doctor_id
      and pc.relationship = 'SELF'
    order by cp.created_at asc
    limit 1;

  end if;


  if nullif(btrim(v_contact_phone), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONTACT_PHONE_NOT_FOUND',
      'appointment_id', v_appointment.id
    );
  end if;


  return jsonb_build_object(
    'ok', true,

    'idempotent',
      v_action.consumed_at is not null
      and v_action.consumed_at <> v_started_at,

    'code', 'REMINDER_STARTED',

    'action_id', v_action.id,
    'appointment_id', v_appointment.id,

    'appointment_status', v_appointment.status,
    'confirmation_status', v_appointment.confirmation_status,

    'patient_name', v_patient_name,
    'contact_name', v_contact_name,
    'contact_phone_e164', v_contact_phone,

    'doctor_name', v_doctor_name,
    'doctor_timezone', v_doctor_timezone,

    'start_at', v_appointment.start_at,

    'reminder_started_at', v_started_at,
    'confirmation_response_due_at', v_due_at,

    'confirmation_response_window_minutes',
      v_appointment.confirmation_response_window_minutes_snapshot,

    'unconfirmed_action',
      v_appointment.unconfirmed_action_snapshot
  );

end;
$function$;



-- ============================================================
-- 10. Server-only permissions
-- ============================================================

revoke all on function
  public.prepare_appointment_confirmation_reminder(uuid)
from public, anon, authenticated;

grant execute on function
  public.prepare_appointment_confirmation_reminder(uuid)
to service_role;


revoke all on function
  public.get_appointment_confirmation_email_payload(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_appointment_confirmation_email_payload(uuid)
to service_role;


revoke all on function
  public.mark_appointment_confirmation_email_sending(uuid)
from public, anon, authenticated;

grant execute on function
  public.mark_appointment_confirmation_email_sending(uuid)
to service_role;


revoke all on function
  public.mark_appointment_confirmation_email_sent(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.mark_appointment_confirmation_email_sent(uuid, text)
to service_role;


revoke all on function
  public.mark_appointment_confirmation_email_failed(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.mark_appointment_confirmation_email_failed(uuid, text)
to service_role;


revoke all on function
  public.get_appointment_confirmation_reminder_action_state(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_appointment_confirmation_reminder_action_state(uuid)
to service_role;


revoke all on function
  public.start_appointment_confirmation_reminder(uuid)
from public, anon, authenticated;

grant execute on function
  public.start_appointment_confirmation_reminder(uuid)
to service_role;