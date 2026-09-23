'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AgendaContext } from '@/lib/agenda/context'
import { getDateInTimezone, getDateTimeInTimezone } from '@/lib/agenda/timezone'
import type { DoctorUnavailability } from '@/lib/unavailability/doctor-unavailability'
import { UnavailabilityDialog } from '@/components/agenda/unavailability-dialog'
import { UnavailabilityPanel } from '@/components/agenda/unavailability-panel'
import { AppointmentCreateDialog } from '@/components/agenda/appointment-create-dialog'
import { AppointmentDialog } from '@/components/agenda/appointment-dialog'
import { AgendaLiveRefresh } from '@/components/agenda/agenda-live-refresh'
import type { Appointment } from '@/lib/appointments/appointments'

type AgendaViewMode = 'day' | 'week' | 'month'

type AgendaContentProps = {
  context: AgendaContext
  unavailability: DoctorUnavailability[]
  appointments: Appointment[]
}

type RealAgendaEvent = {
  id: string
  kind: 'unavailability'
  date: string
  start: string
  end: string
  note: string | null
  item: DoctorUnavailability
}
type RealAppointmentEvent = { id: string; kind: 'appointment'; date: string; start: string; end: string; patient: string; item: Appointment }
type AgendaEvent = RealAppointmentEvent | RealAgendaEvent

const HOURS = Array.from({ length: 11 }, (_, index) => index + 8)
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function cloneDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, amount: number) {
  const nextDate = cloneDate(date)
  nextDate.setDate(nextDate.getDate() + amount)
  return nextDate
}

function startOfWeek(date: Date) {
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDays(date, mondayOffset)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function dateKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
}

function parseTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('es-MX', options).format(date)
}

function formatRange(date: Date, view: AgendaViewMode) {
  if (view === 'day') {
    return formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  if (view === 'month') {
    return formatDate(date, { month: 'long', year: 'numeric' })
  }

  const weekStart = startOfWeek(date)
  const weekEnd = addDays(weekStart, 6)
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
  const startLabel = formatDate(weekStart, { day: 'numeric', month: sameMonth ? undefined : 'short' })
  const endLabel = formatDate(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })

  return `${startLabel} – ${endLabel}`
}

function realEventsForDate(date: Date, timezone: string, items: DoctorUnavailability[]): RealAgendaEvent[] {
  const key = dateKey(date)
  return items.flatMap((item) => {
    const start = getDateTimeInTimezone(timezone, new Date(item.startAt))
    const end = getDateTimeInTimezone(timezone, new Date(item.endAt))
    if (key < start.date || key >= end.date && end.time === '00:00') return []
    if (key < start.date || key > end.date) return []
    return [{ id: item.id, kind: 'unavailability', date: key, start: key === start.date ? start.time : '00:00', end: key === end.date ? end.time : '24:00', note: item.internalNote, item }]
  })
}

function realAppointmentsForDate(date: Date, timezone: string, appointments: Appointment[]): RealAppointmentEvent[] {
  const key = dateKey(date)
  return appointments.filter((item) => item.status === 'CONFIRMED').flatMap((item) => {
    const start = getDateTimeInTimezone(timezone, new Date(item.startAt))
    const end = getDateTimeInTimezone(timezone, new Date(item.endAt))
    return start.date === key ? [{ id: item.id, kind: 'appointment', date: key, start: start.time, end: end.time, patient: item.patientName, item }] : []
  })
}

function eventsForDate(date: Date, timezone: string, items: DoctorUnavailability[], appointments: Appointment[]) {
  return [...realAppointmentsForDate(date, timezone, appointments), ...realEventsForDate(date, timezone, items)]
}

function eventTime(event: AgendaEvent) {
  if (event.kind === 'unavailability' && event.start === '00:00' && event.end === '24:00') return 'Todo el día'
  return `${event.start}–${event.end}`
}

function needsAppointmentAttention(appointment: Appointment) {
  return appointment.confirmationStatus === 'REMINDER_PENDING' || appointment.confirmationStatus === 'MANUAL_REQUIRED'
}

