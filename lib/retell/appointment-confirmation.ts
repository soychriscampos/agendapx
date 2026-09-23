import { APIError } from 'retell-sdk'

import { getDateTimeInTimezone } from '@/lib/agenda/timezone'
import { getRetellClient } from '@/lib/retell/client'
import { getRetellDynamicVariables } from '@/lib/retell/tools'
import { formatTimeForVoice } from '@/lib/retell/voice-time'
import { createAdminClient } from '@/lib/supabase/admin'

type RecordValue = Record<string, unknown>

type ConfirmationClaim = {
  ok: boolean
  code: string
  idempotent: boolean
  appointment_id?: string
  attempt_id?: string
  attempt_status?: string
  retell_call_id?: string | null
  doctor_id?: string
  retell_agent_id?: string
  from_number?: string
  to_number?: string
  patient_name?: string
  contact_name?: string | null
  appointment_type_name?: string | null
  start_at?: string
  end_at?: string
  doctor_timezone?: string
  local_date?: string
  local_time?: string
}

function objectRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
}

function parseClaim(value: unknown): ConfirmationClaim | null {
  const result = objectRecord(value)
  if (!result || typeof result.ok !== 'boolean' || typeof result.code !== 'string') return null
  if (result.ok && typeof result.appointment_id !== 'string') return null
  return result as unknown as ConfirmationClaim
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function durationLabel(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}`
  return `${minutes} minutos`
}

function appointmentDateForVoice(claim: ConfirmationClaim) {
  if (!(claim.start_at && claim.doctor_timezone)) return claim.local_date ?? ''
  const parts = new Intl.DateTimeFormat('es-MX', { timeZone: claim.doctor_timezone, weekday: 'long', day: 'numeric', month: 'long' })
    .formatToParts(new Date(claim.start_at))
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.weekday} ${values.day} de ${values.month}`
}

function confirmationBeginMessage(variables: Record<string, string>, claim: ConfirmationClaim) {
  return `Hola, hablo del consultorio del Dr. ${variables.doctor_name}. Llamo para confirmar la asistencia de ${claim.patient_name} a su cita del ${appointmentDateForVoice(claim)} a las ${formatTimeForVoice(claim.local_time ?? '')}.`
}

function isDefiniteRejection(error: unknown) {
  return error instanceof APIError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)
}

async function markFailed(attemptId: string, error: string) {
  const admin = createAdminClient()
  const { data, error: rpcError } = await admin.rpc('mark_appointment_confirmation_call_failed', {
    p_attempt_id: attemptId,
    p_error: error.slice(0, 2000),
  })
  if (rpcError || objectRecord(data)?.ok !== true) throw new Error('No se pudo cerrar el intento de confirmación.')
}

