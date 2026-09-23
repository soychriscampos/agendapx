import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { startAppointmentConfirmationCall } from '@/lib/retell/appointment-confirmation'
import { createAdminClient } from '@/lib/supabase/admin'

const BATCH_LIMIT = 50
const IDEMPOTENT_DISPATCH_CODES = new Set([
  'CONFIRMATION_CALL_ALREADY_ACTIVE',
  'CALL_ALREADY_FINISHED',
  'CALL_ALREADY_DISPATCHED',
])
const IDEMPOTENT_EXPIRATION_CODES = new Set([
  'APPOINTMENT_ALREADY_RESOLVED',
  'CONFIRMATION_NOT_EXPIRABLE',
  'CONFIRMATION_WINDOW_NOT_EXPIRED',
])

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasSchedulerSecret(request: Request) {
  const expected = process.env.SCHEDULER_SECRET
  const authorization = request.headers.get('authorization')
  if (!expected || !authorization?.startsWith('Bearer ')) return false

  const received = authorization.slice('Bearer '.length)
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

function codeOf(value: unknown) {
  return isRecord(value) && typeof value.code === 'string' ? value.code : 'UNKNOWN'
}

function attemptIdOf(value: unknown) {
  return isRecord(value) && typeof value.attempt_id === 'string' ? value.attempt_id : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown scheduler error.'
}

function logError(runId: string, error: unknown, context: RecordValue = {}) {
  console.error('scheduler_error', {
    run_id: runId,
    ...context,
    error: errorMessage(error),
  })
}

export async function POST(request: Request) {
  if (!hasSchedulerSecret(request)) return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })

  const runId = crypto.randomUUID()
  const startedAt = Date.now()
  console.info('scheduler_started', { run_id: runId })

  const dispatch = {
    found: 0,
    attempted: 0,
    dispatched: 0,
    skipped: 0,
    errors: 0,
    results: [] as Array<RecordValue>,
  }
  const expiration = {
    found: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    results: [] as Array<RecordValue>,
  }
  let fatalError = false

  try {
    const admin = createAdminClient()

    let dueRows: unknown[] = []
    try {
      const { data, error } = await admin.rpc('get_due_appointment_confirmations', { p_limit: BATCH_LIMIT })
      if (error) throw error
      dueRows = Array.isArray(data) ? data : []
      dispatch.found = dueRows.length
      console.info('due_confirmations_found', { run_id: runId, found: dispatch.found })
    } catch (error) {
      fatalError = true
      logError(runId, error, { code: 'DUE_CONFIRMATIONS_QUERY_FAILED' })
    }

    for (const row of dueRows) {
      const appointmentId = isRecord(row) && typeof row.appointment_id === 'string' ? row.appointment_id : null
      dispatch.attempted += 1
      if (!appointmentId) {
        dispatch.errors += 1
        const result = { code: 'INVALID_DUE_CONFIRMATION_ROW' }
        dispatch.results.push(result)
        logError(runId, new Error(result.code), result)
        continue
      }

      const itemStartedAt = Date.now()
      try {
        const result = await startAppointmentConfirmationCall(appointmentId)
        const code = codeOf(result)
        const item = {
          appointment_id: appointmentId,
          attempt_id: attemptIdOf(result),
          code,
          idempotent: isRecord(result) && result.idempotent === true,
          duration_ms: Date.now() - itemStartedAt,
        }
        dispatch.results.push(item)
        console.info('confirmation_dispatch_result', { run_id: runId, ...item })
        if (isRecord(result) && result.ok === true && !item.idempotent) dispatch.dispatched += 1
        else if (isRecord(result) && result.ok === true && (item.idempotent || IDEMPOTENT_DISPATCH_CODES.has(code))) dispatch.skipped += 1
        else dispatch.errors += 1
      } catch (error) {
        dispatch.errors += 1
        const item = { appointment_id: appointmentId, code: 'DISPATCH_RUNTIME_ERROR', duration_ms: Date.now() - itemStartedAt }
        dispatch.results.push(item)
        logError(runId, error, item)
      }
    }

    let expiredRows: unknown[] = []
    try {
      const { data, error } = await admin.rpc('get_expired_appointment_confirmations', { p_limit: BATCH_LIMIT })
      if (error) throw error
      expiredRows = Array.isArray(data) ? data : []
      expiration.found = expiredRows.length
      console.info('expired_confirmations_found', { run_id: runId, found: expiration.found })
    } catch (error) {
      fatalError = true
      logError(runId, error, { code: 'EXPIRED_CONFIRMATIONS_QUERY_FAILED' })
    }

    for (const row of expiredRows) {
      const appointmentId = isRecord(row) && typeof row.appointment_id === 'string' ? row.appointment_id : null
      if (!appointmentId) {
        expiration.errors += 1
        const result = { code: 'INVALID_EXPIRED_CONFIRMATION_ROW' }
        expiration.results.push(result)
        logError(runId, new Error(result.code), result)
        continue
      }

      const itemStartedAt = Date.now()
      try {
        const { data, error } = await admin.rpc('process_expired_appointment_confirmation', { p_appointment_id: appointmentId })
        if (error) throw error
        const code = codeOf(data)
        const item = {
          appointment_id: appointmentId,
          code,
          duration_ms: Date.now() - itemStartedAt,
        }
        expiration.results.push(item)
        console.info('expiration_result', { run_id: runId, ...item })
        if (isRecord(data) && data.ok === true && IDEMPOTENT_EXPIRATION_CODES.has(code)) expiration.skipped += 1
        else if (isRecord(data) && data.ok === true) expiration.processed += 1
        else expiration.errors += 1
      } catch (error) {
        expiration.errors += 1
        const item = { appointment_id: appointmentId, code: 'EXPIRATION_RUNTIME_ERROR', duration_ms: Date.now() - itemStartedAt }
        expiration.results.push(item)
        logError(runId, error, item)
      }
    }
  } catch (error) {
    fatalError = true
    logError(runId, error, { code: 'SCHEDULER_RUNTIME_ERROR' })
  }

  const response = {
    ok: !fatalError && dispatch.errors === 0 && expiration.errors === 0,
    run_id: runId,
    duration_ms: Date.now() - startedAt,
    dispatch,
    expiration,
  }
  console.info('scheduler_finished', {
    run_id: runId,
    duration_ms: response.duration_ms,
    ok: response.ok,
    dispatch_errors: dispatch.errors,
    expiration_errors: expiration.errors,
  })

  return Response.json(response, { status: response.ok ? 200 : 500 })
}
