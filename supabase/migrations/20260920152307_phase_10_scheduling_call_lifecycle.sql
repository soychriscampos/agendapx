-- ============================================================
-- Phase 10
-- Atomic lifecycle completion for outbound scheduling calls
-- ============================================================

create or replace function public.finish_scheduling_call(
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
  v_attempt public.scheduling_call_attempts%rowtype;
  v_request public.appointment_requests%rowtype;
  v_expected_agent_id text;
  v_final_status text;
begin

  -- ----------------------------------------------------------
  -- 1. Validate input
  -- ----------------------------------------------------------

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
  -- 2. Lock scheduling attempt
  -- ----------------------------------------------------------

  select *
  into v_attempt
  from public.scheduling_call_attempts
  where retell_call_id = btrim(p_retell_call_id)
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'SCHEDULING_CALL_NOT_FOUND'
    );
  end if;


  -- ----------------------------------------------------------
  -- 3. Lock related request in same transaction
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
  -- 4. Validate Retell agent belongs to attempt's doctor
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
  -- 5. Terminal attempts are immutable
  --
  -- Retell may retry call_ended.
  -- Do not replace one terminal outcome with another.
  -- ----------------------------------------------------------

  if v_attempt.status in (
    'COMPLETED',
    'NO_ANSWER',
    'INTERRUPTED',
    'FAILED'
  ) then

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'CALL_ALREADY_FINISHED',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status,
      'request_status', v_request.status
    );

  end if;


  -- ----------------------------------------------------------
  -- 6. Only a known dispatched Retell call can be finalized
  -- ----------------------------------------------------------

  if v_attempt.status <> 'DISPATCHED' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_DISPATCHED',
      'attempt_id', v_attempt.id,
      'request_id', v_attempt.request_id,
      'attempt_status', v_attempt.status,
      'request_status', v_request.status
    );
  end if;


  -- ----------------------------------------------------------
  -- 7. Booking result has precedence over call outcome
  --
  -- If book_appointment already closed the request while the
  -- call was ending, the scheduling call succeeded regardless
  -- of the Retell disconnection classification.
  -- ----------------------------------------------------------

  if v_request.status = 'CONFIRMED' then

    v_final_status := 'COMPLETED';

  elsif v_request.status = 'WAITING_SCHEDULING' then

    v_final_status := p_outcome;

  elsif v_request.status = 'CANCELLED' then

    -- Do not reinterpret a cancelled request as successful.
    -- The call itself is simply considered finished.
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
  -- 8. Finalize attempt
  --
  -- Never modify appointment_request here.
  -- ----------------------------------------------------------

  update public.scheduling_call_attempts
  set
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
    'request_status', v_request.status
  );

end;
$function$;


revoke all
on function public.finish_scheduling_call(text, text, text)
from public, anon, authenticated;

grant execute
on function public.finish_scheduling_call(text, text, text)
to service_role;