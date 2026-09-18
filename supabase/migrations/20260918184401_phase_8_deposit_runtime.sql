-- HelloPx
-- Phase 8 — Deposit runtime
--
-- Scope of this migration:
-- - persist an immutable economic snapshot for a request that requires deposit
-- - resolve exactly one active deposit rule for a WAITING_DEPOSIT request
-- - calculate FIXED or PERCENTAGE deposit amounts
-- - expose the doctor's configured payment instructions to the server runtime
--
-- Out of scope:
-- - payment confirmation
-- - email / WhatsApp delivery
-- - outgoing calls
-- - appointment creation
-- - temporary slot holds

begin;

-- =========================================================
-- 1. Deposit snapshot on appointment_requests
-- =========================================================
--
-- These columns freeze the economic terms that applied when
-- the request entered the deposit flow. The rule itself may be
-- edited or deleted later without changing the historical amount.
-- =========================================================

alter table public.appointment_requests
  add column if not exists deposit_rule_id uuid,
  add column if not exists deposit_rule_name text,
  add column if not exists deposit_type text,
  add column if not exists deposit_value numeric(10,2),
  add column if not exists appointment_price_snapshot numeric(10,2),
  add column if not exists deposit_amount numeric(10,2);

alter table public.appointment_requests
  drop constraint if exists appointment_requests_deposit_rule_id_fkey;

alter table public.appointment_requests
  add constraint appointment_requests_deposit_rule_id_fkey
  foreign key (deposit_rule_id)
  references public.deposit_rules(id)
  on delete set null;

alter table public.appointment_requests
  drop constraint if exists appointment_requests_deposit_type_check;

alter table public.appointment_requests
  add constraint appointment_requests_deposit_type_check
  check (
    deposit_type is null
    or deposit_type in ('PERCENTAGE', 'FIXED')
  );

alter table public.appointment_requests
  drop constraint if exists appointment_requests_deposit_snapshot_check;

alter table public.appointment_requests
  add constraint appointment_requests_deposit_snapshot_check
  check (
    (
      deposit_type is null
      and deposit_rule_id is null
      and deposit_rule_name is null
      and deposit_value is null
      and appointment_price_snapshot is null
      and deposit_amount is null
    )
    or
    (
      deposit_type is not null
      and nullif(btrim(deposit_rule_name), '') is not null
      and deposit_value is not null
      and deposit_value > 0
      and deposit_amount is not null
      and deposit_amount > 0
      and (
        deposit_type <> 'PERCENTAGE'
        or (
          deposit_value <= 100
          and appointment_price_snapshot is not null
          and appointment_price_snapshot > 0
        )
      )
    )
  );

comment on column public.appointment_requests.deposit_rule_id is
  'Deposit rule that produced the request deposit snapshot. Nullable if the source rule is later deleted.';

comment on column public.appointment_requests.deposit_rule_name is
  'Snapshot of the applied deposit rule name.';

comment on column public.appointment_requests.deposit_type is
  'Snapshot of the applied deposit type: PERCENTAGE or FIXED.';

comment on column public.appointment_requests.deposit_value is
  'Snapshot of the configured percentage or fixed amount.';

comment on column public.appointment_requests.appointment_price_snapshot is
  'Appointment type price at the moment the deposit was resolved. Required for percentage deposits.';

comment on column public.appointment_requests.deposit_amount is
  'Final calculated deposit amount for this request.';


-- =========================================================
-- 2. Resolve and snapshot deposit for an existing request
-- =========================================================
--
-- This RPC is intentionally separate from payment confirmation.
-- It is called by the HelloPx server immediately after
-- prepare_booking_from_call returns requires_deposit = true.
--
-- No precedence is invented between overlapping rules.
-- If more than one active rule matches, configuration is
-- ambiguous and the RPC returns AMBIGUOUS_DEPOSIT_RULE.
-- =========================================================

create or replace function public.resolve_deposit_for_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.appointment_requests%rowtype;

  v_match_count integer := 0;
  v_rule_id uuid;
  v_rule_name text;
  v_deposit_type text;
  v_deposit_value numeric(10,2);

  v_appointment_price numeric(10,2);
  v_deposit_amount numeric(10,2);

  v_payment_instructions jsonb;
