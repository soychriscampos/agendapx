'use client'

import { useActionState, useState } from 'react'

import { updateDoctor, type UpdateDoctorState } from '@/app/actions'

type Doctor = {
  id: string
  display_name: string
  phone: string | null
  whatsapp: string | null
  status: 'ACTIVE' | 'INACTIVE'
  timezone: string
  retell_agent_id: string | null
  twilio_phone_number: string | null
}

const initialState: UpdateDoctorState = {}

function valueOrDash(value: string | null) {
  return value || '—'
}

function DoctorEditor({ doctor }: { doctor: Doctor }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(updateDoctor, initialState)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">Editar</button>
      {open ? <div className="fixed inset-0 z-20 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby={'edit-doctor-' + doctor.id}>
        <form action={formAction} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-xl">
          <input type="hidden" name="doctor_id" value={doctor.id} />
          <div className="mb-4 flex items-center justify-between gap-4">
            <p id={'edit-doctor-' + doctor.id} className="text-sm font-semibold text-zinc-900">Editar doctor</p>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-900">Cerrar</button>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-zinc-600">Nombre<input name="display_name" defaultValue={doctor.display_name} className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required /></label>
            <label className="block text-xs font-medium text-zinc-600">Teléfono<input name="phone" defaultValue={doctor.phone ?? ''} className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-zinc-600">WhatsApp<input name="whatsapp" defaultValue={doctor.whatsapp ?? ''} className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-zinc-600">Estado<select name="status" defaultValue={doctor.status} className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm"><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>
            <label className="block text-xs font-medium text-zinc-600">Zona horaria IANA<input name="timezone" defaultValue={doctor.timezone} placeholder="America/Mazatlan" className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required /></label>
            <label className="block text-xs font-medium text-zinc-600">Retell Agent ID<input name="retell_agent_id" defaultValue={doctor.retell_agent_id ?? ''} className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-zinc-600">Twilio number técnico<input name="twilio_phone_number" defaultValue={doctor.twilio_phone_number ?? ''} className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" /></label>
          </div>
          {state.error ? <p className="mt-3 text-xs text-red-700" role="alert">{state.error}</p> : null}
          {state.success ? <p className="mt-3 text-xs text-emerald-700" role="status">{state.success}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="w-1/3 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700">Cancelar</button>
            <button type="submit" disabled={pending} className="w-2/3 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </form>
      </div> : null}
    </>
  )
}

export function DoctorTable({ doctors }: { doctors: Doctor[] }) {
  if (!doctors.length) return <p className="px-6 py-10 text-center text-sm text-zinc-500">No hay doctores registrados.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500"><tr>
          <th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Teléfono</th><th className="px-4 py-3">WhatsApp</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Zona horaria</th><th className="px-4 py-3">Retell Agent ID</th><th className="px-4 py-3">Twilio number</th><th className="px-4 py-3">Acción</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">{doctors.map((doctor) => (
          <tr key={doctor.id} className="align-middle text-zinc-700">
            <td className="whitespace-nowrap px-4 py-4 font-medium text-zinc-950">{doctor.display_name}</td><td className="px-4 py-4">{valueOrDash(doctor.phone)}</td><td className="px-4 py-4">{valueOrDash(doctor.whatsapp)}</td><td className="px-4 py-4"><span className={doctor.status === 'ACTIVE' ? 'text-emerald-700' : 'text-zinc-500'}>{doctor.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</span></td><td className="px-4 py-4 font-mono text-xs">{doctor.timezone}</td><td className="px-4 py-4 font-mono text-xs">{valueOrDash(doctor.retell_agent_id)}</td><td className="px-4 py-4 font-mono text-xs">{valueOrDash(doctor.twilio_phone_number)}</td><td className="px-4 py-4"><div className="flex items-center gap-2"><a href={'/master/doctors/' + doctor.id + '/agenda'} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">Entrar</a><DoctorEditor doctor={doctor} /></div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
