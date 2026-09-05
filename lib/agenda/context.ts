import type { AgendaUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type AgendaContext = {
  doctorId: string
  actorRole: 'MASTER' | 'DOCTOR'
  timezone: string
}

export async function resolveDoctorAgendaContext(user: AgendaUser): Promise<AgendaContext> {
  if (user.role !== 'DOCTOR' || !user.doctor_id) {
    throw new Error('El usuario no tiene un contexto de doctor válido.')
  }

  const supabase = await createClient()
  const { data: doctor, error } = await supabase
    .from('doctors')
    .select('id, timezone')
    .eq('id', user.doctor_id)
    .maybeSingle()

  if (error || !doctor) {
    throw new Error('No se pudo cargar la configuración del doctor.')
  }

  return {
    doctorId: doctor.id,
    actorRole: 'DOCTOR',
    timezone: doctor.timezone,
  }
}

export function resolveMasterAgendaContext(doctorId: string, timezone: string): AgendaContext {
  return {
    doctorId,
    actorRole: 'MASTER',
    timezone,
  }
}
