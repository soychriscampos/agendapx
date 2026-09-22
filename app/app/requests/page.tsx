import Link from 'next/link'

import { RequestCreateForm } from '@/components/requests/request-create-form'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { requireRole } from '@/lib/auth'
import { listAppointmentRequests } from '@/lib/requests/appointment-requests'
import { createClient } from '@/lib/supabase/server'

function formatDate(value: string, timezone: string) { return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
const statusLabels: Record<string, string> = { NEW: 'Nueva', WAITING_DEPOSIT: 'Esperando anticipo', DEPOSIT_CONFIRMED: 'Anticipo confirmado', WAITING_SCHEDULING: 'Esperando agenda', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada' }

export default async function RequestsPage() {
  const user = await requireRole('DOCTOR')
  const context = await resolveDoctorAgendaContext(user)
  const supabase = await createClient()
  const [requests, typesQuery, intakeQuery] = await Promise.all([
    listAppointmentRequests(context.doctorId),
    supabase.from('appointment_types').select('id, name').eq('doctor_id', context.doctorId).eq('is_active', true).order('created_at'),
    supabase.from('assistant_intake_fields').select('id, field_key, label, is_required, sort_order').eq('doctor_id', context.doctorId).eq('is_active', true).order('sort_order').order('id'),
  ])
  if (typesQuery.error || intakeQuery.error) throw new Error('No se pudieron cargar los datos de la solicitud.')
  const intakeFields = (intakeQuery.data ?? []).filter((field) => field.field_key !== 'patient_name' && field.field_key !== 'phone')

  return <section className="max-w-6xl space-y-8"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx · DOCTOR</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Solicitudes</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">Consulta las solicitudes recientes y revisa la información de cada paciente.</p></div><Link href="#nueva-solicitud" className="rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700">Nueva solicitud de prueba</Link></header><div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"><div className="border-b border-zinc-200 px-4 py-4 sm:px-5"><h2 className="font-semibold text-zinc-950">Solicitudes recientes</h2></div>{!requests.length ? <p className="px-4 py-8 text-sm text-zinc-500 sm:px-5">Todavía no hay solicitudes. Crea una para verla aquí.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-4 py-3 font-medium sm:px-5">Paciente</th><th className="px-4 py-3 font-medium sm:px-5">Solicitado por</th><th className="px-4 py-3 font-medium sm:px-5">Teléfono</th><th className="px-4 py-3 font-medium sm:px-5">Tipo de cita</th><th className="px-4 py-3 font-medium sm:px-5">Estado</th><th className="px-4 py-3 font-medium sm:px-5">Creada</th></tr></thead><tbody className="divide-y divide-zinc-100">{requests.map((request) => <tr key={request.id} className="hover:bg-zinc-50"><td className="px-4 py-4 sm:px-5"><Link href={`/app/requests/${request.id}`} className="font-medium text-zinc-950 underline-offset-4 hover:underline">{request.patientName}</Link></td><td className="px-4 py-4 sm:px-5"><p className="text-zinc-800">{request.contactName}</p><p className="mt-1 text-xs text-zinc-500">{request.relationship}</p></td><td className="px-4 py-4 font-mono text-xs text-zinc-600 sm:px-5">{request.phone}</td><td className="px-4 py-4 text-zinc-600 sm:px-5">{request.appointmentTypeName ?? 'Sin definir'}</td><td className="px-4 py-4 sm:px-5"><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">{statusLabels[request.status] ?? request.status}</span></td><td className="whitespace-nowrap px-4 py-4 text-zinc-500 sm:px-5">{formatDate(request.createdAt, context.timezone)}</td></tr>)}</tbody></table></div>}</div><RequestCreateForm appointmentTypes={typesQuery.data ?? []} intakeFields={intakeFields} /></section>
}
