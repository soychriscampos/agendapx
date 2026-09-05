'use client'

import { useMemo, useState } from 'react'

import type { AgendaContext } from '@/lib/agenda/context'
import { getDateInTimezone } from '@/lib/agenda/timezone'
import {
  demoAgendaEvents,
  type DemoAgendaEvent,
  type DemoAppointmentStatus,
} from '@/lib/agenda/demo-data'

type AgendaViewMode = 'day' | 'week' | 'month'

type AgendaContentProps = {
  context: AgendaContext
}

const HOURS = Array.from({ length: 11 }, (_, index) => index + 8)
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const appointmentStatusLabels: Record<DemoAppointmentStatus, string> = {
  CONFIRMED: 'Confirmada',
  PENDING_ADVANCE: 'Pendiente de anticipo',
  PENDING_CONFIRMATION: 'Pendiente de confirmación',
}

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

function eventForDate(date: Date, event: DemoAgendaEvent) {
  return event.date === dateKey(date)
}

function eventsForDate(date: Date) {
  return demoAgendaEvents.filter((event) => eventForDate(date, event))
}

function statusTone(status: DemoAppointmentStatus) {
  if (status === 'PENDING_ADVANCE') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (status === 'PENDING_CONFIRMATION') return 'border-sky-200 bg-sky-50 text-sky-950'
  return 'border-emerald-200 bg-emerald-50 text-emerald-950'
}

function eventTime(event: DemoAgendaEvent) {
  return `${event.start}–${event.end}`
}

function MiniEvent({ event, onSelect }: { event: DemoAgendaEvent; onSelect: (event: DemoAgendaEvent) => void }) {
  if (event.kind === 'block') {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-100 px-2.5 py-2 text-xs text-zinc-600">
        <p className="font-medium text-zinc-800">{event.label}</p>
        <p className="mt-0.5">{eventTime(event)}</p>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={`w-full rounded-md border px-2.5 py-2 text-left text-xs ${statusTone(event.status)} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900`}
    >
      <p className="font-semibold">{event.patient}</p>
      <p className="mt-0.5">{event.appointmentType}</p>
      <p className="mt-1 font-medium">{eventTime(event)}</p>
    </button>
  )
}

