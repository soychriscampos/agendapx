'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { confirmDepositAction, getDepositEmailPayload, isUuid, verifyDepositActionSignature } from '@/lib/deposits/phase9'
import { getAppointmentRequest } from '@/lib/requests/appointment-requests'

export async function confirmDepositPublicAction(formData: FormData) {
  const actionId = String(formData.get('action') ?? '')
  const signature = String(formData.get('signature') ?? '')
  if (!verifyDepositActionSignature(actionId, signature)) redirect('/deposit/confirm?error=invalid')

  const destination = new URLSearchParams({ action: actionId, signature })
  await confirmDepositAction(actionId)
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
  await confirmDepositAction(payload.action.id)
  revalidatePath('/app/requests')
  revalidatePath(`/app/requests/${requestId}`)
  redirect(`/app/requests/${requestId}`)
}
