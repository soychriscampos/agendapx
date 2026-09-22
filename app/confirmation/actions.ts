'use server'

import { redirect } from 'next/navigation'

import { getDateTimeInTimezone } from '@/lib/agenda/timezone'

import {
  buildAppointmentConfirmationWhatsAppMessage,
  startAppointmentConfirmationReminder,
  verifyAppointmentConfirmationReminderSignature,
} from '@/lib/confirmations/appointment-confirmations'

export async function startConfirmationReminderPublicAction(formData: FormData) {
  const actionId = String(formData.get('action') ?? '')
  const signature = String(formData.get('signature') ?? '')
  if (!verifyAppointmentConfirmationReminderSignature(actionId, signature)) redirect('/confirmation/reminder?error=invalid')
  let result: Record<string, unknown>
  try {
    result = await startAppointmentConfirmationReminder(actionId)
  } catch {
    redirect('/confirmation/reminder?error=unavailable')
  }
  if (result.confirmation_status === 'CONFIRMED') redirect('/confirmation/reminder?error=confirmed')
  if (result.confirmation_status === 'CANCELLED' || result.appointment_status === 'CANCELLED') redirect('/confirmation/reminder?error=cancelled')
  if (result.ok !== true || typeof result.contact_phone_e164 !== 'string' || typeof result.start_at !== 'string' || typeof result.doctor_timezone !== 'string') redirect('/confirmation/reminder?error=unavailable')
  const local = getDateTimeInTimezone(result.doctor_timezone, new Date(result.start_at))
  const localDate = new Intl.DateTimeFormat('es-MX', { timeZone: result.doctor_timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(result.start_at))
  const message = buildAppointmentConfirmationWhatsAppMessage({
    patientName: String(result.patient_name ?? 'Paciente'),
    doctorName: String(result.doctor_name ?? 'Consultorio'),
    localDate,
    localTime: local.time,
  })
  const phone = result.contact_phone_e164.replace(/^\+/, '').replace(/\D/g, '')
  if (!phone) redirect('/confirmation/reminder?error=unavailable')
  redirect(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`)
}
