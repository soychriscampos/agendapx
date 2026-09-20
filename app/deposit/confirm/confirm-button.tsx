'use client'

import { useFormStatus } from 'react-dom'

export function ConfirmDepositButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Confirmando...' : 'Confirmar anticipo recibido'}
    </button>
  )
}
