import { createAdminClient } from '@/lib/supabase/admin'

export type SchedulingCallAttemptStatus = 'CREATING' | 'DISPATCHED' | 'COMPLETED' | 'NO_ANSWER' | 'INTERRUPTED' | 'FAILED'

export type SchedulingCallAttempt = {
  id: string
  attemptNumber: number
  status: SchedulingCallAttemptStatus
  createdAt: string
  dispatchedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

/** Reads the single most recent attempt using the request-local canonical sequence. */
export async function getLatestSchedulingCallAttempt(doctorId: string, requestId: string): Promise<SchedulingCallAttempt | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scheduling_call_attempts')
    .select('id, attempt_number, status, created_at, dispatched_at, finished_at, updated_at')
    .eq('doctor_id', doctorId)
    .eq('request_id', requestId)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error('No se pudo cargar el último intento de llamada de agenda.')
  if (!data) return null

  return {
    id: data.id,
    attemptNumber: data.attempt_number,
    status: data.status as SchedulingCallAttemptStatus,
    createdAt: data.created_at,
    dispatchedAt: data.dispatched_at,
    finishedAt: data.finished_at,
    updatedAt: data.updated_at,
  }
}

/** Read only the active-state signal needed by the server-rendered request detail. */
export async function hasActiveSchedulingCall(doctorId: string, requestId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scheduling_call_attempts')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('request_id', requestId)
    .in('status', ['CREATING', 'DISPATCHED'])
    .maybeSingle()

  if (error) throw new Error('No se pudo cargar el estado de la llamada de agenda.')
  return Boolean(data)
}
