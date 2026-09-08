import type { AgendaUser } from '@/lib/auth'
import { findConfirmedAppointmentConflicts, type AppointmentConflict } from '@/lib/appointments/appointments'
import { addLocalDays, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { createClient } from '@/lib/supabase/server'

export type DoctorUnavailability = {
  id: string
  startAt: string
  endAt: string
  internalNote: string | null
}

export type CreateDoctorUnavailabilityInput = {
  mode: 'HOURS' | 'DAYS'
  dateFrom: string
  dateTo?: string
  start?: string
  end?: string
  internalNote?: string
}

export type UpdateDoctorUnavailabilityInput = CreateDoctorUnavailabilityInput & { id: string }
export type UnavailabilityMutationResult = { ok: true } | { ok: false; error: 'appointments_in_period'; appointments: AppointmentConflict[] }

async function resolveDoctorId(actor: AgendaUser, doctorId: string) {
  const targetDoctorId = actor.role === 'DOCTOR' ? actor.doctor_id : doctorId
  if (!targetDoctorId) throw new Error('El usuario no tiene un doctor asociado.')
  if (actor.role === 'DOCTOR' && doctorId !== targetDoctorId) throw new Error('No puedes modificar otro doctor.')
  return targetDoctorId
}

async function getDoctorTimezone(actor: AgendaUser, doctorId: string) {
  const targetDoctorId = await resolveDoctorId(actor, doctorId)
  const supabase = await createClient()
  const { data: doctor, error } = await supabase.from('doctors').select('id, timezone').eq('id', targetDoctorId).maybeSingle()
  if (error || !doctor) throw new Error('El doctor seleccionado no existe.')
  return { doctorId: doctor.id, timezone: doctor.timezone }
}

export async function listDoctorUnavailability(doctorId: string): Promise<DoctorUnavailability[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doctor_unavailability')
    .select('id, start_at, end_at, internal_note')
    .eq('doctor_id', doctorId)
    .order('start_at')
  if (error) throw new Error('No se pudo cargar la indisponibilidad del doctor.')
  return (data ?? []).map((item) => ({ id: item.id, startAt: item.start_at, endAt: item.end_at, internalNote: item.internal_note }))
}

export async function createDoctorUnavailability(actor: AgendaUser, doctorId: string, input: CreateDoctorUnavailabilityInput) {
  const { doctorId: targetDoctorId, timezone } = await getDoctorTimezone(actor, doctorId)
  const interval = buildInterval(input, timezone)
  const conflicts = await findConfirmedAppointmentConflicts(targetDoctorId, interval.startAt, interval.endAt)
  if (conflicts.length) return { ok: false as const, error: 'appointments_in_period' as const, appointments: conflicts }

  const supabase = await createClient()
  const { error } = await supabase.from('doctor_unavailability').insert({
    doctor_id: targetDoctorId,
    start_at: interval.startAt.toISOString(),
    end_at: interval.endAt.toISOString(),
    internal_note: input.internalNote?.trim() || null,
  })
  if (error) throw new Error('No se pudo guardar la indisponibilidad.')
  return { ok: true as const }
}

function buildInterval(input: CreateDoctorUnavailabilityInput, timezone: string) {
  if (input.mode !== 'HOURS' && input.mode !== 'DAYS') throw new Error('El tipo de indisponibilidad no es válido.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom)) throw new Error('La fecha no es válida.')

  let startAt: Date
  let endAt: Date
  if (input.mode === 'HOURS') {
    if (!input.start || !input.end || !/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) {
      throw new Error('Indica un horario válido que no cruce medianoche.')
    }
    startAt = localDateTimeToUtc(input.dateFrom, input.start, timezone)
    endAt = localDateTimeToUtc(input.dateFrom, input.end, timezone)
  } else {
    const dateTo = input.dateTo || input.dateFrom
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateTo < input.dateFrom) throw new Error('El rango de fechas no es válido.')
    startAt = localDateTimeToUtc(input.dateFrom, '00:00', timezone)
    endAt = localDateTimeToUtc(addLocalDays(dateTo, 1), '00:00', timezone)
  }

  return { startAt, endAt }
}

export async function updateDoctorUnavailability(actor: AgendaUser, doctorId: string, input: UpdateDoctorUnavailabilityInput) {
  if (!input.id) throw new Error('La indisponibilidad no es válida.')
  const { doctorId: targetDoctorId, timezone } = await getDoctorTimezone(actor, doctorId)
  const interval = buildInterval(input, timezone)
  const conflicts = await findConfirmedAppointmentConflicts(targetDoctorId, interval.startAt, interval.endAt)
  if (conflicts.length) return { ok: false as const, error: 'appointments_in_period' as const, appointments: conflicts }
  const supabase = await createClient()
  const { error } = await supabase.from('doctor_unavailability').update({
    start_at: interval.startAt.toISOString(),
    end_at: interval.endAt.toISOString(),
    internal_note: input.internalNote?.trim() || null,
  }).eq('id', input.id).eq('doctor_id', targetDoctorId)
  if (error) throw new Error('No se pudo actualizar la indisponibilidad.')
  return { ok: true as const }
}

export async function deleteDoctorUnavailability(actor: AgendaUser, doctorId: string, id: string) {
  const targetDoctorId = await resolveDoctorId(actor, doctorId)
  const supabase = await createClient()
  const { error } = await supabase.from('doctor_unavailability').delete().eq('id', id).eq('doctor_id', targetDoctorId)
  if (error) throw new Error('No se pudo eliminar la indisponibilidad.')
}
