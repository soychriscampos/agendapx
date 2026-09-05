import { AgendaView } from '@/components/agenda/agenda-view'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { requireRole } from '@/lib/auth'

export default async function AgendaPage() {
  const user = await requireRole('DOCTOR')
  const context = await resolveDoctorAgendaContext(user)

  return <AgendaView context={context} />
}