function AgendaInlineFeedback({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onDismiss, 3_500)
    return () => window.clearTimeout(timeout)
  }, [message, onDismiss])

  return <span role="status" aria-live="polite" className="agenda-inline-feedback ml-1 font-medium text-zinc-800">· {message}</span>
}

function MiniEvent({ event, highlighted, onSelect }: { event: AgendaEvent; highlighted: boolean; onSelect: (event: AgendaEvent) => void }) {
  if (event.kind === 'unavailability') {
    return (
      <button type="button" onClick={() => onSelect(event)} className="w-full rounded-md border border-dashed border-zinc-400 bg-zinc-100 px-2.5 py-2 text-left text-xs text-zinc-700">
        <p className="font-medium text-zinc-800">{event.note?.trim() || 'No disponible'}</p>
        <p className="mt-0.5">{eventTime(event)}</p>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-label={needsAppointmentAttention(event.item) ? `${event.patient}, requiere revisión` : undefined}
      className={`w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-[13px] text-emerald-950 shadow-sm shadow-emerald-950/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${highlighted ? 'agenda-event-update' : ''}`}
    >
      <p className="font-semibold">{event.patient}</p>
      <p className="mt-1 text-xs font-medium tabular-nums">{eventTime(event)}</p>
      {needsAppointmentAttention(event.item) ? <p className="mt-1 flex items-center gap-1 font-medium text-amber-800"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />Revisar</p> : null}
    </button>
  )
}

function DayAgenda({ date, timezone, unavailability, appointments, highlightedAppointmentIds, onSelect }: { date: Date; timezone: string; unavailability: DoctorUnavailability[]; appointments: Appointment[]; highlightedAppointmentIds: ReadonlySet<string>; onSelect: (event: AgendaEvent) => void }) {
  const events = eventsForDate(date, timezone, unavailability, appointments)
  const allDayEvents = events.filter((event) => event.kind === 'unavailability' && event.start === '00:00' && event.end === '24:00')

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {allDayEvents.length ? <div className="border-b border-zinc-100 bg-zinc-50 p-2">{allDayEvents.map((event) => <MiniEvent key={`${event.kind}-${event.id}`} event={event} highlighted={event.kind === 'appointment' && highlightedAppointmentIds.has(event.id)} onSelect={onSelect} />)}</div> : null}
      {HOURS.map((hour) => {
        const hourEvents = events.filter((event) => !(event.kind === 'unavailability' && event.start === '00:00' && event.end === '24:00') && Math.floor(parseTime(event.start) / 60) === hour)

        return (
          <div key={hour} className="grid min-h-20 grid-cols-[4.5rem_minmax(0,1fr)] border-b border-zinc-100 last:border-b-0">
            <div className="border-r border-zinc-100 px-3 py-3 text-xs text-zinc-400">{String(hour).padStart(2, '0')}:00</div>
            <div className="space-y-2 p-2">
              {hourEvents.length ? hourEvents.map((event) => <MiniEvent key={event.id} event={event} highlighted={event.kind === 'appointment' && highlightedAppointmentIds.has(event.id)} onSelect={onSelect} />) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekAgenda({ date, today, timezone, unavailability, appointments, highlightedAppointmentIds, onSelect }: { date: Date; today: Date; timezone: string; unavailability: DoctorUnavailability[]; appointments: Appointment[]; highlightedAppointmentIds: ReadonlySet<string>; onSelect: (event: AgendaEvent) => void }) {
  const weekStart = startOfWeek(date)

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <div className="grid min-w-[760px] grid-cols-7">
        {WEEKDAYS.map((weekday, index) => {
          const day = addDays(weekStart, index)
          const isToday = dateKey(day) === dateKey(today)

          return (
            <div key={weekday} className="min-h-[28rem] border-r border-zinc-100 last:border-r-0">
              <div className={`border-b border-zinc-200 px-3 py-3 ${isToday ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-50'}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{weekday}</p>
                <p className="mt-1 text-lg font-semibold">{day.getDate()}</p>
              </div>
              <div className="space-y-2 p-2">
                {eventsForDate(day, timezone, unavailability, appointments).map((event) => <MiniEvent key={`${event.kind}-${event.id}`} event={event} highlighted={event.kind === 'appointment' && highlightedAppointmentIds.has(event.id)} onSelect={onSelect} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function monthDays(date: Date) {
  const monthStart = startOfMonth(date)
  const gridStart = startOfWeek(monthStart)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function MonthAgenda({ date, timezone, unavailability, appointments, highlightedAppointmentIds, onSelectDay, onSelect }: { date: Date; timezone: string; unavailability: DoctorUnavailability[]; appointments: Appointment[]; highlightedAppointmentIds: ReadonlySet<string>; onSelectDay: (date: Date) => void; onSelect: (event: AgendaEvent) => void }) {
  const days = monthDays(date)
  const month = date.getMonth()

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <div className="min-w-[660px]">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
          {WEEKDAYS.map((weekday) => <div key={weekday} className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">{weekday}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const dayEvents = eventsForDate(day, timezone, unavailability, appointments)
            const isOutsideMonth = day.getMonth() !== month

            return (
              <div
                key={dateKey(day)}
                className={`min-h-28 border-b border-r border-zinc-100 p-2 text-left align-top last:border-r-0 hover:bg-zinc-50 ${isOutsideMonth ? 'bg-zinc-50/60 text-zinc-400' : 'text-zinc-900'}`}
              >
                <button type="button" onClick={() => onSelectDay(day)} className="rounded px-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">{day.getDate()}</button>
                <span className="mt-2 block space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <button type="button" key={`${event.kind}-${event.id}`} onClick={() => onSelect(event)} aria-label={event.kind === 'appointment' && needsAppointmentAttention(event.item) ? `${event.patient}, requiere revisión` : undefined} className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 ${event.kind === 'unavailability' ? 'border border-dashed border-zinc-300 text-zinc-500' : `border border-emerald-200 bg-emerald-50 text-emerald-950 ${highlightedAppointmentIds.has(event.id) ? 'agenda-event-update' : ''}`}`}>
                      {event.kind === 'unavailability' ? event.note?.trim() || 'No disponible' : <span className="inline-flex items-center gap-1">{needsAppointmentAttention(event.item) ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> : null}{event.patient}</span>}
                    </button>
                  ))}
                  {dayEvents.length > 2 ? <span className="block px-1.5 text-[11px] text-zinc-400">+{dayEvents.length - 2} más</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function AgendaContent({ context, unavailability, appointments }: AgendaContentProps) {
  const today = getDateInTimezone(context.timezone)
  const [view, setView] = useState<AgendaViewMode>('week')
  const [selectedDate, setSelectedDate] = useState(() => getDateInTimezone(context.timezone))
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null)
  const [selectedUnavailability, setSelectedUnavailability] = useState<DoctorUnavailability | null>(null)
  const [newAppointmentOpen, setNewAppointmentOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ id: number; message: string } | null>(null)
  const [highlightedAppointmentIds, setHighlightedAppointmentIds] = useState<ReadonlySet<string>>(() => new Set())
  const previousAppointmentsRef = useRef<Appointment[] | null>(null)

  const rangeLabel = useMemo(() => formatRange(selectedDate, view), [selectedDate, view])
  const selectedAppointment = selectedAppointmentId ? appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null : null
  const selectedAppointmentMissing = selectedAppointmentId !== null && selectedAppointment === null

  useEffect(() => {
    const previousAppointments = previousAppointmentsRef.current
    previousAppointmentsRef.current = appointments
    if (!previousAppointments) return

    const previousById = new Map(previousAppointments.map((appointment) => [appointment.id, appointment]))
    const changedIds = appointments.flatMap((appointment) => {
      const previous = previousById.get(appointment.id)
      const isNew = !previous
      const statusChanged = previous && (previous.status !== appointment.status || previous.confirmationStatus !== appointment.confirmationStatus)
      return isNew || statusChanged ? [appointment.id] : []
    })

    if (!changedIds.length) return
    const frame = window.requestAnimationFrame(() => setHighlightedAppointmentIds(new Set(changedIds)))
    return () => window.cancelAnimationFrame(frame)
  }, [appointments])

  useEffect(() => {
    if (!highlightedAppointmentIds.size) return
    const timeout = window.setTimeout(() => setHighlightedAppointmentIds(new Set()), 500)
    return () => window.clearTimeout(timeout)
  }, [highlightedAppointmentIds])

  const dismissFeedback = useCallback(() => setFeedback(null), [])
  const dismissExternalUpdate = useCallback(() => setSelectedAppointmentId(null), [])
  const announceFeedback = useCallback((message: string) => setFeedback({ id: Date.now(), message }), [])

  function moveDate(direction: number) {
    if (view === 'day') setSelectedDate((date) => addDays(date, direction))
    if (view === 'week') setSelectedDate((date) => addDays(date, direction * 7))
    if (view === 'month') setSelectedDate((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1))
  }

  function selectMonthDay(date: Date) {
    setSelectedDate(date)
    setView('day')
  }

  function selectEvent(event: AgendaEvent) {
    if (event.kind === 'appointment') setSelectedAppointmentId(event.item.id)
    if (event.kind === 'unavailability') setSelectedUnavailability(event.item)
  }

  return (
    <section className="mx-auto max-w-7xl" data-doctor-id={context.doctorId}>
      <AgendaLiveRefresh />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight text-zinc-950">Agenda</h1><p className="mt-2 text-sm text-zinc-600">Organiza tu semana y revisa las citas de tus pacientes.{feedback ? <AgendaInlineFeedback key={feedback.id} message={feedback.message} onDismiss={dismissFeedback} /> : null}{!feedback && selectedAppointmentMissing ? <AgendaInlineFeedback key={`external-${selectedAppointmentId}`} message="Esta cita cambió y la Agenda se actualizó." onDismiss={dismissExternalUpdate} /> : null}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setNewAppointmentOpen(true)} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">Nueva cita</button>
          <UnavailabilityPanel doctorId={context.doctorId} timezone={context.timezone} />
        </div>
      </header>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSelectedDate(today)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">Hoy</button>
          <div className="flex items-center rounded-lg border border-zinc-300 bg-white">
            <button type="button" onClick={() => moveDate(-1)} aria-label="Periodo anterior" className="px-3 py-2 text-lg leading-none text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900">‹</button>
            <button type="button" onClick={() => moveDate(1)} aria-label="Periodo siguiente" className="border-l border-zinc-200 px-3 py-2 text-lg leading-none text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900">›</button>
          </div>
          <p className="min-w-48 text-sm font-medium capitalize text-zinc-800">{rangeLabel}</p>
        </div>

        <div className="flex rounded-lg border border-zinc-300 bg-white p-1" role="group" aria-label="Vista de agenda">
          {(['day', 'week', 'month'] as const).map((mode) => {
            const label = mode === 'day' ? 'Día' : mode === 'week' ? 'Semana' : 'Mes'
            return <button key={mode} type="button" onClick={() => setView(mode)} aria-pressed={view === mode} className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === mode ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{label}</button>
          })}
        </div>
      </div>

      <div className="mt-6">
        {view === 'day' ? <DayAgenda date={selectedDate} timezone={context.timezone} unavailability={unavailability} appointments={appointments} highlightedAppointmentIds={highlightedAppointmentIds} onSelect={selectEvent} /> : null}
        {view === 'week' ? <WeekAgenda date={selectedDate} today={today} timezone={context.timezone} unavailability={unavailability} appointments={appointments} highlightedAppointmentIds={highlightedAppointmentIds} onSelect={selectEvent} /> : null}
        {view === 'month' ? <MonthAgenda date={selectedDate} timezone={context.timezone} unavailability={unavailability} appointments={appointments} highlightedAppointmentIds={highlightedAppointmentIds} onSelectDay={selectMonthDay} onSelect={selectEvent} /> : null}
      </div>

      {selectedAppointment ? <AppointmentDialog appointment={selectedAppointment} doctorId={context.doctorId} timezone={context.timezone} onComplete={announceFeedback} onClose={() => setSelectedAppointmentId(null)} /> : null}
      {newAppointmentOpen ? <AppointmentCreateDialog doctorId={context.doctorId} onComplete={announceFeedback} onClose={() => setNewAppointmentOpen(false)} /> : null}
      {selectedUnavailability ? <UnavailabilityDialog item={selectedUnavailability} doctorId={context.doctorId} timezone={context.timezone} onClose={() => setSelectedUnavailability(null)} /> : null}
    </section>
  )
}
