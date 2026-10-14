'use client'

import { useActionState } from 'react'

import { acceptInvitation, type AcceptInvitationState } from '@/app/actions'

const initialState: AcceptInvitationState = {}

export function AcceptInvitationForm({ tokenHash, type }: { tokenHash: string; type: 'invite' | 'recovery' }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, initialState)

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? 'Validando…' : 'Aceptar invitación'}
      </button>
    </form>
  )
}
