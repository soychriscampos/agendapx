import { Retell } from 'retell-sdk'
import type { PhoneCallResponse } from 'retell-sdk/resources/call'

import { createAdminClient } from '@/lib/supabase/admin'

type SchedulingOutcome = 'COMPLETED' | 'NO_ANSWER' | 'INTERRUPTED'

const noAnswerReasons = new Set<NonNullable<PhoneCallResponse['disconnection_reason']>>([
  'dial_no_answer',
  'dial_busy',
  'user_declined',
  'voicemail_reached',
])

const interruptedReasons = new Set<NonNullable<PhoneCallResponse['disconnection_reason']>>([
  'dial_failed',
  'invalid_destination',
  'telephony_provider_permission_denied',
  'telephony_provider_unavailable',
  'sip_routing_error',
  'marked_as_spam',
  'concurrency_limit_reached',
  'no_concurrency_fallback',
  'no_valid_payment',
  'scam_detected',
  'error_llm_websocket_open',
  'error_llm_websocket_lost_connection',
  'error_llm_websocket_runtime',
  'error_llm_websocket_corrupt_payload',
  'error_no_audio_received',
  'error_asr',
  'error_retell',
  'error_unknown',
  'error_user_not_joined',
  'registered_call_timeout',
])

function classifyOutcome(call: Pick<PhoneCallResponse, 'call_status' | 'disconnection_reason'>): SchedulingOutcome {
  if (call.call_status === 'error') return 'INTERRUPTED'
  if (call.disconnection_reason && noAnswerReasons.has(call.disconnection_reason)) return 'NO_ANSWER'
  if (call.disconnection_reason && interruptedReasons.has(call.disconnection_reason)) return 'INTERRUPTED'
  if (call.call_status === 'not_connected') return 'NO_ANSWER'
  return 'COMPLETED'
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const apiKey = process.env.RETELL_API_KEY
  const signature = request.headers.get('x-retell-signature')

  if (!apiKey || !signature) {
    return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    if (!(await Retell.verify(rawBody, apiKey, signature))) {
      return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
    }
  } catch {
    return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return Response.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 })
  }

  const body = objectRecord(parsed)
  if (!body) return Response.json({ ok: false, code: 'INVALID_PAYLOAD' }, { status: 400 })
  if (body.event !== 'call_ended') return Response.json({ ok: true, code: 'EVENT_IGNORED' })

  const call = objectRecord(body.call)
  if (!call || typeof call.call_id !== 'string' || !call.call_id.trim() ||
    typeof call.agent_id !== 'string' || !call.agent_id.trim() ||
    call.call_type !== 'phone_call' || call.direction !== 'outbound') {
    console.info('[retell-webhook] ignored', {
      call_id: typeof call?.call_id === 'string' ? call.call_id : null,
      event: body.event,
      code: 'INVALID_OR_NON_OUTBOUND_CALL',
    })
    return Response.json({ ok: true, code: 'CALL_IGNORED' })
  }

  const callId = call.call_id.trim()
  const agentId = call.agent_id.trim()
  const outcome = classifyOutcome(call as unknown as Pick<PhoneCallResponse, 'call_status' | 'disconnection_reason'>)

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('finish_scheduling_call', {
      p_retell_call_id: callId,
      p_agent_id: agentId,
      p_outcome: outcome,
    })

    if (error) {
      console.error('[retell-webhook] failed', { call_id: callId, event: body.event, code: 'LIFECYCLE_RPC_ERROR' })
      return Response.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 })
    }

    const result = objectRecord(data)
    const code = typeof result?.code === 'string' ? result.code : 'LIFECYCLE_RPC_INVALID_RESPONSE'
    const successfulCodes = new Set([
      'CALL_ALREADY_FINISHED',
      'SCHEDULING_CALL_NOT_FOUND',
      'SCHEDULING_CALL_FINISHED',
    ])

    console.info('[retell-webhook] processed', { call_id: callId, event: body.event, code })
    return Response.json({ ok: successfulCodes.has(code), code })
  } catch {
    console.error('[retell-webhook] failed', { call_id: callId, event: body.event, code: 'LIFECYCLE_INTERNAL_ERROR' })
    return Response.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
