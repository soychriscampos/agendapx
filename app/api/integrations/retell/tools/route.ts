import { timingSafeEqual } from 'node:crypto'
import { Retell } from 'retell-sdk'

import {
  RetellToolError,
  bookRetellAppointment,
  getRetellAvailability,
  getRetellContext,
  prepareRetellBooking,
} from '@/lib/retell/tools'

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
    return Response.json({ ok: false, code: error.code, error: error.message, retryable: error.retryable }, { status: error.status })
  }
  return Response.json({ ok: false, code: 'INTERNAL_ERROR', error: 'No se pudo completar la operación.' }, { status: 500 })
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
    return Response.json({ ok: false, code: 'INVALID_REQUEST', error: 'El cuerpo JSON no es válido.' }, { status: 400 })
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
