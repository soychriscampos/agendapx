create or replace function public.finish_scheduling_call_by_attempt(
  p_attempt_id uuid,
  p_request_id uuid,
  p_retell_call_id text,
  p_agent_id text,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_attempt public.scheduling_call_attempts%rowtype;
  v_request public.appointment_requests%rowtype;
  v_expected_agent_id text;
  v_final_status text;
begin

  -- ----------------------------------------------------------
  -- 1. Validate input
  -- ----------------------------------------------------------

  if p_attempt_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_ID_REQUIRED'
    );
  end if;

  if p_request_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_ID_REQUIRED'
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
  -- 2. Lock attempt by authoritative scheduling_attempt_id
  -- ----------------------------------------------------------

  select *
  into v_attempt
  from public.scheduling_call_attempts
  where id = p_attempt_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'SCHEDULING_CALL_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Validate request correlation from Retell metadata
  -- ----------------------------------------------------------

  if v_attempt.request_id <> p_request_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id
    );
  end if;


  -- ----------------------------------------------------------
  -- 4. Lock related request
  -- ----------------------------------------------------------

  select *
  into v_request
  from public.appointment_requests
  where id = v_attempt.request_id
    and doctor_id = v_attempt.doctor_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_NOT_FOUND',
      'attempt_id', v_attempt.id
    );
  end if;


  -- ----------------------------------------------------------
  -- 5. Validate Retell agent
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
      'request_id', v_attempt.request_id
    );

  end if;


  -- ----------------------------------------------------------
  -- 6. Validate / bind Retell call ID
  --
  -- For a webhook that wins the race against
  -- mark_scheduling_call_dispatched, the attempt can still be
  -- CREATING with retell_call_id = null.
  -- ----------------------------------------------------------

  if v_attempt.retell_call_id is not null
     and v_attempt.retell_call_id <> btrim(p_retell_call_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status
    );

  end if;


  -- ----------------------------------------------------------
  -- 7. Terminal attempts are immutable / idempotent
  -- ----------------------------------------------------------

  if v_attempt.status in (
    'COMPLETED',
    'NO_ANSWER',
    'INTERRUPTED',
    'FAILED'
  ) then

    -- A terminal attempt without a call ID can still be the
    -- reconciled result of a raced webhook only if this RPC
    -- previously persisted it. Do not rewrite terminal state.
    if v_attempt.retell_call_id is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'TERMINAL_ATTEMPT_WITHOUT_CALL_ID',
        'attempt_id', v_attempt.id,
        'request_id', v_attempt.request_id,
        'attempt_status', v_attempt.status
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_FINISHED',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status,
      'request_status', v_request.status,
      'retell_call_id', v_attempt.retell_call_id
    );

  end if;


  -- ----------------------------------------------------------
  -- 8. Only CREATING or DISPATCHED may be finalized
  -- ----------------------------------------------------------

  if v_attempt.status not in ('CREATING', 'DISPATCHED') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_FINISHABLE',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 9. Booking result has precedence over call outcome
  -- ----------------------------------------------------------

  if v_request.status = 'CONFIRMED' then

    v_final_status := 'COMPLETED';

  elsif v_request.status = 'WAITING_SCHEDULING' then

    v_final_status := p_outcome;

  elsif v_request.status = 'CANCELLED' then

    v_final_status := 'COMPLETED';

  else

    return jsonb_build_object(
      'ok', false,
      'code', 'REQUEST_STATE_INVALID_FOR_CALL_FINISH',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status,
      'request_status', v_request.status
    );

  end if;


  -- ----------------------------------------------------------
  -- 10. Bind call ID if needed and finalize atomically
  -- ----------------------------------------------------------

  update public.scheduling_call_attempts
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
    'code', 'SCHEDULING_CALL_FINISHED',
    'attempt_id', v_attempt.id,
    'request_id', v_attempt.request_id,
    'attempt_status', v_attempt.status,
    'request_status', v_request.status,
    'retell_call_id', v_attempt.retell_call_id
  );

end;
$function$;


-- Keep the same execution model as the existing scheduling RPCs.
revoke all on function public.finish_scheduling_call_by_attempt(
  uuid,
  uuid,
  text,
  text,
  text
) from public;

revoke all on function public.finish_scheduling_call_by_attempt(
  uuid,
  uuid,
  text,
  text,
  text
) from anon;

revoke all on function public.finish_scheduling_call_by_attempt(
  uuid,
  uuid,
  text,
  text,
  text
) from authenticated;

grant execute on function public.finish_scheduling_call_by_attempt(
  uuid,
  uuid,
  text,
  text,
  text
) to service_role;



create or replace function public.mark_scheduling_call_dispatched(
  p_attempt_id uuid,
  p_retell_call_id text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
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


  -- ----------------------------------------------------------
  -- Terminal state may have won the race through the webhook.
  -- Never reactivate it.
  -- ----------------------------------------------------------

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
        'request_id', v_attempt.request_id,
        'attempt_status', v_attempt.status,
        'retell_call_id', v_attempt.retell_call_id
      );

    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status
    );

  end if;


  -- ----------------------------------------------------------
  -- Exact retry after successful persistence
  -- ----------------------------------------------------------

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


  if v_attempt.status = 'DISPATCHED'
     and v_attempt.retell_call_id <> btrim(p_retell_call_id) then

    return jsonb_build_object(
      'ok', false,
      'code', 'RETELL_CALL_ID_MISMATCH',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status
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