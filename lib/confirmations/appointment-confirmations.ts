import { createHmac, timingSafeEqual } from 'node:crypto'

import { getDateTimeInTimezone } from '@/lib/agenda/timezone'
import { renderAppointmentConfirmationEmail } from '@/lib/email/appointment-confirmation-template'
import { isUuid } from '@/lib/deposits/phase9'
import { createAdminClient } from '@/lib/supabase/admin'

const ACTION_PURPOSE = 'appointment-confirmation-reminder:'

export type AppointmentConfirmationEmailPayload = {
  ok: true
  appointment: { id: string; confirmation_status: string; local_date: string; local_time: string; appointment_type_name: string | null }
  doctor: { id: string; name: string; email: string; timezone: string }
  patient: { id: string | null; name: string }
  contact: { id: string; name: string; phone_e164: string }
  action: { id: string }
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La respuesta de confirmación no es válida.')
  return value as Record<string, unknown>
}

function actionSecret() {
  const secret = process.env.DEPOSIT_ACTION_SECRET
  if (!secret || secret.length < 32) throw new Error('DEPOSIT_ACTION_SECRET debe tener al menos 32 caracteres.')
  return secret
}

export function signAppointmentConfirmationReminderAction(actionId: string) {
  if (!isUuid(actionId)) throw new Error('La acción de recordatorio no es válida.')
  return createHmac('sha256', actionSecret()).update(`${ACTION_PURPOSE}${actionId}`).digest('hex')
}

