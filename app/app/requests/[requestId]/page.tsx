import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { requireRole } from '@/lib/auth'
import { getAppointmentRequest } from '@/lib/requests/appointment-requests'
import { getDepositEmailPayload } from '@/lib/deposits/phase9'
import { DepositRequestActions } from '@/components/requests/deposit-request-actions'
import { RetrySchedulingCall } from '@/components/requests/retry-scheduling-call'
import { SchedulingCallStatus } from '@/components/requests/scheduling-call-status'
import { RequestLiveRefresh } from '@/components/requests/request-live-refresh'
import { getLatestSchedulingCallAttempt, hasActiveSchedulingCall } from '@/lib/retell/scheduling-attempts'

function formatDate(value: string, timezone: string) { return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
const statusLabels: Record<string, string> = { NEW: 'Nueva', WAITING_DEPOSIT: 'Esperando anticipo', DEPOSIT_CONFIRMED: 'Anticipo confirmado', WAITING_SCHEDULING: 'Esperando agenda', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada' }

export default async function RequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const user = await requireRole('DOCTOR'); const context = await resolveDoctorAgendaContext(user); const { requestId } = await params; const request = await getAppointmentRequest(context.doctorId, requestId); if (!request) notFound()
  const fetchedDepositPayload = request.status === 'WAITING_DEPOSIT' ? await getDepositEmailPayload(requestId) : null
  const depositPayload = fetchedDepositPayload?.request.status === 'WAITING_DEPOSIT' ? fetchedDepositPayload : null
  const [latestSchedulingAttempt, activeSchedulingCall] = await Promise.all([
    getLatestSchedulingCallAttempt(context.doctorId, requestId),
    request.status === 'WAITING_SCHEDULING' ? hasActiveSchedulingCall(context.doctorId, requestId) : Promise.resolve(true),
  ])
  const canRetryScheduling = request.status === 'WAITING_SCHEDULING' && !activeSchedulingCall
  const shouldRefreshScheduling = request.status === 'WAITING_SCHEDULING' && (latestSchedulingAttempt?.status === 'CREATING' || latestSchedulingAttempt?.status === 'DISPATCHED')
  return <section className="max-w-3xl space-y-7"><RequestLiveRefresh enabled={shouldRefreshScheduling} /><Link href="/app/requests" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">← Volver a solicitudes</Link><header><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx · SOLICITUD</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Solicitud</h1><p className="mt-2 text-sm text-zinc-500">Creada el {formatDate(request.createdAt, context.timezone)}</p></header><section className="overflow-hidden rounded-xl border border-zinc-200 bg-white"><div className="border-b border-zinc-100 bg-zinc-50/70 px-5 py-4 sm:px-6"><p className="text-xs font-medium text-zinc-500">Estado general</p><p className="mt-1 font-semibold text-zinc-950">{statusLabels[request.status] ?? request.status}</p></div>{latestSchedulingAttempt ? <SchedulingCallStatus attempt={latestSchedulingAttempt} contactName={request.contactName} timezone={context.timezone} /> : null}{canRetryScheduling ? <div className="border-t border-zinc-100 px-5 py-5 sm:px-6"><RetrySchedulingCall requestId={request.id} /></div> : null}</section><section className="rounded-xl border border-zinc-200 bg-white"><div className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-6"><div><h2 className="font-semibold text-zinc-950">Paciente</h2><p className="mt-2 text-sm text-zinc-700">{request.patientName}</p></div><div><h2 className="font-semibold text-zinc-950">Cita</h2><p className="mt-2 text-sm text-zinc-700">{request.appointmentTypeName ?? 'Sin definir'}</p></div></div><div className="border-t border-zinc-100 px-5 py-5 sm:px-6"><h2 className="font-semibold text-zinc-950">Solicitado por</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-zinc-500">Contacto</dt><dd className="mt-1 text-zinc-800">{request.contactName}</dd></div><div><dt className="text-xs text-zinc-500">Relación con el paciente</dt><dd className="mt-1 text-zinc-800">{request.relationship}</dd></div><div><dt className="text-xs text-zinc-500">Teléfono utilizado</dt><dd className="mt-1 font-mono text-xs text-zinc-700">{request.phone}</dd></div></dl></div></section><DepositRequestActions requestId={request.id} status={request.status} payload={depositPayload} /><section className="rounded-xl border border-zinc-200 bg-white px-5 py-5 sm:px-6"><h2 className="font-semibold text-zinc-950">Datos recopilados</h2>{request.answers.length ? <dl className="mt-4 divide-y divide-zinc-100">{request.answers.map((answer) => <div key={answer.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><dt className="text-sm text-zinc-500">{answer.fieldLabel}</dt><dd className="text-sm text-zinc-800">{answer.value || 'Sin respuesta'}</dd></div>)}</dl> : <p className="mt-4 text-sm text-zinc-500">No hay datos adicionales para esta solicitud.</p>}</section></section>
}
