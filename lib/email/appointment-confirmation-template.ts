import type { AppointmentConfirmationEmailPayload } from '@/lib/confirmations/appointment-confirmations'
import { getAppointmentConfirmationReminderUrl } from '@/lib/confirmations/appointment-confirmations'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function row(label: string, value: string) {
  return `<tr><td style="padding:11px 0;color:#737373;font-size:14px">${escapeHtml(label)}</td><td style="padding:11px 0;color:#171717;font-size:14px;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`
}

export function renderAppointmentConfirmationEmail(payload: AppointmentConfirmationEmailPayload) {
  const reminderUrl = escapeHtml(getAppointmentConfirmationReminderUrl(payload.action.id))
  const appointmentType = payload.appointment.appointment_type_name ?? 'No especificado'
  return {
    subject: `No fue posible confirmar la cita de ${payload.patient.name}`,
    html: `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:44px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e5e5;border-radius:16px"><tr><td style="padding:42px"><p style="margin:0;color:#737373;font-size:14px;font-weight:bold;letter-spacing:.04em">HelloPx</p><h1 style="margin:20px 0 0;font-size:27px;line-height:35px">No fue posible confirmar esta cita por llamada</h1><p style="margin:14px 0 0;color:#525252;font-size:16px;line-height:25px">Envía un recordatorio por WhatsApp para pedir la confirmación de asistencia.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;border-collapse:collapse;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5">${row('Paciente', payload.patient.name)}${row('Doctor', payload.doctor.name)}${row('Fecha', payload.appointment.local_date)}${row('Hora', payload.appointment.local_time)}${row('Contacto', `${payload.contact.name} · ${payload.contact.phone_e164}`)}${row('Tipo de cita', appointmentType)}</table><table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:28px"><tr><td bgcolor="#25D366" style="border-radius:8px"><a href="${reminderUrl}" style="display:inline-block;padding:13px 20px;color:#fff;text-decoration:none;font-size:14px;font-weight:bold">Enviar recordatorio por WhatsApp</a></td></tr></table><p style="margin:28px 0 0;color:#a3a3a3;font-size:12px;line-height:18px">Este correo fue enviado automáticamente por HelloPx.</p></td></tr></table></td></tr></table></body></html>`,
  }
}
