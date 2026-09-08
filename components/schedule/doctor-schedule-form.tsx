'use client'

import { useActionState, useState } from 'react'

import { saveDoctorScheduleSettings, type SaveDoctorScheduleState } from '@/app/actions'
import type { DoctorSchedule, RecurringUnavailability, ScheduleRange } from '@/lib/schedule/doctor-schedule'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
type ScheduleBlock = { days: number[]; start: string; end: string }
type RecurringBlock = ScheduleBlock & { note: string }

function formatRange(range: ScheduleRange) { return `${range.start}–${range.end}` }

function summaryDays(days: number[]) {
  if (!days.length) return 'Ningún día'
  if (days.length === 5 && days.every((day, index) => day === index + 1)) return 'Lun–Vie'
  if (days.length === 7) return 'Todos los días'
  return days.map((day) => DAYS[day - 1]).join(', ')
}

function groupSchedule(schedule: DoctorSchedule): ScheduleBlock[] {
  const groups = new Map<string, ScheduleBlock>()
  for (const day of schedule) for (const range of day.ranges) {
    const key = formatRange(range)
    const block = groups.get(key) ?? { days: [], start: range.start, end: range.end }
    if (!block.days.includes(day.weekday)) block.days.push(day.weekday)
    groups.set(key, block)
  }
  return Array.from(groups.values()).map((block) => ({ ...block, days: block.days.sort((a, b) => a - b) }))
}

function groupRecurring(items: RecurringUnavailability[]): RecurringBlock[] {
  const groups = new Map<string, RecurringBlock>()
  for (const item of items) {
    const range = item.ranges[0]
    const key = `${formatRange(range)}-${item.internalNote ?? ''}`
    const block = groups.get(key) ?? { days: [], start: range.start, end: range.end, note: item.internalNote ?? '' }
    if (!block.days.includes(item.weekday)) block.days.push(item.weekday)
    groups.set(key, block)
  }
  return Array.from(groups.values()).map((block) => ({ ...block, days: block.days.sort((a, b) => a - b) }))
}

function emptyScheduleBlock(): ScheduleBlock { return { days: [], start: '09:00', end: '17:00' } }
function emptyRecurringBlock(): RecurringBlock { return { days: [], start: '14:00', end: '16:00', note: '' } }

