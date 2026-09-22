import { getDateTimeInTimezone, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { getAvailableSlots } from '@/lib/availability/get-available-slots'
import { RetellToolError, resolveRetellDoctor } from '@/lib/retell/tools'
import { createAdminClient } from '@/lib/supabase/admin'

export type ConfirmationCallContext = { appointmentId: string; attemptId: string; agentId: string }

type RecordValue = Record<string, unknown>
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RetellToolError('INVALID_REQUEST', 'Los argumentos no son válidos.')
  return value as RecordValue
}
function string(body: RecordValue, key: string) {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new RetellToolError('INVALID_REQUEST', `El campo ${key} es obligatorio.`)
  return value.trim()
}
function rpc(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RetellToolError('CONFIRMATION_RPC_INVALID', 'La respuesta de confirmación no es válida.', 502)
  return value as RecordValue
}

async function appointmentForCall(context: ConfirmationCallContext) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('appointments')
    .select('id, doctor_id, patient_name, start_at, end_at, status, confirmation_status, appointment_type_id')
    .eq('id', context.appointmentId)
    .maybeSingle()
  if (error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar la cita.', 503, true)
  if (!data) throw new RetellToolError('APPOINTMENT_NOT_FOUND', 'La cita ya no está disponible.', 404)
  return data
}

export async function getAppointmentConfirmationContext(context: ConfirmationCallContext) {
  const appointment = await appointmentForCall(context)
  const doctor = await resolveRetellDoctor(context.agentId)
  if (appointment.doctor_id !== doctor.id) throw new RetellToolError('APPOINTMENT_NOT_FOUND', 'La cita no corresponde al agente.', 404)
  const durationMinutes = Math.round((new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000)
  const admin = createAdminClient()
  const { data: type } = appointment.appointment_type_id
    ? await admin.from('appointment_types').select('name').eq('id', appointment.appointment_type_id).eq('doctor_id', doctor.id).maybeSingle()
    : { data: null }
  return { ok: true, appointment_id: appointment.id, patient_name: appointment.patient_name, appointment_type_name: type?.name ?? null, start_at: appointment.start_at, end_at: appointment.end_at, duration_minutes: durationMinutes, timezone: doctor.timezone, confirmation_status: appointment.confirmation_status }
}

export async function confirmAppointmentAttendance(context: ConfirmationCallContext) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('confirm_appointment_attendance', { p_appointment_id: context.appointmentId, p_attempt_id: context.attemptId, p_agent_id: context.agentId })
  if (error) throw new RetellToolError('CONFIRMATION_FAILED', 'No se pudo registrar la confirmación.', 500)
  return rpc(data)
}

export async function cancelAppointmentFromConfirmation(context: ConfirmationCallContext) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('cancel_appointment_from_confirmation', { p_appointment_id: context.appointmentId, p_attempt_id: context.attemptId, p_agent_id: context.agentId })
  if (error) throw new RetellToolError('CANCELLATION_FAILED', 'No se pudo cancelar la cita.', 500)
  return rpc(data)
}

export async function getAppointmentConfirmationAvailability(context: ConfirmationCallContext, input: unknown) {
  const body = record(input)
  const dateFrom = string(body, 'date_from')
  const dateTo = string(body, 'date_to')
  if (!DATE.test(dateFrom) || !DATE.test(dateTo)) throw new RetellToolError('INVALID_REQUEST', 'Las fechas no son válidas.')
  const appointment = await appointmentForCall(context)
  const doctor = await resolveRetellDoctor(context.agentId)
  if (appointment.doctor_id !== doctor.id || appointment.status !== 'CONFIRMED') throw new RetellToolError('APPOINTMENT_NOT_AVAILABLE', 'La cita ya no está activa.', 409)
  const durationMinutes = Math.round((new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000)
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new RetellToolError('APPOINTMENT_DURATION_INVALID', 'La duración de la cita no es válida.', 409)
  const slots = await getAvailableSlots({ doctorId: doctor.id, dateFrom, dateTo, durationMinutes }, createAdminClient())
  return {
    ok: true,
    timezone: slots.timezone,
    slots: slots.slots.map((slot) => {
      const local = getDateTimeInTimezone(slots.timezone, new Date(slot.start))
      return { local_date: local.date, local_time: local.time, start_at: slot.start, end_at: slot.end }
    }),
  }
}

export async function rescheduleAppointmentFromConfirmation(context: ConfirmationCallContext, input: unknown) {
  const body = record(input)
  const localDate = string(body, 'local_date')
  const localTime = string(body, 'local_time')
  if (!DATE.test(localDate) || !TIME.test(localTime)) throw new RetellToolError('INVALID_REQUEST', 'La fecha u hora no es válida.')
  const appointment = await appointmentForCall(context)
  const doctor = await resolveRetellDoctor(context.agentId)
  if (appointment.doctor_id !== doctor.id) throw new RetellToolError('APPOINTMENT_NOT_FOUND', 'La cita no corresponde al agente.', 404)
  const startAt = localDateTimeToUtc(localDate, localTime, doctor.timezone)
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('reschedule_appointment_from_confirmation', { p_appointment_id: context.appointmentId, p_attempt_id: context.attemptId, p_agent_id: context.agentId, p_start_at: startAt.toISOString() })
  if (error) throw new RetellToolError('RESCHEDULE_FAILED', 'No se pudo reprogramar la cita.', 500)
  return rpc(data)
}
