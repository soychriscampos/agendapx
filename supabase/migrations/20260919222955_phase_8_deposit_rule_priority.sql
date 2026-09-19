begin;

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

  v_rule_id uuid;
  v_rule_name text;
  v_deposit_type text;
  v_deposit_value numeric(10,2);

  v_appointment_price numeric(10,2);
  v_deposit_amount numeric(10,2);

  v_payment_instructions jsonb;
begin

  -- 1. Lock request for safe retries/concurrency.
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


  -- 2. Only pending-deposit requests can be resolved here.
  if v_request.status <> 'WAITING_DEPOSIT' then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_WAITING_DEPOSIT',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- 3. Idempotency: return existing snapshot unchanged.
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


  -- 4. Appointment type / current price.
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


  -- 5. Select the highest-priority matching rule.
  --
  -- Lower sort_order = higher priority.
  -- If several rules apply, the first configured by the doctor wins.
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
  order by dr.sort_order asc, dr.created_at asc, dr.id asc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEPOSIT_RULE_NOT_FOUND',
      'request_id', v_request.id,
      'request_status', v_request.status
    );
  end if;


  -- 6. Calculate amount.
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


  -- 7. Persist immutable snapshot of the winning rule.
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


  -- 8. Payment instructions.
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


  -- 9. Stable runtime response.
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