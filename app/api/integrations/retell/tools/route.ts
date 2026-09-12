import { timingSafeEqual } from 'node:crypto'

import {
  RetellToolError,
  bookRetellAppointment,
  getRetellAvailability,
  getRetellContext,
  prepareRetellBooking,
} from '@/lib/retell/tools'

function hasValidSecret(request: Request) {
  const expected = process.env.RETELL_TOOLS_SECRET
  const authorization = request.headers.get('authorization')
  if (!expected || !authorization?.startsWith('Bearer ')) return false
  const received = authorization.slice('Bearer '.length)
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

function errorResponse(error: unknown) {
  if (error instanceof RetellToolError) {
    return Response.json({ ok: false, code: error.code, error: error.message, retryable: error.retryable }, { status: error.status })
  }
  return Response.json({ ok: false, code: 'INTERNAL_ERROR', error: 'No se pudo completar la operación.' }, { status: 500 })
}

export async function POST(request: Request) {
  if (!hasValidSecret(request)) return Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'No autorizado.' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, code: 'INVALID_REQUEST', error: 'El cuerpo JSON no es válido.' }, { status: 400 })
  }

  try {
    const tool = body.tool
    if (tool === 'get_context') return Response.json(await getRetellContext(body))
    if (tool === 'prepare_booking') return Response.json(await prepareRetellBooking(body))
    if (tool === 'get_availability') return Response.json(await getRetellAvailability(body))
    if (tool === 'book_appointment') {
      const result = await bookRetellAppointment(body)
      return Response.json(result, { status: result.code === 'SLOT_UNAVAILABLE' ? 409 : 200 })
    }
    return Response.json({ ok: false, code: 'UNKNOWN_TOOL', error: 'La operación solicitada no existe.' }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
