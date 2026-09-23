'use client'

import { useFormStatus } from 'react-dom'

export function ConfirmDepositButton() {
  const { pending } = useFormStatus()

  return <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">{pending ? 'Confirmando anticipo…' : 'Confirmar anticipo'}</button>
}
