'use client'

import { useActionState } from 'react'

import { login, type LoginState } from '@/app/actions'

const initialState: LoginState = {}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState)
  const error = state.error ?? (initialError === 'profile'
    ? 'Tu sesión no tiene un perfil de AgendaPX habilitado.'
    : undefined)

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-medium text-zinc-700">Correo electrónico</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-900" />
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-sm font-medium text-zinc-700">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-900" />
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? 'Ingresando…' : 'Iniciar sesión'}
      </button>
    </form>
  )
}
