'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { confirmDepositAction, getDepositEmailPayload, isUuid, verifyDepositActionSignature } from '@/lib/deposits/phase9'
import { startDepositSchedulingCall } from '@/lib/retell/deposit-scheduling'
import { getAppointmentRequest } from '@/lib/requests/appointment-requests'

async function confirmAndStartScheduling(actionId: string) {
  const confirmation = await confirmDepositAction(actionId)
  if (confirmation.ok === true && confirmation.request_status === 'DEPOSIT_CONFIRMED'
    && typeof confirmation.request_id === 'string') {
    try {
      const result = await startDepositSchedulingCall(confirmation.request_id)
      if (!result.ok) {
        console.error('[Deposit confirmation] Scheduling call was not dispatched.', {
          requestId: confirmation.request_id,
          code: result.code,
        })
      }
    } catch (error) {
      // Deposit confirmation succeeded independently of outbound calling.
      console.error('[Deposit confirmation] Scheduling call could not be started.', {
        requestId: confirmation.request_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
  return confirmation
}

export async function confirmDepositPublicAction(formData: FormData) {
  const actionId = String(formData.get('action') ?? '')
  const signature = String(formData.get('signature') ?? '')
  if (!verifyDepositActionSignature(actionId, signature)) redirect('/deposit/confirm?error=invalid')

  const destination = new URLSearchParams({ action: actionId, signature })
  await confirmAndStartScheduling(actionId)
  redirect(`/deposit/confirm?${destination.toString()}`)
}

export async function confirmDepositFromHelloPx(requestId: string) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id || !isUuid(requestId)) redirect('/login')

  const request = await getAppointmentRequest(user.doctor_id, requestId)
  if (!request) redirect('/app/requests')
  if (request.status !== 'WAITING_DEPOSIT') redirect(`/app/requests/${requestId}`)

  const payload = await getDepositEmailPayload(requestId)
  if (!payload || payload.request.id !== requestId || payload.request.status !== 'WAITING_DEPOSIT') redirect(`/app/requests/${requestId}`)
  await confirmAndStartScheduling(payload.action.id)
  revalidatePath('/app/requests')
  revalidatePath(`/app/requests/${requestId}`)
  redirect(`/app/requests/${requestId}`)
}
