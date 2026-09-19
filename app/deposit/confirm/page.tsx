import { confirmDepositPublicAction } from '@/app/deposit/actions'
import { formatDepositAmount, getDepositActionState, isUuid, verifyDepositActionSignature } from '@/lib/deposits/phase9'

function DepositStatus({ title, message }: { title: string; message: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p><h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">{title}</h1><p className="mt-3 text-base leading-7 text-zinc-600">{message}</p></section></main>
}

const statusPresentation: Record<string, { title: string; message: string }> = {
  WAITING_DEPOSIT: { title: 'Confirmar anticipo', message: 'Esta solicitud todavía está esperando la confirmación del anticipo.' },
  DEPOSIT_CONFIRMED: { title: 'Anticipo confirmado', message: 'El anticipo ya fue confirmado. La solicitud está lista para continuar con el proceso de agenda.' },
  CANCELLED: { title: 'Solicitud cancelada', message: 'Esta solicitud fue cancelada.' },
  WAITING_SCHEDULING: { title: 'Esperando agenda', message: 'La solicitud ya avanzó al proceso de agenda.' },
  CONFIRMED: { title: 'Solicitud procesada', message: 'La solicitud ya fue procesada.' },
  NEW: { title: 'Solicitud actualizada', message: 'La solicitud ya no está en el estado de anticipo pendiente.' },
}

export default async function DepositConfirmationPage({ searchParams }: { searchParams: Promise<{ action?: string; signature?: string; error?: string }> }) {
  const params = await searchParams
  if (params.error === 'invalid' || !params.action || !params.signature || !isUuid(params.action) || !verifyDepositActionSignature(params.action, params.signature)) {
    return <DepositStatus title="Este enlace no es válido." message="Solicita al consultorio que revise la solicitud desde HelloPx." />
  }

  const state = await getDepositActionState(params.action)
  if (state.ok !== true) return <DepositStatus title="No encontramos esta acción." message="Puede que el enlace no corresponda a una solicitud disponible." />

  const requestStatus = typeof state.request_status === 'string' ? state.request_status : 'UNKNOWN'
  const amount = typeof state.deposit_amount === 'number' ? formatDepositAmount(state.deposit_amount) : null
  const presentation = statusPresentation[requestStatus] ?? { title: 'Estado de la solicitud', message: `Estado actual de la solicitud: ${requestStatus}.` }

  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p><h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">{presentation.title}</h1><p className="mt-3 text-base leading-7 text-zinc-600">{presentation.message}</p>{requestStatus === 'WAITING_DEPOSIT' ? <><dl className="mt-6 space-y-3 rounded-lg bg-zinc-50 p-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-zinc-500">Paciente</dt><dd className="text-right font-medium text-zinc-900">{String(state.patient_name ?? 'Paciente')}</dd></div><div className="flex justify-between gap-4"><dt className="text-zinc-500">Doctor</dt><dd className="text-right font-medium text-zinc-900">{String(state.doctor_name ?? 'Consultorio')}</dd></div>{amount ? <div className="flex justify-between gap-4"><dt className="text-zinc-500">Anticipo</dt><dd className="text-right font-medium text-zinc-900">{amount} MXN</dd></div> : null}</dl><p className="mt-5 text-sm leading-6 text-zinc-600">Confirma únicamente después de verificar que recibiste el pago.</p><form action={confirmDepositPublicAction} className="mt-5"><input type="hidden" name="action" value={params.action} /><input type="hidden" name="signature" value={params.signature} /><button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700">Confirmar anticipo recibido</button></form></> : null}</section></main>
}
