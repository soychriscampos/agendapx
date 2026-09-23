import { confirmDepositFromHelloPx } from '@/app/deposit/actions'
import type { DepositEmailPayload } from '@/lib/deposits/phase9'
import { formatDepositAmount, getDepositWhatsAppUrl } from '@/lib/deposits/phase9'
import { ConfirmDepositButton } from '@/components/requests/confirm-deposit-button'

export function DepositRequestActions({ requestId, status, payload }: { requestId: string; status: string; payload: DepositEmailPayload | null }) {
  if (status !== 'WAITING_DEPOSIT') return null

  return <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="font-semibold text-zinc-950">Anticipo</h2>{payload ? <><p className="mt-3 text-sm text-zinc-600">Monto fijo: <strong className="text-zinc-900">{formatDepositAmount(payload.deposit.amount)} MXN</strong></p><div className="mt-5 flex flex-wrap gap-3"><a href={getDepositWhatsAppUrl(payload)} target="_blank" rel="noreferrer" className="rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1ebe5b]">Enviar por WhatsApp</a><form action={confirmDepositFromHelloPx.bind(null, requestId)}><ConfirmDepositButton /></form></div></> : <p className="mt-3 text-sm leading-6 text-zinc-600">El monto de anticipo o su configuración todavía no está disponible. Revisa esta solicitud antes de enviar instrucciones de pago.</p>}</section>
}
