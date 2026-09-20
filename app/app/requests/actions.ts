'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { isUuid } from '@/lib/deposits/phase9'
import { startDepositSchedulingCall } from '@/lib/retell/deposit-scheduling'
import { getAppointmentRequest } from '@/lib/requests/appointment-requests'

export type RetrySchedulingState = 'idle' | 'started' | 'active' | 'error'

export async function retrySchedulingCall(
  requestId: string,
  _previousState: RetrySchedulingState,
  _formData: FormData,
): Promise<RetrySchedulingState> {
  void _previousState
  void _formData
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id || !isUuid(requestId)) return 'error'

  let request
  try {
    request = await getAppointmentRequest(user.doctor_id, requestId)
  } catch {
    return 'error'
  }
  if (!request || request.status !== 'WAITING_SCHEDULING') return 'error'

  try {
    const result = await startDepositSchedulingCall(requestId)
    if (!result.ok) return 'error'
    return result.idempotent ? 'active' : 'started'
  } catch {
    return 'error'
  } finally {
    revalidatePath('/app/requests')
    revalidatePath(`/app/requests/${requestId}`)
  }
}
