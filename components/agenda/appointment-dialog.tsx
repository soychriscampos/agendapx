'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { cancelAppointmentAction, openAppointmentConfirmationReminderAction, startAppointmentConfirmationAction, updateAppointmentAction } from '@/app/actions'
import { getDateTimeInTimezone } from '@/lib/agenda/timezone'
import type { Appointment } from '@/lib/appointments/appointments'

export function AppointmentDialog({ appointment, doctorId, timezone, onComplete, onClose }: { appointment: Appointment; doctorId: string; timezone: string; onComplete: (message: string) => void; onClose: () => void }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const start = getDateTimeInTimezone(timezone, new Date(appointment.startAt))
  const end = getDateTimeInTimezone(timezone, new Date(appointment.endAt))
  const canStartConfirmation = appointment.status === 'CONFIRMED' && appointment.confirmationStatus === 'PENDING' && new Date(appointment.startAt) > new Date()

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updateAppointmentAction({}, formData)
      if (result.error) setError(result.error)
      else { onComplete('Cita reprogramada'); onClose(); router.refresh() }
    })
  }

  function cancel() {
    if (!window.confirm('¿Cancelar esta cita?')) return
    const formData = new FormData()
    formData.set('doctor_id', doctorId); formData.set('id', appointment.id)
    startTransition(async () => {
      const result = await cancelAppointmentAction(formData)
      if (result.error) setError(result.error)
      else { onComplete('Cita cancelada'); onClose(); router.refresh() }
    })
  }

  function startConfirmation() {
    startTransition(async () => {
      const result = await startAppointmentConfirmationAction(appointment.id)
      if (result.error) setError(result.error)
      else { setError(result.success); router.refresh() }
    })
  }

  function openReminder() {
    startTransition(async () => {
      const result = await openAppointmentConfirmationReminderAction(appointment.id)
      if (result.error) setError(result.error)
    })
  }

  const confirmationLabel: Record<Appointment['confirmationStatus'], string> = {
    PENDING: 'Asistencia pendiente de confirmar',
    CONFIRMED: 'Asistencia confirmada por el paciente',
    CANCELLED: 'Cita cancelada',
    REMINDER_PENDING: 'No fue posible confirmar por llamada',
    REMINDER_STARTED: 'Esperando respuesta al recordatorio',
    MANUAL_REQUIRED: 'Necesita tu decisión',
  }

  return <div className="fixed inset-0 z-30 flex items-end justify-center bg-zinc-950/30 p-4 sm:items-center" role="presentation" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-7" onClick={(click) => click.stopPropagation()}>{editing ? <form onSubmit={save}><input type="hidden" name="doctor_id" value={doctorId} /><input type="hidden" name="id" value={appointment.id} /><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reprogramar cita</p><h2 className="mt-1 text-xl font-semibold text-zinc-950">{appointment.patientName}</h2></div><button type="button" onClick={() => setEditing(false)} className="text-sm text-zinc-500">Cancelar</button></div><div className="mt-6 space-y-4"><label className="block text-xs font-medium text-zinc-600">Nombre del paciente<input name="patient_name" defaultValue={appointment.patientName} className="mt-1.5 block w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm" required /></label><label className="block text-xs font-medium text-zinc-600">Fecha<input type="date" name="date" defaultValue={start.date} className="mt-1.5 block rounded-lg border border-zinc-300 px-3 py-2.5 text-sm" required /></label><div className="flex items-end gap-3"><label className="text-xs font-medium text-zinc-600">Desde<input type="time" name="start" defaultValue={start.time} className="mt-1.5 block rounded-lg border border-zinc-300 px-3 py-2.5 text-sm" required /></label><span className="pb-2.5 text-sm text-zinc-400">a</span><label className="text-xs font-medium text-zinc-600">Hasta<input type="time" name="end" defaultValue={end.time} className="mt-1.5 block rounded-lg border border-zinc-300 px-3 py-2.5 text-sm" required /></label></div></div>{error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}<div className="mt-6 border-t border-zinc-100 pt-5"><button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar cambios'}</button></div></form> : <><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cita</p><h2 id="appointment-detail-title" className="mt-1 text-xl font-semibold text-zinc-950">{appointment.patientName}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar detalle" className="text-xl text-zinc-400">×</button></div><dl className="mt-6 grid gap-3 border-y border-zinc-100 py-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-zinc-500">Estado de cita</dt><dd className="mt-1 font-medium text-zinc-900">{appointment.status === 'CONFIRMED' ? 'Cita agendada' : 'Cita cancelada'}</dd></div><div><dt className="text-xs font-medium text-zinc-500">Asistencia</dt><dd className="mt-1 font-medium text-zinc-900">{appointment.status === 'CANCELLED' ? 'Cita cancelada' : confirmationLabel[appointment.confirmationStatus]}</dd></div></dl><dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm"><dt className="text-zinc-500">Fecha</dt><dd className="font-medium text-zinc-900">{start.date}</dd><dt className="text-zinc-500">Horario</dt><dd className="font-medium tabular-nums text-zinc-900">{start.time}–{end.time}</dd></dl>{appointment.confirmationStatus === 'MANUAL_REQUIRED' && appointment.status === 'CONFIRMED' ? <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">El paciente no respondió después del recordatorio. Esta cita sigue reservada hasta que decidas qué hacer.</p> : null}{appointment.confirmationStatus === 'REMINDER_PENDING' && appointment.status === 'CONFIRMED' ? <p className="mt-5 text-sm leading-6 text-zinc-600">Puedes enviar un recordatorio por WhatsApp para pedir la confirmación de asistencia.</p> : null}{error ? <p className="mt-3 text-sm text-zinc-600" role="status">{error}</p> : null}<div className="mt-7 flex flex-wrap gap-2 border-t border-zinc-100 pt-5">{canStartConfirmation ? <button type="button" onClick={startConfirmation} disabled={pending} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800">{pending ? 'Iniciando…' : 'Iniciar confirmación'}</button> : null}{appointment.confirmationStatus === 'REMINDER_PENDING' && appointment.status === 'CONFIRMED' ? <button type="button" onClick={openReminder} disabled={pending} className="rounded-lg bg-[#25D366] px-3 py-2 text-sm font-medium text-white hover:bg-[#1ebe5b] disabled:opacity-60">{pending ? 'Abriendo…' : 'Enviar recordatorio por WhatsApp'}</button> : null}<button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">Reprogramar</button><button type="button" onClick={cancel} disabled={pending} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700">Cancelar</button></div></>}</section></div>
}
