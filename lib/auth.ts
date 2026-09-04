import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export type UserRole = 'MASTER' | 'DOCTOR'

export type AgendaUser = {
  id: string
  doctor_id: string | null
  role: UserRole
  full_name: string
}

export async function getCurrentUser(): Promise<AgendaUser | null> {
  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()

  if (claimsError || !claimsData?.claims?.sub) return null

  const { data, error } = await supabase
    .from('users')
    .select('id, doctor_id, role, full_name')
    .eq('id', claimsData.claims.sub)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    doctor_id: data.doctor_id,
    role: data.role as UserRole,
    full_name: data.full_name,
  }
}

export async function requireRole(role: UserRole): Promise<AgendaUser> {
  const user = await getCurrentUser()

  if (!user) redirect('/login?error=profile')
  if (user.role !== role) redirect(user.role === 'MASTER' ? '/master/doctors' : '/app/agenda')
  if (user.role === 'DOCTOR' && !user.doctor_id) redirect('/login?error=profile')

  return user
}

export async function redirectAuthenticatedUser() {
  const user = await getCurrentUser()

  if (user?.role === 'MASTER') redirect('/master/doctors')
  if (user?.role === 'DOCTOR' && user.doctor_id) redirect('/app/agenda')
}
