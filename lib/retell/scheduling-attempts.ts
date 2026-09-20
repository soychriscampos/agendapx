import { createAdminClient } from '@/lib/supabase/admin'

/** Read only the active-state signal needed by the server-rendered request detail. */
export async function hasActiveSchedulingCall(doctorId: string, requestId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scheduling_call_attempts')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('request_id', requestId)
    .in('status', ['CREATING', 'DISPATCHED'])
    .maybeSingle()

  if (error) throw new Error('No se pudo cargar el estado de la llamada de agenda.')
  return Boolean(data)
}
