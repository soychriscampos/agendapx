'use client'

import { useActionState, useState } from 'react'

import { setInvitePassword, type InvitePasswordState } from '@/app/actions'

const initialState: InvitePasswordState = {}

export function InvitePasswordForm() {
  const [state, formAction, pending] = useActionState(setInvitePassword, initialState)
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div>
        <label htmlFor="invite-password" className="mb-2 block text-sm font-medium text-zinc-700">Contraseña</label>
        <div className="relative">
          <input id="invite-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} required className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 pr-10 text-zinc-950 outline-none focus:border-zinc-900" />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-900">
            {showPassword ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58a2 2 0 002.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5.05 0 8.48 3.53 9.75 6a11.6 11.6 0 01-3.08 3.85M6.61 6.61C4.62 7.9 3.27 9.65 2.25 12c1.27 2.47 4.7 6 9.75 6 1.17 0 2.25-.18 3.23-.5" /></svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12S5.68 6 12 6s9.75 6 9.75 6S18.32 18 12 18s-9.75-6-9.75-6z" /><circle cx="12" cy="12" r="2.75" /></svg>
            )}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="invite-password-confirmation" className="mb-2 block text-sm font-medium text-zinc-700">Confirmar contraseña</label>
        <div className="relative">
          <input id="invite-password-confirmation" name="password_confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} required className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 pr-10 text-zinc-950 outline-none focus:border-zinc-900" />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-900">
            {showPassword ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58a2 2 0 002.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5.05 0 8.48 3.53 9.75 6a11.6 11.6 0 01-3.08 3.85M6.61 6.61C4.62 7.9 3.27 9.65 2.25 12c1.27 2.47 4.7 6 9.75 6 1.17 0 2.25-.18 3.23-.5" /></svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12S5.68 6 12 6s9.75 6 9.75 6S18.32 18 12 18s-9.75-6-9.75-6z" /><circle cx="12" cy="12" r="2.75" /></svg>
            )}
          </button>
        </div>
      </div>
      {state.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? 'Creando…' : 'Continuar'}
      </button>
    </form>
  )
}
