import { Retell } from 'retell-sdk'

import { getDateTimeInTimezone } from '@/lib/agenda/timezone'
import { RetellToolError, getRetellInboundContext } from '@/lib/retell/tools'

function errorResponse(error: unknown) {
  if (error instanceof RetellToolError) {
    return Response.json({ ok: false, code: error.code, error: error.message, retryable: error.retryable }, { status: error.status })
  }
  return Response.json({ ok: false, code: 'INTERNAL_ERROR', error: 'No se pudo cargar el contexto inicial.' }, { status: 500 })
}

function greetingForTimezone(timezone: string) {
  const localTime = getDateTimeInTimezone(timezone, new Date()).time
  const hour = Number(localTime.slice(0, 2))
  if (hour >= 5 && hour < 12) return 'Buenos días'
  if (hour >= 12 && hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const apiKey = process.env.RETELL_API_KEY
  const signature = request.headers.get('x-retell-signature')

  if (!apiKey || !signature) return Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'No autorizado.' }, { status: 401 })
  try {
    if (!(await Retell.verify(rawBody, apiKey, signature))) return Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'No autorizado.' }, { status: 401 })
  } catch {
    return Response.json({ ok: false, code: 'UNAUTHORIZED', error: 'No autorizado.' }, { status: 401 })
  }

  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RetellToolError('INVALID_REQUEST', 'El cuerpo JSON no es válido.')
    const body = parsed as Record<string, unknown>
    if (body.event !== 'call_inbound' || !body.call_inbound || typeof body.call_inbound !== 'object' || Array.isArray(body.call_inbound)) {
      throw new RetellToolError('INVALID_REQUEST', 'El payload inbound no es válido.')
    }
    const callInbound = body.call_inbound as Record<string, unknown>
    if (typeof callInbound.agent_id !== 'string' || !callInbound.agent_id.trim()) throw new RetellToolError('INVALID_REQUEST', 'El payload inbound no contiene agent_id.')
    const technicalPhoneNumber = typeof callInbound.to_number === 'string' ? callInbound.to_number.trim() || undefined : undefined
    const context = await getRetellInboundContext(callInbound.agent_id.trim(), technicalPhoneNumber)
    const dynamicVariables = { ...context, greeting: greetingForTimezone(context.timezone) }

    return Response.json({
      call_inbound: {
        dynamic_variables: Object.fromEntries(Object.entries(dynamicVariables).map(([key, value]) => [key, String(value)])),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