export function DoctorScheduleForm({ doctorId, schedule, recurringUnavailability, showRecurringUnavailability = true }: { doctorId: string; schedule: DoctorSchedule; recurringUnavailability: RecurringUnavailability[]; showRecurringUnavailability?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>(() => groupSchedule(schedule).length ? groupSchedule(schedule) : [emptyScheduleBlock()])
  const [recurringOpen, setRecurringOpen] = useState(showRecurringUnavailability && recurringUnavailability.length > 0)
  const [recurringBlocks, setRecurringBlocks] = useState<RecurringBlock[]>(() => groupRecurring(recurringUnavailability))
  const [state, formAction, pending] = useActionState(saveDoctorScheduleSettings, {} as SaveDoctorScheduleState)

  const assignedScheduleDays = scheduleBlocks.flatMap((block) => block.days)
  const schedulePayload = scheduleBlocks.flatMap((block) => block.days.map((weekday) => ({ weekday, ranges: [{ start: block.start, end: block.end }] })))
  const recurringPayload = recurringOpen ? recurringBlocks.flatMap((block) => block.days.map((weekday) => ({ weekday, ranges: [{ start: block.start, end: block.end }], internalNote: block.note }))) : []

  function toggleScheduleDay(blockIndex: number, day: number) {
    setScheduleBlocks((current) => current.map((block, index) => {
      if (index !== blockIndex) return block
      return { ...block, days: block.days.includes(day) ? block.days.filter((item) => item !== day) : [...block.days, day].sort((a, b) => a - b) }
    }))
  }

  function updateScheduleBlock(blockIndex: number, field: keyof ScheduleRange, value: string) {
    setScheduleBlocks((current) => current.map((block, index) => index === blockIndex ? { ...block, [field]: value } : block))
  }

  function toggleRecurringDay(blockIndex: number, day: number) {
    setRecurringBlocks((current) => current.map((block, index) => index !== blockIndex ? block : { ...block, days: block.days.includes(day) ? block.days.filter((item) => item !== day) : [...block.days, day].sort((a, b) => a - b) }))
  }

  function updateRecurringBlock(blockIndex: number, field: keyof Omit<RecurringBlock, 'days'>, value: string) {
    setRecurringBlocks((current) => current.map((block, index) => index === blockIndex ? { ...block, [field]: value } : block))
  }

  if (!editing) return <section className="max-w-3xl rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-wide text-zinc-500">CUÁNDO ATIENDES</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Horario habitual</h2><p className="mt-3 text-sm text-zinc-700">{schedule.length ? groupSchedule(schedule).map((block) => `${summaryDays(block.days)} · ${formatRange(block)}`).join(' · ') : 'Aún no has definido horarios'}</p>{recurringUnavailability.length ? <p className="mt-2 text-sm text-zinc-600">{groupRecurring(recurringUnavailability).map((block) => `No disponible · ${summaryDays(block.days)} · ${formatRange(block)}`).join(' · ')}</p> : null}</div><button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Editar</button></div></section>

  return <section className="max-w-3xl rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-wide text-zinc-500">CUÁNDO ATIENDES</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">¿Cuándo atiendes normalmente?</h2></div><button type="button" onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:text-zinc-900">Cancelar</button></div><form action={formAction} className="mt-6 space-y-6"><input type="hidden" name="doctor_id" value={doctorId} /><input type="hidden" name="schedule" value={JSON.stringify(schedulePayload)} /><input type="hidden" name="recurring_unavailability" value={JSON.stringify(recurringPayload)} /><div className="space-y-4"><p className="text-sm font-medium text-zinc-900">Selecciona tus días y horarios</p>{scheduleBlocks.map((block, blockIndex) => <div key={blockIndex} className="rounded-lg bg-zinc-50 p-4"><div className="flex flex-wrap gap-2">{DAYS.map((day, index) => { const selected = block.days.includes(index + 1); const assignedElsewhere = assignedScheduleDays.includes(index + 1) && !selected; return <button key={day} type="button" disabled={assignedElsewhere} onClick={() => toggleScheduleDay(blockIndex, index + 1)} aria-pressed={selected} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${selected ? 'border-zinc-800 bg-zinc-800 text-white' : assignedElsewhere ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-300' : 'border-zinc-300 text-zinc-600 hover:bg-white'}`}>{day}</button> })}</div><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs text-zinc-500">Desde<input type="time" value={block.start} onChange={(event) => updateScheduleBlock(blockIndex, 'start', event.target.value)} className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label><span className="pb-2 text-sm text-zinc-400">a</span><label className="text-xs text-zinc-500">Hasta<input type="time" value={block.end} onChange={(event) => updateScheduleBlock(blockIndex, 'end', event.target.value)} className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label><button type="button" onClick={() => setScheduleBlocks((current) => current.filter((_, index) => index !== blockIndex))} disabled={scheduleBlocks.length === 1} className="pb-2 text-xs text-zinc-500 hover:text-red-700 disabled:cursor-not-allowed disabled:text-zinc-300">Eliminar</button></div></div>)}<button type="button" onClick={() => setScheduleBlocks((current) => [...current, emptyScheduleBlock()])} className="text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Agregar otro horario</button><p className="text-xs text-zinc-500">Los días que no selecciones quedan cerrados.</p></div>{showRecurringUnavailability ? <div className="border-t border-zinc-200 pt-5"><p className="text-sm font-medium text-zinc-900">¿Tienes algún horario fijo en el que normalmente no atiendes?</p>{!recurringOpen ? <button type="button" onClick={() => { setRecurringOpen(true); if (!recurringBlocks.length) setRecurringBlocks([emptyRecurringBlock()]) }} className="mt-3 text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Agregar horario no disponible</button> : <div className="mt-4 space-y-4">{recurringBlocks.map((block, blockIndex) => <div key={blockIndex} className="rounded-lg bg-zinc-50 p-4"><div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2">{DAYS.map((day, index) => <button key={day} type="button" onClick={() => toggleRecurringDay(blockIndex, index + 1)} aria-pressed={block.days.includes(index + 1)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${block.days.includes(index + 1) ? 'border-zinc-800 bg-zinc-800 text-white' : 'border-zinc-300 text-zinc-600'}`}>{day}</button>)}</div><button type="button" onClick={() => setRecurringBlocks((current) => current.filter((_, index) => index !== blockIndex))} className="text-xs text-zinc-500 hover:text-red-700">Eliminar</button></div><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs text-zinc-500">Desde<input type="time" value={block.start} onChange={(event) => updateRecurringBlock(blockIndex, 'start', event.target.value)} className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label><span className="pb-2 text-sm text-zinc-400">a</span><label className="text-xs text-zinc-500">Hasta<input type="time" value={block.end} onChange={(event) => updateRecurringBlock(blockIndex, 'end', event.target.value)} className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label></div><label className="mt-3 block text-xs text-zinc-500">Nota interna opcional<textarea value={block.note} onChange={(event) => updateRecurringBlock(blockIndex, 'note', event.target.value)} rows={2} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label></div>)}<button type="button" onClick={() => setRecurringBlocks((current) => [...current, emptyRecurringBlock()])} className="text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Agregar otro horario no disponible</button></div>}</div> : null}{state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}{state.success ? <p className="text-sm text-emerald-700" role="status">{state.success}</p> : null}<button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar'}</button></form></section>
}
