import { APIError } from 'retell-sdk'

import { getRetellClient } from '@/lib/retell/client'
import { getRetellDynamicVariables } from '@/lib/retell/tools'
import { createAdminClient } from '@/lib/supabase/admin'

type JsonRecord = Record<string, unknown>

type SchedulingClaim = {
  ok: boolean
  code: string
  idempotent: boolean
  request_id?: string
  attempt_id?: string
  attempt_number?: number
  attempt_status?: string
  retell_call_id?: string | null
  doctor_id?: string
  retell_agent_id?: string
  from_number?: string
  to_number?: string
  patient_name?: string
  appointment_type_name?: string | null
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function parseClaim(value: unknown): SchedulingClaim | null {
  const result = asRecord(value)
  if (!result || typeof result.ok !== 'boolean' || typeof result.code !== 'string') return null
  if (result.ok === true && typeof result.request_id !== 'string') return null
  return result as unknown as SchedulingClaim
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function markFailed(attemptId: string, error: string) {
  const admin = createAdminClient()
  const { data, error: rpcError } = await admin.rpc('mark_scheduling_call_failed', {
    p_attempt_id: attemptId,
    p_error: error.slice(0, 2000),
  })
  if (rpcError) throw rpcError
  const result = asRecord(data)
  if (result?.ok !== true) throw new Error('No se pudo marcar fallido el intento outbound.')
}

async function getContactName(admin: ReturnType<typeof createAdminClient>, doctorId: string, requestId: string) {
  try {
    const { data: request } = await admin
      .from('appointment_requests')
      .select('origin_contact_id')
      .eq('id', requestId)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    if (!request?.origin_contact_id) return null

    const { data: contact } = await admin
      .from('contacts')
      .select('full_name')
      .eq('id', request.origin_contact_id)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    return typeof contact?.full_name === 'string' && contact.full_name.trim() ? contact.full_name.trim() : null
  } catch {
    return null
  }
}

function schedulingBeginMessage(variables: Record<string, string>, patientName: string, contactName: string | null) {
  const greeting = contactName ? `${variables.greeting}, ${contactName}.` : `${variables.greeting}.`
  return `${greeting} Soy ${variables.assistant_name}, del consultorio del Dr. ${variables.doctor_name}. Ya tenemos confirmado el anticipo de la cita de ${patientName} y te llamo para terminar de agendarla.`
}

function isDefiniteRejection(error: unknown) {
  if (!(error instanceof APIError)) return false
  // These responses can occur after an upstream timeout or transient
  // processing, so keep the attempt active and require reconciliation.
  return error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)
}

/** Starts one outbound call for an already-existing, deposit-confirmed request. */
export async function startDepositSchedulingCall(requestId: string) {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    console.error('[Retell scheduling] Service configuration unavailable.', { requestId })
    return { ok: false as const, code: 'SCHEDULING_UNAVAILABLE' }
  }

  let claim: SchedulingClaim | null
  try {
    const { data, error } = await admin.rpc('claim_scheduling_call', { p_request_id: requestId })
    if (error) throw error
    claim = parseClaim(data)
  } catch (error) {
    console.error('[Retell scheduling] Could not claim call attempt.', {
      requestId,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return { ok: false as const, code: 'SCHEDULING_CLAIM_FAILED' }
  }

  if (!claim) {
    console.error('[Retell scheduling] Invalid claim response.', { requestId })
    return { ok: false as const, code: 'SCHEDULING_CLAIM_INVALID' }
  }
  if (!claim.ok) return { ok: false as const, code: claim.code, request_id: claim.request_id ?? requestId }
  const claimedRequestId = claim.request_id!

  if (claim.idempotent) {
    return {
      ok: true as const,
      idempotent: true,
      code: claim.code,
      request_id: claimedRequestId,
      attempt_id: claim.attempt_id ?? null,
      attempt_status: claim.attempt_status ?? null,
      retell_call_id: claim.retell_call_id ?? null,
    }
  }

  const attemptId = claim.attempt_id
  if (!nonEmpty(attemptId) || claim.attempt_status !== 'CREATING'
    || !nonEmpty(claim.retell_agent_id) || !nonEmpty(claim.from_number)
    || !nonEmpty(claim.to_number) || !nonEmpty(claim.patient_name)
    || !nonEmpty(claim.appointment_type_name)) {
    if (nonEmpty(attemptId) && claim.attempt_status === 'CREATING') {
      try {
        await markFailed(attemptId, 'Scheduling claim did not include required outbound context.')
      } catch (error) {
        console.error('[Retell scheduling] Could not close invalid call attempt.', { requestId, attemptId, error })
      }
    }
    return { ok: false as const, code: 'SCHEDULING_CLAIM_INVALID', request_id: claimedRequestId }
  }

  let baseDynamicVariables: Record<string, string>
  try {
    baseDynamicVariables = await getRetellDynamicVariables(claim.retell_agent_id)
  } catch (error) {
    try {
      await markFailed(attemptId, 'Could not load the Retell agent context.')
    } catch {
      console.error('[Retell scheduling] Could not close attempt after context failure.', { requestId, attemptId })
    }
    console.error('[Retell scheduling] Agent context unavailable.', {
      requestId,
      attemptId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
    return { ok: false as const, code: 'SCHEDULING_CONTEXT_UNAVAILABLE', request_id: claimedRequestId, attempt_id: attemptId }
  }

  const dynamicVariables: Record<string, string> = {
    ...baseDynamicVariables,
    call_mode: 'deposit_follow_up',
    scheduling_mode: 'deposit_follow_up',
    request_id: claimedRequestId,
    patient_name: claim.patient_name,
    appointment_type_name: claim.appointment_type_name,
  }
  const contactName = nonEmpty(claim.doctor_id)
    ? await getContactName(admin, claim.doctor_id, claimedRequestId)
    : null
  const beginMessage = schedulingBeginMessage(baseDynamicVariables, claim.patient_name, contactName)

  let retellClient: ReturnType<typeof getRetellClient>
  try {
    retellClient = getRetellClient()
  } catch {
    try {
      await markFailed(attemptId, 'RETELL_API_KEY is not configured.')
    } catch {
      console.error('[Retell scheduling] Could not record missing Retell configuration.', { requestId, attemptId })
    }
    console.error('[Retell scheduling] Outbound client is not configured.', { requestId, attemptId })
    return { ok: false as const, code: 'RETELL_NOT_CONFIGURED', request_id: claimedRequestId, attempt_id: attemptId }
  }

  let retellCallId: string
  try {
    const call = await retellClient.call.createPhoneCall({
      from_number: claim.from_number,
      to_number: claim.to_number,
      override_agent_id: claim.retell_agent_id,
      agent_override: {
        retell_llm: {
          start_speaker: 'user',
          begin_after_user_silence_ms: 700,
          begin_message: beginMessage,
        },
      },
      metadata: { request_id: claim.request_id, scheduling_attempt_id: attemptId },
      retell_llm_dynamic_variables: dynamicVariables,
    })
    if (!nonEmpty(call.call_id)) throw new Error('Retell response did not include a call id.')
    retellCallId = call.call_id
  } catch (error) {
    if (isDefiniteRejection(error)) {
      const rejectedError = error as APIError
      try {
        await markFailed(attemptId, `Retell rejected outbound request (HTTP ${rejectedError.status}).`)
        console.error('[Retell scheduling] Outbound call was rejected.', { requestId, attemptId, status: rejectedError.status })
        return { ok: false as const, code: 'RETELL_CALL_REJECTED', request_id: claim.request_id, attempt_id: attemptId }
      } catch {
        console.error('[Retell scheduling] Call rejection could not be recorded.', { requestId, attemptId, status: rejectedError.status })
        return { ok: false as const, code: 'RETELL_CALL_REJECTED_UNRECORDED', request_id: claim.request_id, attempt_id: attemptId }
      }
    }

    // The request may have reached Retell even if HelloPx received a timeout.
    // Leave CREATING active so another confirmation cannot dial again.
    console.error('[Retell scheduling] Outbound result is uncertain; attempt remains active.', {
      requestId,
      attemptId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
    return { ok: false as const, code: 'RETELL_CALL_RESULT_UNCERTAIN', request_id: claimedRequestId, attempt_id: attemptId }
  }

  try {
    const { data, error } = await admin.rpc('mark_scheduling_call_dispatched', {
      p_attempt_id: attemptId,
      p_retell_call_id: retellCallId,
    })
    if (error) throw error
    const dispatched = asRecord(data)
    const dispatchCode = typeof dispatched?.code === 'string' ? dispatched.code : null
    if (dispatchCode === 'CALL_ALREADY_FINISHED') {
      console.info('[Retell scheduling] Webhook finalized the call before dispatch persistence.', {
        requestId,
        attemptId,
        retellCallId,
        code: dispatchCode,
      })
      return {
        ok: true as const,
        idempotent: true,
        code: dispatchCode,
        request_id: claimedRequestId,
        attempt_id: attemptId,
        retell_call_id: retellCallId,
      }
    }
    if (dispatchCode === 'CALL_ALREADY_DISPATCHED') {
      console.info('[Retell scheduling] Dispatch persistence was already recorded.', {
        requestId,
        attemptId,
        retellCallId,
        code: dispatchCode,
      })
      return {
        ok: true as const,
        idempotent: true,
        code: dispatchCode,
        request_id: claimedRequestId,
        attempt_id: attemptId,
        retell_call_id: retellCallId,
      }
    }
    if (dispatchCode === 'RETELL_CALL_ID_MISMATCH') {
      console.error('[Retell scheduling] Dispatch call id does not match the persisted attempt.', {
        requestId,
        attemptId,
        retellCallId,
        code: dispatchCode,
      })
      return { ok: false as const, code: 'DISPATCH_CALL_ID_MISMATCH', request_id: claimedRequestId, attempt_id: attemptId }
    }
    if (dispatched?.ok !== true) throw new Error('Dispatch persistence was rejected.')
  } catch (error) {
    // Retell already returned a call id. Never mark this attempt FAILED or
    // create another call; the known id is retained in logs for reconciliation.
    console.error('[Retell scheduling] Call exists but dispatch state was not saved.', {
      requestId,
      attemptId,
      retellCallId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
    return { ok: false as const, code: 'DISPATCH_PERSISTENCE_FAILED', request_id: claimedRequestId, attempt_id: attemptId }
  }

  return {
    ok: true as const,
    idempotent: false,
    code: 'CALL_DISPATCHED',
    request_id: claimedRequestId,
    attempt_id: attemptId,
    retell_call_id: retellCallId,
  }
}
