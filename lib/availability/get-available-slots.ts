import { addLocalDays, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { createClient } from '@/lib/supabase/server'

export type AvailableSlotsInput = {
  doctorId: string
  timezone?: string
  dateFrom: string
  dateTo: string
  durationMinutes: number
  slotIntervalMinutes?: number
}

export type AvailableSlot = { start: string; end: string }
export type AvailableSlotsResult = { timezone: string; slots: AvailableSlot[] }

type LocalRange = { start: string; end: string }
type OccupiedRange = { start: Date; end: Date }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^\d{2}:\d{2}$/

function assertDate(value: string, label: string) {
  if (!DATE_PATTERN.test(value) || addLocalDays(value, 0) !== value) throw new Error(`${label} no es válida.`)
}

function minutes(value: string) {
  if (!TIME_PATTERN.test(value)) throw new Error('El horario configurado no es válido.')
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB
}

function weekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function datesBetween(dateFrom: string, dateTo: string) {
  const dates: string[] = []
  for (let date = dateFrom; date <= dateTo; date = addLocalDays(date, 1)) dates.push(date)
  return dates
}

function occupiedForDate(date: string, timezone: string, ranges: LocalRange[], punctual: OccupiedRange[]) {
  const projected = ranges.map((range) => ({ start: localDateTimeToUtc(date, range.start, timezone), end: localDateTimeToUtc(date, range.end, timezone) }))
  return [...projected, ...punctual]
}

export function calculateAvailableSlots({ dateFrom, dateTo, timezone, durationMinutes, slotIntervalMinutes, schedule, recurring, punctual, now = new Date() }: {
  dateFrom: string
  dateTo: string
  timezone: string
  durationMinutes: number
  slotIntervalMinutes: number
  schedule: Map<number, LocalRange[]>
  recurring: Map<number, LocalRange[]>
  punctual: OccupiedRange[]
  now?: Date
}): AvailableSlot[] {
  const slots: AvailableSlot[] = []
  for (const date of datesBetween(dateFrom, dateTo)) {
    const day = weekday(date)
    for (const window of schedule.get(day) ?? []) {
      const windowStart = minutes(window.start); const windowEnd = minutes(window.end)
      const occupied = occupiedForDate(date, timezone, recurring.get(day) ?? [], punctual)
      for (let startMinute = windowStart; startMinute + durationMinutes <= windowEnd; startMinute += slotIntervalMinutes) {
        const start = localDateTimeToUtc(date, `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`, timezone)
        const endMinute = startMinute + durationMinutes
        const end = localDateTimeToUtc(date, `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`, timezone)
        if (start <= now || occupied.some((range) => overlaps(start, end, range.start, range.end))) continue
        slots.push({ start: start.toISOString(), end: end.toISOString() })
      }
    }
  }
  return slots
}

export async function getAvailableSlots(input: AvailableSlotsInput): Promise<AvailableSlotsResult> {
  assertDate(input.dateFrom, 'dateFrom'); assertDate(input.dateTo, 'dateTo')
  if (input.dateTo < input.dateFrom) throw new Error('El rango de fechas no es válido.')
  if (datesBetween(input.dateFrom, input.dateTo).length > 31) throw new Error('El rango máximo es de 31 días.')
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 480) throw new Error('La duración debe estar entre 1 y 480 minutos.')
  const slotIntervalMinutes = input.slotIntervalMinutes ?? 30
  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes <= 0 || slotIntervalMinutes > 480) throw new Error('El intervalo de slots no es válido.')

  const supabase = await createClient()
  const { data: doctor, error: doctorError } = await supabase.from('doctors').select('timezone').eq('id', input.doctorId).maybeSingle()
  if (doctorError || !doctor) throw new Error('El doctor seleccionado no existe.')
  const timezone = doctor.timezone
  const rangeStart = localDateTimeToUtc(input.dateFrom, '00:00', timezone)
  const rangeEnd = localDateTimeToUtc(addLocalDays(input.dateTo, 1), '00:00', timezone)

  const [scheduleQuery, recurringQuery, punctualQuery, appointmentsQuery] = await Promise.all([
    supabase.from('doctor_schedule_windows').select('weekday, start_local, end_local').eq('doctor_id', input.doctorId),
    supabase.from('doctor_recurring_unavailability').select('weekday, start_local, end_local').eq('doctor_id', input.doctorId),
    supabase.from('doctor_unavailability').select('start_at, end_at').eq('doctor_id', input.doctorId).lt('start_at', rangeEnd.toISOString()).gt('end_at', rangeStart.toISOString()),
    supabase.from('appointments').select('start_at, end_at').eq('doctor_id', input.doctorId).eq('status', 'CONFIRMED').lt('start_at', rangeEnd.toISOString()).gt('end_at', rangeStart.toISOString()),
  ])
  if (scheduleQuery.error) throw new Error('No se pudo cargar el horario habitual.')
  if (recurringQuery.error) throw new Error('No se pudo cargar la indisponibilidad recurrente.')
  if (punctualQuery.error) throw new Error('No se pudo cargar la indisponibilidad puntual.')
  if (appointmentsQuery.error) throw new Error('No se pudieron cargar las citas.')

  const toRanges = (rows: Array<{ weekday: number; start_local: string; end_local: string }>) => {
    const result = new Map<number, LocalRange[]>()
    for (const row of rows) { const ranges = result.get(row.weekday) ?? []; ranges.push({ start: row.start_local.slice(0, 5), end: row.end_local.slice(0, 5) }); result.set(row.weekday, ranges) }
    return result
  }
  const punctual = [...(punctualQuery.data ?? []), ...(appointmentsQuery.data ?? [])].map((row) => ({ start: new Date(row.start_at), end: new Date(row.end_at) }))
  return { timezone, slots: calculateAvailableSlots({ dateFrom: input.dateFrom, dateTo: input.dateTo, timezone, durationMinutes: input.durationMinutes, slotIntervalMinutes, schedule: toRanges(scheduleQuery.data ?? []), recurring: toRanges(recurringQuery.data ?? []), punctual }) }
}
