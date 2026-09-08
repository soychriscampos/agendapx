'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { createDoctorUnavailabilityAction, type UnavailabilityActionState } from '@/app/actions'
import { getDateTimeInTimezone } from '@/lib/agenda/timezone'

type Mode = 'HOURS' | 'DAYS'
const timeInputClass = 'mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm'

export function UnavailabilityPanel({ doctorId, timezone }: { doctorId: string; timezone: string }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('HOURS')
  const [state, setState] = useState<UnavailabilityActionState>({})
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await createDoctorUnavailabilityAction({}, formData)
      setState(result)
      if (result.success) { setOpen(false); formRef.current?.reset(); router.refresh() }
    })
  }

  return <>
    <button type="button" onClick={() => { setOpen((value) => !value); setState({}) }} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">No disponible</button>
    {open ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/30 p-4" role="presentation" onClick={() => setOpen(false)}><form ref={formRef} onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl sm:p-5">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agenda</p><h2 className="mt-1 text-xl font-semibold text-zinc-950">No disponible</h2></div><button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-900">Cerrar</button></div>
      <input type="hidden" name="doctor_id" value={doctorId} /><input type="hidden" name="mode" value={mode} />
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setMode('HOURS')} aria-pressed={mode === 'HOURS'} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${mode === 'HOURS' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-600'}`}>Unas horas</button><button type="button" onClick={() => setMode('DAYS')} aria-pressed={mode === 'DAYS'} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${mode === 'DAYS' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-600'}`}>Días completos</button></div>
      <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs text-zinc-500">{mode === 'HOURS' ? 'Fecha' : 'Desde'}<input type="date" name="date_from" className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required /></label>{mode === 'DAYS' ? <label className="text-xs text-zinc-500">Hasta<input type="date" name="date_to" className="mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required /></label> : <><label className="text-xs text-zinc-500">Desde<input type="time" name="start" defaultValue="09:00" className={timeInputClass} required /></label><span className="pb-2 text-sm text-zinc-400">a</span><label className="text-xs text-zinc-500">Hasta<input type="time" name="end" defaultValue="10:00" className={timeInputClass} required /></label></>}</div>
      <label className="mt-4 block text-xs text-zinc-500">Nota interna opcional<textarea name="internal_note" rows={2} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label>
      {state.error ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="alert"><p className="font-medium">{state.error}</p>{state.appointments?.length ? <div className="mt-2 space-y-2">{state.appointments.map((appointment) => { const start = getDateTimeInTimezone(timezone, new Date(appointment.startAt)); const end = getDateTimeInTimezone(timezone, new Date(appointment.endAt)); return <div key={appointment.id}><p className="font-medium">{appointment.patientName}</p><p className="text-xs">{start.date} · {start.time}–{end.time}</p></div> })}<p className="mt-2 text-xs">Reprograma o cancela estas citas antes de marcar este periodo como no disponible.</p></div> : null}</div> : null}
      <button type="submit" disabled={pending} className="mt-4 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar'}</button>
    </form></div> : null}
  </>
}
