import { notFound } from 'next/navigation'

import { AgendaView } from '@/components/agenda/agenda-view'
import { resolveMasterAgendaContext } from '@/lib/agenda/context'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type MasterAgendaPageProps = {
  params: Promise<{ doctorId: string }>
}

export default async function MasterAgendaPage({ params }: MasterAgendaPageProps) {
  await requireRole('MASTER')
  const { doctorId } = await params
  const supabase = await createClient()
  const { data: doctor, error } = await supabase
    .from('doctors')
    .select('id, display_name, timezone')
    .eq('id', doctorId)
    .maybeSingle()

  if (error || !doctor) notFound()

  const context = resolveMasterAgendaContext(doctor.id, doctor.timezone)

  return <AgendaView context={context} doctorName={doctor.display_name} />
}
