'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { createAppointmentAction } from '@/app/actions'

const timeInputClass = 'mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm'

export function AppointmentCreateDialog({ doctorId, onClose }: { doctorId: string; onClose: () => void }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await createAppointmentAction({}, data)
      if (result.error) setError(result.error)
      else {
        onClose()
        formRef.current?.reset()
        router.refresh()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/30 p-4" role="presentation" onClick={onClose}>
      <form ref={formRef} onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agenda</p><h2 className="mt-1 text-xl font-semibold text-zinc-950">Nueva cita</h2></div>
          <button type="button" onClick={onClose} className="text-sm text-zinc-500">Cerrar</button>
        </div>
        <input type="hidden" name="doctor_id" value={doctorId} />
        <div className="mt-5 space-y-3">
          <label className="block text-xs text-zinc-500">Nombre del paciente<input name="patient_name" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required /></label>
          <label className="block text-xs text-zinc-500">Fecha<input type="date" name="date" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required /></label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-500">Desde<input type="time" name="start" defaultValue="09:00" className={timeInputClass} required /></label>
            <span className="pb-2 text-sm text-zinc-400">a</span>
            <label className="text-xs text-zinc-500">Hasta<input type="time" name="end" defaultValue="10:00" className={timeInputClass} required /></label>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <button type="submit" disabled={pending} className="mt-5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Crear cita'}</button>
      </form>
    </div>
  )
}
