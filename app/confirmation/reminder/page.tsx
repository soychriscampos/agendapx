import { startConfirmationReminderPublicAction } from '@/app/confirmation/actions'
import { getAppointmentConfirmationReminderActionState, getAppointmentConfirmationReminderWhatsAppUrl, verifyAppointmentConfirmationReminderSignature } from '@/lib/confirmations/appointment-confirmations'
import { isUuid } from '@/lib/deposits/phase9'

function Status({ title, message }: { title: string; message: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p><h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">{title}</h1><p className="mt-3 text-base leading-7 text-zinc-600">{message}</p></section></main>
}

export default async function ConfirmationReminderPage({ searchParams }: { searchParams: Promise<{ action?: string; signature?: string; error?: string }> }) {
  const params = await searchParams
  if (params.error === 'confirmed') return <Status title="Asistencia confirmada" message="El paciente ya confirmó su asistencia a esta cita." />
  if (params.error === 'cancelled') return <Status title="Cita cancelada" message="Esta cita ya no requiere un recordatorio." />
  if (params.error || !params.action || !params.signature || !isUuid(params.action) || !verifyAppointmentConfirmationReminderSignature(params.action, params.signature)) return <Status title="Este enlace no es válido." message="Solicita al consultorio que revise la cita desde HelloPx." />
  const state = await getAppointmentConfirmationReminderActionState(params.action).catch(() => null)
  if (!state || state.ok !== true) return <Status title="Este recordatorio ya no está disponible." message="La cita pudo haber cambiado o el enlace ya no es válido." />
  if (state.appointment_status === 'CANCELLED') return <Status title="Cita cancelada" message="Esta cita ya no requiere un recordatorio." />
  if (state.confirmation_status === 'CONFIRMED') return <Status title="Asistencia confirmada" message="El paciente ya confirmó su asistencia a esta cita." />
  if (state.action_consumed === true || state.confirmation_status === 'REMINDER_STARTED') {
    const whatsappUrl = typeof state.appointment_id === 'string'
      ? await getAppointmentConfirmationReminderWhatsAppUrl(state.appointment_id).catch(() => null)
      : null
    if (!whatsappUrl) return <Status title="Este recordatorio ya no está disponible." message="La cita pudo haber cambiado o el enlace ya no es válido." />
    return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p><h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">Este recordatorio ya fue iniciado</h1><p className="mt-3 text-base leading-7 text-zinc-600">Si el mensaje no se envió correctamente o necesitas intentarlo de nuevo, puedes volver a abrir WhatsApp.</p><a href={whatsappUrl} className="mt-6 block w-full rounded-lg bg-[#25D366] px-4 py-3 text-center text-sm font-medium text-white hover:bg-[#1fba59]">Abrir WhatsApp de nuevo</a></section></main>
  }
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12"><section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p><h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">Enviar recordatorio</h1><p className="mt-3 text-base leading-7 text-zinc-600">Abriremos WhatsApp con un mensaje para confirmar la asistencia a esta cita.</p><form action={startConfirmationReminderPublicAction} className="mt-6"><input type="hidden" name="action" value={params.action} /><input type="hidden" name="signature" value={params.signature} /><button type="submit" className="w-full rounded-lg bg-[#25D366] px-4 py-3 text-sm font-medium text-white hover:bg-[#1fba59]">Enviar recordatorio por WhatsApp</button></form></section></main>
}