export function verifyAppointmentConfirmationReminderSignature(actionId: string, signature: string) {
  if (!isUuid(actionId) || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = Buffer.from(signAppointmentConfirmationReminderAction(actionId), 'hex')
  const received = Buffer.from(signature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function getAppointmentConfirmationReminderUrl(actionId: string) {
  const appUrl = process.env.APP_URL
  if (!appUrl) throw new Error('Falta configurar APP_URL.')
  const url = new URL('/confirmation/reminder', appUrl)
  url.searchParams.set('action', actionId)
  url.searchParams.set('signature', signAppointmentConfirmationReminderAction(actionId))
  return url.toString()
}

export function buildAppointmentConfirmationWhatsAppMessage(input: { patientName: string; doctorName: string; localDate: string; localTime: string }) {
  return `Hola, ${input.patientName}. Intentamos comunicarnos para confirmar tu cita con el Dr. ${input.doctorName} el día ${input.localDate} a las ${input.localTime}. Por favor indícanos si podrás asistir.`
}

export async function getAppointmentConfirmationEmailPayload(appointmentId: string): Promise<AppointmentConfirmationEmailPayload | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_appointment_confirmation_email_payload', { p_appointment_id: appointmentId })
  if (error) throw new Error('No se pudo cargar el recordatorio de confirmación.')
  const result = record(data)
  if (result.ok !== true) return null
  const raw = result as Record<string, unknown>
  const appointment = raw.appointment && typeof raw.appointment === 'object' ? raw.appointment as Record<string, unknown> : null
  const doctor = raw.doctor && typeof raw.doctor === 'object' ? raw.doctor as Record<string, unknown> : null
  const patient = raw.patient && typeof raw.patient === 'object' ? raw.patient as Record<string, unknown> : null
  const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact as Record<string, unknown> : null
  const action = raw.action && typeof raw.action === 'object' ? raw.action as Record<string, unknown> : null
  if (!appointment || !doctor || !patient || !contact || !action || typeof appointment.start_at !== 'string' || typeof doctor.timezone !== 'string' || typeof appointment.id !== 'string' || typeof action.id !== 'string') throw new Error('El payload de recordatorio está incompleto.')
  const local = getDateTimeInTimezone(doctor.timezone, new Date(appointment.start_at))
  const localDate = new Intl.DateTimeFormat('es-MX', { timeZone: doctor.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(appointment.start_at))
  return {
    ok: true,
    appointment: { id: appointment.id, confirmation_status: typeof appointment.confirmation_status === 'string' ? appointment.confirmation_status : 'REMINDER_PENDING', local_date: localDate, local_time: local.time, appointment_type_name: raw.appointment_type && typeof raw.appointment_type === 'object' && typeof (raw.appointment_type as Record<string, unknown>).name === 'string' ? (raw.appointment_type as Record<string, unknown>).name as string : null },
    doctor: doctor as unknown as AppointmentConfirmationEmailPayload['doctor'],
    patient: patient as unknown as AppointmentConfirmationEmailPayload['patient'],
    contact: contact as unknown as AppointmentConfirmationEmailPayload['contact'],
    action: action as unknown as AppointmentConfirmationEmailPayload['action'],
  }
}

export async function getAppointmentConfirmationReminderActionState(actionId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_appointment_confirmation_reminder_action_state', { p_action_id: actionId })
  if (error) throw new Error('No se pudo consultar el recordatorio.')
  return record(data)
}

export async function startAppointmentConfirmationReminder(actionId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('start_appointment_confirmation_reminder', { p_action_id: actionId })
  if (error) throw new Error('No se pudo iniciar el recordatorio.')
  return record(data)
}

export async function deliverAppointmentConfirmationEmail(appointmentId: string) {
  const admin = createAdminClient()
  try {
    const { data: preparedData, error: prepareError } = await admin.rpc('prepare_appointment_confirmation_reminder', { p_appointment_id: appointmentId })
    if (prepareError) throw prepareError
    const prepared = record(preparedData)
    if (prepared.ok !== true) return { sent: false, code: String(prepared.code ?? 'PREPARE_REJECTED') }
    const preparedDelivery = prepared.delivery && typeof prepared.delivery === 'object' ? prepared.delivery as Record<string, unknown> : null
    if (preparedDelivery?.status === 'SENT') return { sent: true, idempotent: true }
    if (preparedDelivery?.status === 'SENDING') return { sent: false, idempotent: true, code: 'EMAIL_ALREADY_SENDING' }

    const payload = await getAppointmentConfirmationEmailPayload(appointmentId)
    if (!payload || payload.appointment.id !== appointmentId || payload.action.id !== prepared.action_id || payload.doctor.email !== prepared.recipient_email) throw new Error('El payload de recordatorio no coincide con la preparación.')
    const { data: sendingData, error: sendingError } = await admin.rpc('mark_appointment_confirmation_email_sending', { p_appointment_id: appointmentId })
    if (sendingError) throw sendingError
    const sending = record(sendingData)
    if (sending.delivery_status === 'SENT') return { sent: true, idempotent: true }
    if (sending.delivery_status === 'SENDING' && sending.code !== 'EMAIL_SEND_CLAIMED') return { sent: false, idempotent: true, code: 'EMAIL_ALREADY_SENDING' }
    if (sending.ok !== true) throw new Error('No se pudo registrar el envío del recordatorio.')

    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM_EMAIL
    if (!apiKey || !from) throw new Error('Falta configurar RESEND_API_KEY o RESEND_FROM_EMAIL.')
    try {
      const email = renderAppointmentConfirmationEmail(payload)
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `appointment-confirmation/${appointmentId}` }, body: JSON.stringify({ from, to: [payload.doctor.email], subject: email.subject, html: email.html }), cache: 'no-store' })
      const body: unknown = await response.json().catch(() => null)
      const responseRecord = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
      if (!response.ok || typeof responseRecord.id !== 'string') throw new Error(typeof responseRecord.message === 'string' ? responseRecord.message : `Resend respondió HTTP ${response.status}.`)
      const { data: sentData, error: sentError } = await admin.rpc('mark_appointment_confirmation_email_sent', { p_appointment_id: appointmentId, p_resend_email_id: responseRecord.id })
      if (sentError || record(sentData).ok !== true) throw new Error('Resend aceptó el email, pero no se pudo guardar el resultado.')
      return { sent: true, idempotent: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al enviar el recordatorio.'
      try {
        await admin.rpc('mark_appointment_confirmation_email_failed', { p_appointment_id: appointmentId, p_error: message })
      } catch {
        // The original delivery failure remains the actionable error.
      }
      console.error('[Confirmation email] Failed.', { appointmentId, message })
      return { sent: false }
    }
  } catch (error) {
    console.error('[Confirmation email] Could not start.', { appointmentId, error })
    return { sent: false }
  }
}

export function localAppointmentDateTime(timezone: string, startAt: string) {
  return getDateTimeInTimezone(timezone, new Date(startAt))
}

/** Builds the existing WhatsApp handoff URL without starting or mutating a reminder. */
export async function getAppointmentConfirmationReminderWhatsAppUrl(appointmentId: string) {
  const admin = createAdminClient()
  const { data: appointment, error: appointmentError } = await admin
    .from('appointments')
    .select('id, doctor_id, patient_id, patient_name, appointment_request_id, start_at, status, confirmation_status')
    .eq('id', appointmentId)
    .maybeSingle()
  if (appointmentError || !appointment || appointment.status !== 'CONFIRMED' || appointment.confirmation_status !== 'REMINDER_STARTED') return null

  const [doctorQuery, patientQuery] = await Promise.all([
    admin.from('doctors').select('display_name, timezone').eq('id', appointment.doctor_id).maybeSingle(),
    appointment.patient_id
      ? admin.from('patients').select('full_name').eq('id', appointment.patient_id).eq('doctor_id', appointment.doctor_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (doctorQuery.error || !doctorQuery.data || patientQuery.error) return null

  let phone: string | null = null
  if (appointment.appointment_request_id) {
    const { data: request, error: requestError } = await admin
      .from('appointment_requests')
      .select('origin_contact_id, origin_contact_phone_id')
      .eq('id', appointment.appointment_request_id)
      .eq('doctor_id', appointment.doctor_id)
      .maybeSingle()
    if (requestError) return null
    if (request) {
      const { data: phoneRow, error: phoneError } = await admin
        .from('contact_phones')
        .select('phone_e164')
        .eq('id', request.origin_contact_phone_id)
        .eq('contact_id', request.origin_contact_id)
        .eq('doctor_id', appointment.doctor_id)
        .maybeSingle()
      if (phoneError) return null
      phone = phoneRow?.phone_e164 ?? null
    }
  }

  if (!phone && appointment.patient_id) {
    const { data: relation, error: relationError } = await admin
      .from('patient_contacts')
      .select('contact_id')
      .eq('patient_id', appointment.patient_id)
      .eq('doctor_id', appointment.doctor_id)
      .eq('relationship', 'SELF')
      .limit(1)
      .maybeSingle()
    if (relationError) return null
    if (relation) {
      const { data: phoneRow, error: phoneError } = await admin
        .from('contact_phones')
        .select('phone_e164')
        .eq('contact_id', relation.contact_id)
        .eq('doctor_id', appointment.doctor_id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (phoneError) return null
      phone = phoneRow?.phone_e164 ?? null
    }
  }

  const normalizedPhone = phone?.replace(/^\+/, '').replace(/\D/g, '')
  if (!normalizedPhone) return null
  const local = getDateTimeInTimezone(doctorQuery.data.timezone, new Date(appointment.start_at))
  const localDate = new Intl.DateTimeFormat('es-MX', { timeZone: doctorQuery.data.timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(appointment.start_at))
  const message = buildAppointmentConfirmationWhatsAppMessage({
    patientName: patientQuery.data?.full_name ?? appointment.patient_name,
    doctorName: doctorQuery.data.display_name,
    localDate,
    localTime: local.time,
  })
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`
}
