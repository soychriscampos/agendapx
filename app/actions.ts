'use server'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export type LoginState = { error?: string }

export async function login(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) return { error: 'Escribe tu correo y contraseña.' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) return { error: 'El correo o la contraseña no son correctos.' }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, doctor_id')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    await supabase.auth.signOut()
    return { error: 'Tu cuenta aún no tiene un perfil de AgendaPX habilitado.' }
  }

  if (profile.role === 'MASTER') redirect('/master/doctors')
  if (profile.role === 'DOCTOR' && profile.doctor_id) redirect('/app/agenda')

  await supabase.auth.signOut()
  return { error: 'El perfil de tu cuenta no tiene una configuración válida.' }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
