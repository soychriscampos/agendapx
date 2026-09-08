import { AgendaView } from '@/components/agenda/agenda-view'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { requireRole } from '@/lib/auth'
import { listDoctorUnavailability } from '@/lib/unavailability/doctor-unavailability'
import { listAppointments } from '@/lib/appointments/appointments'

export default async function AgendaPage() {
  const user = await requireRole('DOCTOR')
  const context = await resolveDoctorAgendaContext(user)
  const [unavailability, appointments] = await Promise.all([listDoctorUnavailability(context.doctorId), listAppointments(context.doctorId)])

  return <AgendaView context={context} unavailability={unavailability} appointments={appointments} />
}
