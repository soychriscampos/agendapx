'use client'

import { useActionState, useState } from 'react'

import { inviteDoctor, type InviteDoctorState } from '@/app/actions'

const initialState: InviteDoctorState = {}

const timezoneOptions = [
  { value: 'America/Tijuana', label: 'Baja California — Tijuana' },
  { value: 'America/Hermosillo', label: 'Sonora — Hermosillo' },
  { value: 'America/Mazatlan', label: 'Sinaloa / Nayarit / BCS — Mazatlán' },
  { value: 'America/Chihuahua', label: 'Chihuahua' },
  { value: 'America/Monterrey', label: 'Noreste — Monterrey' },
  { value: 'America/Mexico_City', label: 'Centro de México — Ciudad de México' },
  { value: 'America/Cancun', label: 'Quintana Roo — Cancún' },
]

export function InviteDoctor() {
  const [open, setOpen] = useState(false)
  const [sameAsWhatsapp, setSameAsWhatsapp] = useState(false)
  const [state, formAction, pending] = useActionState(inviteDoctor, initialState)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
        Invitar doctor
      </button>
      {open ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby="invite-doctor-title">
          <form action={formAction} className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <p id="invite-doctor-title" className="text-sm font-semibold text-zinc-900">Invitar doctor</p>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-900">Cerrar</button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-zinc-600">
                Nombre
                <input name="display_name" className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required />
              </label>
              <label className="block text-xs font-medium text-zinc-600">
                Correo
                <input name="email" type="email" autoComplete="email" className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required />
              </label>
              <label className="block text-xs font-medium text-zinc-600">
                Teléfono
                <input name="phone" type="tel" autoComplete="tel" className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                <input name="same_as_whatsapp" type="checkbox" value="true" checked={sameAsWhatsapp} onChange={(event) => setSameAsWhatsapp(event.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
                Este número también recibe WhatsApp
              </label>
              {!sameAsWhatsapp ? (
                <label className="block text-xs font-medium text-zinc-600">
                  WhatsApp
                  <input name="whatsapp" type="tel" autoComplete="tel" className="mt-1 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm" required />
                </label>
              ) : null}
              <label className="block text-xs font-medium text-zinc-600">
                Zona horaria
                <select name="timezone" defaultValue="" className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required>
                  <option value="" disabled>Selecciona una zona horaria</option>
                  {timezoneOptions.map((timezone) => <option key={timezone.value} value={timezone.value}>{timezone.label}</option>)}
                </select>
              </label>
            </div>
            {state.error ? <p className="mt-3 text-xs text-red-700" role="alert">{state.error}</p> : null}
            {state.success ? <p className="mt-3 text-xs text-emerald-700" role="status">{state.success}</p> : null}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="w-1/3 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700">Cancelar</button>
              <button type="submit" disabled={pending} className="w-2/3 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {pending ? 'Enviando…' : 'Enviar invitación'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
