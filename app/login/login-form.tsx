'use client'

import { type FormEvent, useState } from 'react'

import { isLoginDestination } from '@/lib/auth-destination'

const profileError = 'Tu sesión no tiene un perfil de HelloPx habilitado.'
const genericError = 'No se pudo iniciar sesión. Inténtalo de nuevo.'

function responseError(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return genericError
  const error = (payload as Record<string, unknown>).error
  return typeof error === 'string' && error ? error : genericError
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(initialError === 'profile' ? profileError : undefined)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    let navigationStarted = false

    setPending(true)
    setError(undefined)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        setError(genericError)
        return
      }

      if (!response.ok) {
        setError(responseError(payload))
        return
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        setError(genericError)
        return
      }

      const record = payload as Record<string, unknown>
      if (record.status !== 'success' || !isLoginDestination(record.destination)) {
        setError(genericError)
        return
      }

      window.location.replace(record.destination)
      navigationStarted = true
    } catch {
      setError(genericError)
    } finally {
      if (!navigationStarted) setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-medium text-zinc-700">Correo electrónico</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 placeholder:text-zinc-500 outline-none transition focus:border-zinc-700 focus:ring-2 focus:ring-zinc-200" />
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-sm font-medium text-zinc-700">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 placeholder:text-zinc-500 outline-none transition focus:border-zinc-700 focus:ring-2 focus:ring-zinc-200" />
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? 'Ingresando…' : 'Iniciar sesión'}
      </button>
    </form>
  )
}