/** Starts one confirmation call for an existing active appointment. */
export async function startAppointmentConfirmationCall(appointmentId: string) {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return { ok: false as const, code: 'CONFIRMATION_UNAVAILABLE' }
  }

  let claim: ConfirmationClaim | null
  try {
    const { data, error } = await admin.rpc('claim_appointment_confirmation_call', { p_appointment_id: appointmentId })
    if (error) throw error
    claim = parseClaim(data)
  } catch (error) {
    console.error('[Retell confirmation] Could not claim call.', { appointmentId, error })
    return { ok: false as const, code: 'CONFIRMATION_CLAIM_FAILED' }
  }
  if (!claim) return { ok: false as const, code: 'CONFIRMATION_CLAIM_INVALID' }
  if (!claim.ok) return { ok: false as const, code: claim.code, appointment_id: claim.appointment_id ?? appointmentId }
  if (claim.idempotent) return { ok: true as const, idempotent: true, code: claim.code, appointment_id: claim.appointment_id!, attempt_id: claim.attempt_id ?? null, retell_call_id: claim.retell_call_id ?? null }

  const attemptId = claim.attempt_id
  if (!nonEmpty(attemptId) || claim.attempt_status !== 'CREATING' || !nonEmpty(claim.retell_agent_id) || !nonEmpty(claim.from_number) || !nonEmpty(claim.to_number) || !nonEmpty(claim.patient_name) || !nonEmpty(claim.start_at) || !nonEmpty(claim.end_at) || !nonEmpty(claim.doctor_timezone)) {
    if (nonEmpty(attemptId) && claim.attempt_status === 'CREATING') await markFailed(attemptId, 'Confirmation claim did not include required outbound context.').catch(() => undefined)
    return { ok: false as const, code: 'CONFIRMATION_CLAIM_INVALID', appointment_id: claim.appointment_id! }
  }
  const localStart = getDateTimeInTimezone(claim.doctor_timezone!, new Date(claim.start_at!))
  const durationMinutes = Math.round((new Date(claim.end_at!).getTime() - new Date(claim.start_at!).getTime()) / 60000)
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    await markFailed(attemptId, 'Confirmation claim included an invalid appointment duration.').catch(() => undefined)
    return { ok: false as const, code: 'CONFIRMATION_CLAIM_INVALID', appointment_id: claim.appointment_id!, attempt_id: attemptId }
  }
  claim.local_date = localStart.date
  claim.local_time = localStart.time

  let baseVariables: Record<string, string>
  try {
    baseVariables = await getRetellDynamicVariables(claim.retell_agent_id)
  } catch {
    await markFailed(attemptId, 'Could not load the Retell agent context.').catch(() => undefined)
    return { ok: false as const, code: 'CONFIRMATION_CONTEXT_UNAVAILABLE', appointment_id: claim.appointment_id!, attempt_id: attemptId }
  }

  const dynamicVariables: Record<string, string> = {
    ...baseVariables,
    call_mode: 'appointment_confirmation',
    appointment_id: claim.appointment_id!,
    confirmation_attempt_id: attemptId,
    patient_name: claim.patient_name,
    contact_name: claim.contact_name ?? '',
    appointment_type_name: claim.appointment_type_name ?? '',
    appointment_local_date: claim.local_date,
    appointment_local_time: claim.local_time,
    appointment_date_spoken: appointmentDateForVoice(claim),
    appointment_time_spoken: formatTimeForVoice(claim.local_time),
    appointment_duration: durationLabel(durationMinutes),
    appointment_duration_minutes: String(durationMinutes),
    appointment_timezone: claim.doctor_timezone,
  }

  let retellCallId: string
  try {
    const call = await getRetellClient().call.createPhoneCall({
      from_number: claim.from_number,
      to_number: claim.to_number,
      override_agent_id: claim.retell_agent_id,
      agent_override: {
        retell_llm: {
          start_speaker: 'user',
          begin_after_user_silence_ms: 700,
          begin_message: confirmationBeginMessage(baseVariables, claim),
        },
      },
      metadata: { appointment_id: claim.appointment_id!, confirmation_attempt_id: attemptId, call_mode: 'appointment_confirmation' },
      retell_llm_dynamic_variables: dynamicVariables,
    }, { idempotencyKey: `appointment-confirmation:${attemptId}` })
    if (!nonEmpty(call.call_id)) throw new Error('Retell response did not include a call id.')
    retellCallId = call.call_id
  } catch (error) {
    if (isDefiniteRejection(error)) {
      const rejected = error as APIError
      await markFailed(attemptId, `Retell rejected outbound request (HTTP ${rejected.status}).`).catch(() => undefined)
      return { ok: false as const, code: 'RETELL_CALL_REJECTED', appointment_id: claim.appointment_id!, attempt_id: attemptId }
    }
    // A timeout may still have created the call. Keep CREATING active.
    console.error('[Retell confirmation] Outbound result is uncertain; attempt remains active.', { appointmentId, attemptId })
    return { ok: false as const, code: 'RETELL_CALL_RESULT_UNCERTAIN', appointment_id: claim.appointment_id!, attempt_id: attemptId }
  }

  try {
    const { data, error } = await admin.rpc('mark_appointment_confirmation_call_dispatched', { p_attempt_id: attemptId, p_retell_call_id: retellCallId })
    if (error) throw error
    const result = objectRecord(data)
    const code = typeof result?.code === 'string' ? result.code : ''
    if (code === 'CALL_ALREADY_FINISHED' || code === 'CALL_ALREADY_DISPATCHED') return { ok: true as const, idempotent: true, code, appointment_id: claim.appointment_id!, attempt_id: attemptId, retell_call_id: retellCallId }
    if (result?.ok !== true) throw new Error('Dispatch persistence was rejected.')
  } catch {
    // Retell has already accepted a known call; never create another one.
    return { ok: false as const, code: 'DISPATCH_PERSISTENCE_FAILED', appointment_id: claim.appointment_id!, attempt_id: attemptId }
  }

  return { ok: true as const, idempotent: false, code: 'CALL_DISPATCHED', appointment_id: claim.appointment_id!, attempt_id: attemptId, retell_call_id: retellCallId }
}