begin

  -- -------------------------------------------------------
  -- 1. Lock request so retries/concurrent calls are safe.
  -- -------------------------------------------------------

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


  -- -------------------------------------------------------
  -- 2. This phase only resolves pending deposits.
  -- -------------------------------------------------------

  if v_request.status <> 'WAITING_DEPOSIT' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_WAITING_DEPOSIT',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- -------------------------------------------------------
  -- 3. Idempotency: if snapshot already exists, return it.
  -- -------------------------------------------------------

  if v_request.deposit_type is not null then

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

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', v_request.id,
      'request_status', v_request.status,
      'requires_deposit', true,
      'deposit', jsonb_build_object(
        'rule_id', v_request.deposit_rule_id,
        'rule_name', v_request.deposit_rule_name,
        'type', v_request.deposit_type,
        'value', v_request.deposit_value,
        'appointment_price', v_request.appointment_price_snapshot,
        'amount', v_request.deposit_amount,
        'payment_instructions', v_payment_instructions
      )
    );
  end if;


  -- -------------------------------------------------------
  -- 4. Appointment type / current price
  -- -------------------------------------------------------

  if v_request.appointment_type_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_TYPE_REQUIRED',
      'request_id', v_request.id
    );
  end if;

  select at.price
  into v_appointment_price
  from public.appointment_types at
  where at.id = v_request.appointment_type_id
    and at.doctor_id = v_request.doctor_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'APPOINTMENT_TYPE_NOT_FOUND',
      'request_id', v_request.id
    );
  end if;


  -- -------------------------------------------------------
  -- 5. Count matching active rules using persisted intake.
  -- -------------------------------------------------------
  --
  -- Matching semantics intentionally remain identical to
  -- Phase 7: trimmed, case-sensitive EQUALS.
  -- -------------------------------------------------------

  select count(*)::integer
  into v_match_count
  from public.deposit_rules dr
  where dr.doctor_id = v_request.doctor_id
    and dr.is_active = true
    and (
      dr.scope = 'ALL'

      or (
        dr.scope = 'APPOINTMENT_TYPE'
        and dr.appointment_type_id = v_request.appointment_type_id
      )

      or (
        dr.scope = 'INTAKE_FIELD'
        and exists (
          select 1
          from public.appointment_request_intake_answers aria
          where aria.request_id = v_request.id
            and aria.doctor_id = v_request.doctor_id
            and aria.intake_field_id = dr.intake_field_id
            and dr.operator = 'EQUALS'
            and btrim(coalesce(aria.value, ''))
                = btrim(coalesce(dr.condition_value, ''))
        )
      )
    );

  if v_match_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEPOSIT_RULE_NOT_FOUND',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;

  if v_match_count > 1 then
    return jsonb_build_object(
      'ok', false,
      'code', 'AMBIGUOUS_DEPOSIT_RULE',
      'request_id', v_request.id,
      'request_status', v_request.status,
      'matching_rule_count', v_match_count
    );
  end if;


  -- -------------------------------------------------------
  -- 6. Load the single matching rule.
  -- -------------------------------------------------------

  select
    dr.id,
    dr.name,
    dr.deposit_type,
    dr.deposit_value
  into
    v_rule_id,
    v_rule_name,
    v_deposit_type,
    v_deposit_value
  from public.deposit_rules dr
  where dr.doctor_id = v_request.doctor_id
    and dr.is_active = true
    and (
      dr.scope = 'ALL'

      or (
        dr.scope = 'APPOINTMENT_TYPE'
        and dr.appointment_type_id = v_request.appointment_type_id
      )

      or (
        dr.scope = 'INTAKE_FIELD'
        and exists (
          select 1
          from public.appointment_request_intake_answers aria
          where aria.request_id = v_request.id
            and aria.doctor_id = v_request.doctor_id
            and aria.intake_field_id = dr.intake_field_id
            and dr.operator = 'EQUALS'
            and btrim(coalesce(aria.value, ''))
                = btrim(coalesce(dr.condition_value, ''))
        )
      )
    )
  limit 1;


  -- -------------------------------------------------------
  -- 7. Calculate amount.
  -- -------------------------------------------------------

  if v_deposit_type = 'PERCENTAGE' then

    if v_appointment_price is null
       or v_appointment_price <= 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'DEPOSIT_PRICE_REQUIRED',
        'request_id', v_request.id,
        'request_status', v_request.status,
        'rule_id', v_rule_id
      );
    end if;

    v_deposit_amount := round(
      v_appointment_price * v_deposit_value / 100,
      2
    );

  elsif v_deposit_type = 'FIXED' then

    v_deposit_amount := v_deposit_value;

  else

    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_DEPOSIT_TYPE',
      'request_id', v_request.id,
      'rule_id', v_rule_id
    );

  end if;


  -- -------------------------------------------------------
  -- 8. Persist immutable economic snapshot.
  -- -------------------------------------------------------

  update public.appointment_requests
  set
    deposit_rule_id = v_rule_id,
    deposit_rule_name = v_rule_name,
    deposit_type = v_deposit_type,
    deposit_value = v_deposit_value,
    appointment_price_snapshot = v_appointment_price,
    deposit_amount = v_deposit_amount,
    updated_at = now()
  where id = v_request.id;


  -- -------------------------------------------------------
  -- 9. Load payment instructions configured in Phase 5.
  -- -------------------------------------------------------

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


  -- -------------------------------------------------------
  -- 10. Stable response for HelloPx server runtime.
  -- -------------------------------------------------------

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'request_id', v_request.id,
    'request_status', 'WAITING_DEPOSIT',
    'requires_deposit', true,
    'deposit', jsonb_build_object(
      'rule_id', v_rule_id,
      'rule_name', v_rule_name,
      'type', v_deposit_type,
      'value', v_deposit_value,
      'appointment_price', v_appointment_price,
      'amount', v_deposit_amount,
      'payment_instructions', v_payment_instructions
    )
  );

end;
$$;


-- =========================================================
-- 3. Security
-- =========================================================
-- Server integration only. No browser execution.
-- =========================================================

revoke all
on function public.resolve_deposit_for_request(uuid)
from public;

revoke all
on function public.resolve_deposit_for_request(uuid)
from anon;

revoke all
on function public.resolve_deposit_for_request(uuid)
from authenticated;

grant execute
on function public.resolve_deposit_for_request(uuid)
to service_role;

commit;