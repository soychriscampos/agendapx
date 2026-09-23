'use client'

import { useActionState } from 'react'

import { retrySchedulingCall, type RetrySchedulingState } from '@/app/app/requests/actions'

const initialState: RetrySchedulingState = 'idle'

export function RetrySchedulingCall({ requestId }: { requestId: string }) {
  const action = retrySchedulingCall.bind(null, requestId)
  const [state, formAction, pending] = useActionState(action, initialState)

  return (
    <section className="border-t border-zinc-200 pt-5">
      <h2 className="text-sm font-semibold text-zinc-950">Volver a intentar</h2>
      <p className="mt-2 text-sm text-zinc-600">Puedes volver a llamar al contacto para coordinar la cita.</p>
      <form action={formAction} className="mt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Iniciando…' : 'Volver a llamar'}
        </button>
      </form>
      {state !== 'idle' && (
        <p aria-live="polite" className="mt-3 text-sm text-zinc-600">
          {state === 'started' && 'Llamada iniciada.'}
          {state === 'active' && 'Ya hay una llamada en curso.'}
          {state === 'error' && 'No fue posible iniciar la llamada.'}
        </p>
      )}
    </section>
  )
}
