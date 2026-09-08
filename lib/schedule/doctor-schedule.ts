import type { AgendaUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type ScheduleRange = {
  start: string
  end: string
}

export type DoctorScheduleDay = {
  weekday: number
  ranges: ScheduleRange[]
}

export type DoctorSchedule = DoctorScheduleDay[]

export type RecurringUnavailability = DoctorScheduleDay & {
  internalNote: string | null
}

type ScheduleWindowRow = {
  id: string
  weekday: number
  start_local: string
  end_local: string
}

export async function getDoctorSchedule(
  doctorId: string,
  actorRole?: AgendaUser['role'],
): Promise<DoctorSchedule> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doctor_schedule_windows')
    .select('id, weekday, start_local, end_local')
    .eq('doctor_id', doctorId)
    .order('weekday')
    .order('start_local')

  if (error) {
    console.error('[Doctor schedule] getDoctorSchedule failed', {
      doctorId,
      actorRole,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error('No se pudo cargar el horario del doctor.')
  }

  const days = new Map<number, DoctorScheduleDay>()
  for (const row of (data ?? []) as ScheduleWindowRow[]) {
    const day = days.get(row.weekday) ?? { weekday: row.weekday, ranges: [] }
    day.ranges.push({ start: row.start_local.slice(0, 5), end: row.end_local.slice(0, 5) })
    days.set(row.weekday, day)
  }

  return Array.from(days.values())
}

export async function replaceDoctorSchedule(
  actor: AgendaUser,
  doctorId: string,
  schedule: DoctorSchedule,
) {
  const targetDoctorId = actor.role === 'DOCTOR' ? actor.doctor_id : doctorId
  if (!targetDoctorId) throw new Error('El usuario no tiene un doctor asociado.')
  if (actor.role === 'DOCTOR' && doctorId !== targetDoctorId) {
    throw new Error('No puedes modificar el horario de otro doctor.')
  }

  const supabase = await createClient()
  if (actor.role === 'MASTER') {
    const { data: doctor, error } = await supabase
      .from('doctors')
      .select('id')
      .eq('id', targetDoctorId)
      .maybeSingle()

    if (error || !doctor) throw new Error('El doctor seleccionado no existe.')
  }

  const { error: deleteError } = await supabase
    .from('doctor_schedule_windows')
    .delete()
    .eq('doctor_id', targetDoctorId)

  if (deleteError) throw new Error('No se pudo reemplazar el horario actual.')

  const rows = schedule.flatMap((day) =>
    day.ranges.map((range) => ({
      doctor_id: targetDoctorId,
      weekday: day.weekday,
      start_local: range.start,
      end_local: range.end,
    })),
  )

  if (!rows.length) return

  const { error: insertError } = await supabase
    .from('doctor_schedule_windows')
    .insert(rows)

  if (insertError) throw new Error('No se pudo guardar el nuevo horario.')
}

export async function getDoctorRecurringUnavailability(doctorId: string): Promise<RecurringUnavailability[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doctor_recurring_unavailability')
    .select('id, weekday, start_local, end_local, internal_note')
    .eq('doctor_id', doctorId)
    .order('weekday')
    .order('start_local')

  if (error) throw new Error('No se pudo cargar la indisponibilidad recurrente.')

  return (data ?? []).map((row) => ({
    weekday: row.weekday,
    ranges: [{ start: row.start_local.slice(0, 5), end: row.end_local.slice(0, 5) }],
    internalNote: row.internal_note,
  }))
}

export async function replaceDoctorRecurringUnavailability(
  actor: AgendaUser,
  doctorId: string,
  unavailability: RecurringUnavailability[],
) {
  const targetDoctorId = actor.role === 'DOCTOR' ? actor.doctor_id : doctorId
  if (!targetDoctorId) throw new Error('El usuario no tiene un doctor asociado.')
  if (actor.role === 'DOCTOR' && doctorId !== targetDoctorId) {
    throw new Error('No puedes modificar la indisponibilidad de otro doctor.')
  }

  const supabase = await createClient()
  if (actor.role === 'MASTER') {
    const { data: doctor, error } = await supabase
      .from('doctors')
      .select('id')
      .eq('id', targetDoctorId)
      .maybeSingle()

    if (error || !doctor) throw new Error('El doctor seleccionado no existe.')
  }

  const { error: deleteError } = await supabase
    .from('doctor_recurring_unavailability')
    .delete()
    .eq('doctor_id', targetDoctorId)

  if (deleteError) throw new Error('No se pudo reemplazar la indisponibilidad actual.')

  const rows = unavailability.flatMap((day) =>
    day.ranges.map((range) => ({
      doctor_id: targetDoctorId,
      weekday: day.weekday,
      start_local: range.start,
      end_local: range.end,
      internal_note: day.internalNote,
    })),
  )

  if (!rows.length) return

  const { error: insertError } = await supabase
    .from('doctor_recurring_unavailability')
    .insert(rows)

  if (insertError) throw new Error('No se pudo guardar la indisponibilidad recurrente.')
}