function DayAgenda({ date, onSelect }: { date: Date; onSelect: (event: DemoAgendaEvent) => void }) {
  const events = eventsForDate(date)

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {HOURS.map((hour) => {
        const hourEvents = events.filter((event) => Math.floor(parseTime(event.start) / 60) === hour)

        return (
          <div key={hour} className="grid min-h-20 grid-cols-[4.5rem_minmax(0,1fr)] border-b border-zinc-100 last:border-b-0">
            <div className="border-r border-zinc-100 px-3 py-3 text-xs text-zinc-400">{String(hour).padStart(2, '0')}:00</div>
            <div className="space-y-2 p-2">
              {hourEvents.length ? hourEvents.map((event) => <MiniEvent key={event.id} event={event} onSelect={onSelect} />) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekAgenda({ date, today, onSelect }: { date: Date; today: Date; onSelect: (event: DemoAgendaEvent) => void }) {
  const weekStart = startOfWeek(date)

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <div className="grid min-w-[760px] grid-cols-7">
        {WEEKDAYS.map((weekday, index) => {
          const day = addDays(weekStart, index)
          const isToday = dateKey(day) === dateKey(today)

          return (
            <div key={weekday} className="min-h-[34rem] border-r border-zinc-100 last:border-r-0">
              <div className={`border-b border-zinc-200 px-3 py-3 ${isToday ? 'bg-zinc-900 text-white' : 'bg-zinc-50'}`}>
                <p className="text-xs font-medium uppercase tracking-wide opacity-70">{weekday}</p>
                <p className="mt-1 text-lg font-semibold">{day.getDate()}</p>
              </div>
              <div className="space-y-2 p-2">
                {eventsForDate(day).map((event) => <MiniEvent key={event.id} event={event} onSelect={onSelect} />)}
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

function MonthAgenda({ date, onSelectDay }: { date: Date; onSelectDay: (date: Date) => void }) {
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
            const dayEvents = eventsForDate(day)
            const isOutsideMonth = day.getMonth() !== month

            return (
              <button
                key={dateKey(day)}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`min-h-28 border-b border-r border-zinc-100 p-2 text-left align-top last:border-r-0 hover:bg-zinc-50 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 ${isOutsideMonth ? 'bg-zinc-50/60 text-zinc-400' : 'text-zinc-900'}`}
              >
                <span className="text-sm font-semibold">{day.getDate()}</span>
                <span className="mt-2 block space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <span key={event.id} className={`block truncate rounded px-1.5 py-1 text-[11px] ${event.kind === 'block' ? 'border border-dashed border-zinc-300 text-zinc-500' : statusTone(event.status)}`}>
                      {event.kind === 'block' ? event.label : event.patient}
                    </span>
                  ))}
                  {dayEvents.length > 2 ? <span className="block px-1.5 text-[11px] text-zinc-400">+{dayEvents.length - 2} más</span> : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function OperationalIndicators({ date }: { date: Date }) {
  const todayEvents = eventsForDate(date)
  const appointments = todayEvents.filter((event) => event.kind === 'appointment')
  const pendingAdvance = demoAgendaEvents.filter((event) => event.kind === 'appointment' && event.status === 'PENDING_ADVANCE').length
  const pendingConfirmation = demoAgendaEvents.filter((event) => event.kind === 'appointment' && event.status === 'PENDING_CONFIRMATION').length

  const indicators = [
    { label: 'Citas de hoy', value: appointments.length },
    { label: 'Pendientes de anticipo', value: pendingAdvance },
    { label: 'Pendientes de confirmación', value: pendingConfirmation },
    { label: 'Requiere atención', value: pendingAdvance + pendingConfirmation },
  ]

  return (
    <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-zinc-200 py-4 sm:grid-cols-4">
      {indicators.map((indicator) => (
        <div key={indicator.label}>
          <p className="text-xs text-zinc-500">{indicator.label}</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{indicator.value}</p>
        </div>
      ))}
    </div>
  )
}

function AppointmentDialog({ event, onClose }: { event: Extract<DemoAgendaEvent, { kind: 'appointment' }>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-zinc-950/30 p-4 sm:items-center" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl" onClick={(eventClick) => eventClick.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Detalle de cita</p>
            <h2 id="appointment-detail-title" className="mt-1 text-xl font-semibold text-zinc-950">{event.patient}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="rounded-md px-2 py-1 text-xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">×</button>
        </div>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
          <dt className="text-zinc-500">Tipo</dt><dd className="font-medium text-zinc-900">{event.appointmentType}</dd>
          <dt className="text-zinc-500">Fecha</dt><dd className="font-medium text-zinc-900">{formatDate(new Date(`${event.date}T12:00:00`), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd>
          <dt className="text-zinc-500">Horario</dt><dd className="font-medium text-zinc-900">{eventTime(event)}</dd>
          <dt className="text-zinc-500">Estado</dt><dd className="font-medium text-zinc-900">{appointmentStatusLabels[event.status]}</dd>
        </dl>
        <div className="mt-7 flex gap-2">
          <button type="button" disabled className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-400">Reprogramar</button>
          <button type="button" disabled className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-400">Cancelar</button>
        </div>
        <p className="mt-3 text-xs text-zinc-400">Las acciones estarán disponibles en una fase posterior.</p>
      </section>
    </div>
  )
}

export function AgendaContent({ context }: AgendaContentProps) {
  const today = getDateInTimezone(context.timezone)
  const [view, setView] = useState<AgendaViewMode>('week')
  const [selectedDate, setSelectedDate] = useState(() => getDateInTimezone(context.timezone))
  const [selectedEvent, setSelectedEvent] = useState<Extract<DemoAgendaEvent, { kind: 'appointment' }> | null>(null)

  const rangeLabel = useMemo(() => formatRange(selectedDate, view), [selectedDate, view])

  function moveDate(direction: number) {
    if (view === 'day') setSelectedDate((date) => addDays(date, direction))
    if (view === 'week') setSelectedDate((date) => addDays(date, direction * 7))
    if (view === 'month') setSelectedDate((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1))
  }

  function selectMonthDay(date: Date) {
    setSelectedDate(date)
    setView('day')
  }

  function selectEvent(event: DemoAgendaEvent) {
    if (event.kind === 'appointment') setSelectedEvent(event)
  }

  return (
    <section className="mx-auto max-w-7xl" data-doctor-id={context.doctorId}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">Agenda</h1>
        <p className="mt-2 text-sm text-zinc-600">Organiza tu semana y revisa las citas de tus pacientes.</p>
      </header>

      <OperationalIndicators date={today} />

      <div className="mt-7 flex flex-col gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
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
        {view === 'day' ? <DayAgenda date={selectedDate} onSelect={selectEvent} /> : null}
        {view === 'week' ? <WeekAgenda date={selectedDate} today={today} onSelect={selectEvent} /> : null}
        {view === 'month' ? <MonthAgenda date={selectedDate} onSelectDay={selectMonthDay} /> : null}
      </div>

      <p className="mt-4 text-xs text-zinc-400">Vista demo: las citas y bloqueos mostrados son datos temporales.</p>

      {selectedEvent ? <AppointmentDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}
    </section>
  )
}
