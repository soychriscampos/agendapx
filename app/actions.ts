'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/auth'
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

export type UpdateDoctorState = {
  error?: string
  success?: string
}

export async function updateDoctor(
  _previousState: UpdateDoctorState,
  formData: FormData,
): Promise<UpdateDoctorState> {
  await requireRole('MASTER')

  const doctorId = String(formData.get('doctor_id') ?? '')
  const displayName = String(formData.get('display_name') ?? '').trim()
  const status = String(formData.get('status') ?? '')
  const timezone = String(formData.get('timezone') ?? '').trim()

  if (!doctorId || !displayName) return { error: 'El nombre es obligatorio.' }
  if (status !== 'ACTIVE' && status !== 'INACTIVE') return { error: 'El estado no es válido.' }
  if (!timezone) return { error: 'La zona horaria es obligatoria.' }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  } catch {
    return { error: 'La zona horaria no es válida.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('doctors')
    .update({
      display_name: displayName,
      phone: String(formData.get('phone') ?? '').trim() || null,
      whatsapp: String(formData.get('whatsapp') ?? '').trim() || null,
      status,
      timezone,
      retell_agent_id: String(formData.get('retell_agent_id') ?? '').trim() || null,
      twilio_phone_number: String(formData.get('twilio_phone_number') ?? '').trim() || null,
    })
    .eq('id', doctorId)

  if (error) return { error: 'No se pudo guardar el doctor. Inténtalo de nuevo.' }

  revalidatePath('/master/doctors')
  return { success: 'Cambios guardados.' }
}
