import type { AgendaUser } from '@/lib/auth'
import { getDateTimeInTimezone, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { createClient } from '@/lib/supabase/server'

export type Appointment = { id: string; doctorId: string; patientName: string; startAt: string; endAt: string; status: 'CONFIRMED' | 'CANCELLED'; createdSource: 'DOCTOR' | 'MASTER' | 'AGENT'; createdByUserId: string | null }
export type AppointmentInput = { patientName: string; date: string; start: string; end: string }
export type AppointmentConflict = { id: string; patientName: string; startAt: string; endAt: string }

async function resolveDoctor(actor: AgendaUser, doctorId: string) {
  const targetDoctorId = actor.role === 'DOCTOR' ? actor.doctor_id : doctorId
  if (!targetDoctorId) throw new Error('El usuario no tiene un doctor asociado.')
  if (actor.role === 'DOCTOR' && targetDoctorId !== doctorId) throw new Error('No puedes modificar citas de otro doctor.')
  const supabase = await createClient()
  const { data: doctor, error } = await supabase.from('doctors').select('id, timezone').eq('id', targetDoctorId).maybeSingle()
  if (error || !doctor) throw new Error('El doctor seleccionado no existe.')
  return { doctorId: doctor.id, timezone: doctor.timezone }
}

function interval(input: AppointmentInput, timezone: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date)
  const time = (value?: string) => !!value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!input.patientName.trim() || !date || !time(input.start) || !time(input.end) || input.start >= input.end) throw new Error('Indica nombre, fecha y un horario válido.')
  return { startAt: localDateTimeToUtc(input.date, input.start!, timezone), endAt: localDateTimeToUtc(input.date, input.end!, timezone) }
}

function weekday(date: string) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day }
function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) { return startA < endB && endA > startB }

export async function findConfirmedAppointmentConflicts(doctorId: string, startAt: Date, endAt: Date, excludeAppointmentId?: string): Promise<AppointmentConflict[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('appointments').select('id, patient_name, start_at, end_at').eq('doctor_id', doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudieron revisar las citas existentes.')
  return (data ?? []).filter((item) => item.id !== excludeAppointmentId && overlaps(startAt, endAt, new Date(item.start_at), new Date(item.end_at))).map((item) => ({ id: item.id, patientName: item.patient_name, startAt: item.start_at, endAt: item.end_at }))
}

export async function checkAppointmentConflict(doctorId: string, startAt: Date, endAt: Date, timezone: string, excludeAppointmentId?: string) {
  const conflicts = await findConfirmedAppointmentConflicts(doctorId, startAt, endAt, excludeAppointmentId)
  if (conflicts.length) throw new Error('Ese horario ya tiene una cita confirmada.')

  const supabase = await createClient()
  const { data: blocks, error: blockError } = await supabase.from('doctor_unavailability').select('start_at, end_at').eq('doctor_id', doctorId)
  if (blockError) throw new Error('No se pudo revisar la disponibilidad del doctor.')
  if ((blocks ?? []).some((item) => overlaps(startAt, endAt, new Date(item.start_at), new Date(item.end_at)))) throw new Error('Ese horario está marcado como no disponible.')

  const localStart = getDateTimeInTimezone(timezone, startAt)
  const localEnd = getDateTimeInTimezone(timezone, endAt)
  if (localStart.date !== localEnd.date) throw new Error('La cita debe terminar el mismo día.')
  const { data: recurring, error: recurringError } = await supabase.from('doctor_recurring_unavailability').select('weekday, start_local, end_local').eq('doctor_id', doctorId).eq('weekday', weekday(localStart.date))
  if (recurringError) throw new Error('No se pudo revisar el horario fijo no disponible.')
  if ((recurring ?? []).some((item) => localStart.time < item.end_local.slice(0, 5) && localEnd.time > item.start_local.slice(0, 5))) throw new Error('Ese horario está marcado como no disponible.')

  const { data: schedule, error: scheduleError } = await supabase.from('doctor_schedule_windows').select('start_local, end_local').eq('doctor_id', doctorId).eq('weekday', weekday(localStart.date))
  if (scheduleError) throw new Error('No se pudo revisar el horario habitual.')
  if (!(schedule ?? []).some((item) => localStart.time >= item.start_local.slice(0, 5) && localEnd.time <= item.end_local.slice(0, 5))) throw new Error('La cita debe estar dentro del horario habitual.')
}

export async function listAppointments(doctorId: string): Promise<Appointment[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('appointments').select('id, doctor_id, patient_name, start_at, end_at, status, created_source, created_by_user_id').eq('doctor_id', doctorId).order('start_at')
  if (error) throw new Error('No se pudieron cargar las citas.')
  return (data ?? []).map((item) => ({ id: item.id, doctorId: item.doctor_id, patientName: item.patient_name, startAt: item.start_at, endAt: item.end_at, status: item.status, createdSource: item.created_source, createdByUserId: item.created_by_user_id }))
}

export async function createAppointment(actor: AgendaUser, doctorId: string, input: AppointmentInput) {
  const target = await resolveDoctor(actor, doctorId)
  const values = interval(input, target.timezone)
  await checkAppointmentConflict(target.doctorId, values.startAt, values.endAt, target.timezone)
  const supabase = await createClient()
  const { error } = await supabase.from('appointments').insert({ doctor_id: target.doctorId, patient_name: input.patientName.trim(), start_at: values.startAt.toISOString(), end_at: values.endAt.toISOString(), status: 'CONFIRMED', created_source: actor.role === 'MASTER' ? 'MASTER' : 'DOCTOR', created_by_user_id: actor.id })
  if (error) throw new Error('No se pudo crear la cita.')
}

export async function updateAppointment(actor: AgendaUser, doctorId: string, id: string, input: AppointmentInput) {
  const target = await resolveDoctor(actor, doctorId)
  const values = interval(input, target.timezone)
  await checkAppointmentConflict(target.doctorId, values.startAt, values.endAt, target.timezone, id)
  const supabase = await createClient()
  const { error } = await supabase.from('appointments').update({ patient_name: input.patientName.trim(), start_at: values.startAt.toISOString(), end_at: values.endAt.toISOString() }).eq('id', id).eq('doctor_id', target.doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudo reprogramar la cita.')
}

export async function cancelAppointment(actor: AgendaUser, doctorId: string, id: string) {
  const target = await resolveDoctor(actor, doctorId)
  const supabase = await createClient()
  const { error } = await supabase.from('appointments').update({ status: 'CANCELLED' }).eq('id', id).eq('doctor_id', target.doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudo cancelar la cita.')
}
