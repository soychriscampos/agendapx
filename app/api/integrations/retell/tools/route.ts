import { timingSafeEqual } from 'node:crypto'
import { Retell } from 'retell-sdk'

import {
  RetellToolError,
  bookRetellAppointment,
  getRetellAvailability,
  getRetellContext,
  prepareRetellBooking,
} from '@/lib/retell/tools'
import {
  cancelAppointmentFromConfirmation,
  confirmAppointmentAttendance,
  getAppointmentConfirmationAvailability,
  getAppointmentConfirmationContext,
  rescheduleAppointmentFromConfirmation,
  type ConfirmationCallContext,
} from '@/lib/retell/appointment-confirmation-tools'
import { createAdminClient } from '@/lib/supabase/admin'

function hasValidManualSecret(request: Request) {
  const expected = process.env.RETELL_TOOLS_SECRET
  const authorization = request.headers.get('authorization')
  if (process.env.NODE_ENV === 'production' || !expected || !authorization?.startsWith('Bearer ')) return false
  const received = authorization.slice('Bearer '.length)
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

async function isAuthorized(request: Request, rawBody: string) {
  const apiKey = process.env.RETELL_API_KEY
  const signature = request.headers.get('x-retell-signature')

  if (apiKey) {
    if (!signature) return false
    try {
      return await Retell.verify(rawBody, apiKey, signature)
    } catch {
      return false
    }
  }

  return hasValidManualSecret(request)
}

function callRecord(body: Record<string, unknown>) {
  const call = body.call
  if (!call || typeof call !== 'object' || Array.isArray(call)) throw new RetellToolError('INVALID_REQUEST', 'El call object no es válido.')
  return call as Record<string, unknown>
}

function argsRecord(body: Record<string, unknown>) {
  const args = body.args
  if (args === undefined || args === null) return {}
  if (typeof args !== 'object' || Array.isArray(args)) throw new RetellToolError('INVALID_REQUEST', 'Los argumentos no son válidos.')
  return args as Record<string, unknown>
}

function errorResponse(error: unknown) {
  if (error instanceof RetellToolError) {
    const agentMessage = error.code === 'INVALID_REQUEST'
      ? error.agentMessage ?? 'No pude continuar con la información recibida. Pregunta por el dato faltante o corrígelo y vuelve a intentarlo.'
      : error.message
    return Response.json({ ok: false, code: error.code, error: agentMessage, retryable: error.retryable }, { status: error.status })
  }
  return Response.json({ ok: false, code: 'INTERNAL_ERROR', error: 'No se pudo completar la operación.' }, { status: 500 })
}

function metadataRecord(call: Record<string, unknown>) {
  const metadata = call.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : null
}

async function confirmationContextForCall(call: Record<string, unknown>, agentId: string, callId: string): Promise<ConfirmationCallContext | null> {
  const metadata = metadataRecord(call)
  if (metadata?.call_mode === 'appointment_confirmation' && (call.call_type !== 'phone_call' || call.direction !== 'outbound')) return null
  if (metadata?.call_mode !== 'appointment_confirmation' || typeof metadata.appointment_id !== 'string' || typeof metadata.confirmation_attempt_id !== 'string') return null
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('appointment_confirmation_call_attempts')
    .select('id, appointment_id, retell_call_id, status')
    .eq('id', metadata.confirmation_attempt_id)
    .eq('appointment_id', metadata.appointment_id)
    .maybeSingle()
  if (error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo validar la llamada de confirmación.', 503, true)
  // Retell signs this payload. A null call ID is permitted only during the
  // webhook-before-dispatch race; a different known ID is never accepted.
  if (!data || (data.retell_call_id !== null && data.retell_call_id !== callId) || !['CREATING', 'DISPATCHED'].includes(data.status)) return null
  return { appointmentId: data.appointment_id, attemptId: data.id, agentId }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  if (!(await isAuthorized(request, rawBody))) return Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'No autorizado.' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'No pude continuar con la información recibida. Pregunta por el dato faltante o corrígelo y vuelve a intentarlo.',
      retryable: false,
    }, { status: 400 })
  }

  try {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new RetellToolError('INVALID_REQUEST', 'El nombre de la función es obligatorio.')
    const functionName = body.name.trim()
    const call = callRecord(body)
    const args = argsRecord(body)
    const agentId = call.agent_id
    const callId = call.call_id

    if (typeof agentId !== 'string' || !agentId.trim()) throw new RetellToolError('INVALID_REQUEST', 'El call object no contiene agent_id.')
    if (typeof callId !== 'string' || !callId.trim()) throw new RetellToolError('INVALID_REQUEST', 'El call object no contiene call_id.')

    // Retell's phone-call contract identifies the callee with to_number.
    // It is only a secondary check for inbound phone calls; agent_id remains primary.
    const technicalPhoneNumber = call.call_type === 'phone_call' && call.direction === 'inbound' && typeof call.to_number === 'string'
      ? call.to_number.trim()
      : undefined
    const operationInput = { ...args, agent_id: agentId.trim(), call_id: callId.trim(), phone_number: technicalPhoneNumber }
    const confirmation = await confirmationContextForCall(call, agentId.trim(), callId.trim())
    const callMetadata = metadataRecord(call)
    const declaredConfirmationMode = callMetadata?.call_mode === 'appointment_confirmation'

    const confirmationTools = new Set([
      'get_appointment_confirmation_context',
      'confirm_appointment_attendance',
      'cancel_appointment_from_confirmation',
      'get_appointment_confirmation_availability',
      'reschedule_appointment_from_confirmation',
    ])
    if (confirmationTools.has(functionName)) {
      if (!confirmation) throw new RetellToolError('TOOL_NOT_ALLOWED_FOR_CALL_MODE', 'Esta operación sólo está disponible durante una llamada de confirmación autorizada.', 403)
      if (functionName === 'get_appointment_confirmation_context') return Response.json(await getAppointmentConfirmationContext(confirmation))
      if (functionName === 'confirm_appointment_attendance') return Response.json(await confirmAppointmentAttendance(confirmation))
      if (functionName === 'cancel_appointment_from_confirmation') return Response.json(await cancelAppointmentFromConfirmation(confirmation))
      if (functionName === 'get_appointment_confirmation_availability') return Response.json(await getAppointmentConfirmationAvailability(confirmation, args))
      return Response.json(await rescheduleAppointmentFromConfirmation(confirmation, args))
    }

    if (confirmation || declaredConfirmationMode) throw new RetellToolError('TOOL_NOT_ALLOWED_FOR_CALL_MODE', 'Esta llamada sólo puede confirmar, cancelar o reprogramar la cita existente.', 403)

    // Inbound calls use the normal booking tools. Outbound calls must declare
    // the already-approved Fase 10 mode; an unknown/missing outbound mode is
    // never allowed to reach booking or deposit logic.
    if (call.direction === 'outbound' && callMetadata?.call_mode !== 'deposit_follow_up') {
      throw new RetellToolError('TOOL_NOT_ALLOWED_FOR_CALL_MODE', 'La llamada outbound no tiene un modo autorizado.', 403)
    }

    if (functionName === 'get_context') return Response.json(await getRetellContext(operationInput))
    if (functionName === 'prepare_booking') return Response.json(await prepareRetellBooking(operationInput))
    if (functionName === 'get_availability') return Response.json(await getRetellAvailability(operationInput))
    if (functionName === 'book_appointment') {
      const result = await bookRetellAppointment(operationInput)
      const normalBookingCodes = new Set(['TOO_SOON', 'OUTSIDE_SCHEDULE', 'SLOT_UNAVAILABLE'])
      return Response.json(result, { status: normalBookingCodes.has(result.code ?? '') ? 200 : result.ok ? 200 : 409 })
    }
    console.warn('[Retell] Unknown tool:', JSON.stringify(functionName))
    return Response.json({ ok: false, code: 'UNKNOWN_TOOL', error: 'La operación solicitada no existe.' }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
