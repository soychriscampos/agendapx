import { type NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedDestination } from '@/lib/auth-destination'
import { createClient } from '@/lib/supabase/server'

const responseHeaders = { 'Cache-Control': 'no-store' }
const genericError = 'No se pudo iniciar sesión. Inténtalo de nuevo.'

function jsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: responseHeaders })
}

function isAllowedOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  const allowedOrigins = new Set([request.nextUrl.origin])
  const appUrl = process.env.APP_URL

  if (appUrl) {
    try {
      allowedOrigins.add(new URL(appUrl).origin)
    } catch {
      // A malformed optional APP_URL must not weaken the request-origin check.
    }
  }

  return allowedOrigins.has(origin)
}

function loginError(error: string, status = 400) {
  return jsonResponse({ status: 'error', error }, status)
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) return loginError(genericError, 403)

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return loginError(genericError, 415)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return loginError(genericError)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return loginError('Escribe tu correo y contraseña.')
  }

  const record = body as Record<string, unknown>
  const email = typeof record.email === 'string' ? record.email.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''

  if (!email || !password) return loginError('Escribe tu correo y contraseña.')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return loginError('El correo o la contraseña no son correctos.', 401)
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, doctor_id')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    await supabase.auth.signOut()
    return loginError('Tu cuenta aún no tiene un perfil de HelloPx habilitado.', 403)
  }

  if (profile.role === 'MASTER') {
    const destination = resolveAuthenticatedDestination({
      role: 'MASTER',
      doctor_id: profile.doctor_id,
      onboarding_completed: null,
    })

    if (destination) return jsonResponse({ status: 'success', destination }, 200)
  }

  if (profile.role === 'DOCTOR' && profile.doctor_id) {
    const { data: doctor, error: doctorError } = await supabase
      .from('doctors')
      .select('onboarding_completed')
      .eq('id', profile.doctor_id)
      .maybeSingle()

    if (doctorError || !doctor) {
      await supabase.auth.signOut()
      return loginError('El perfil de tu cuenta no tiene una configuración válida.', 403)
    }

    const destination = resolveAuthenticatedDestination({
      role: 'DOCTOR',
      doctor_id: profile.doctor_id,
      onboarding_completed: doctor.onboarding_completed,
    })

    if (destination) return jsonResponse({ status: 'success', destination }, 200)
  }

  await supabase.auth.signOut()
  return loginError('El perfil de tu cuenta no tiene una configuración válida.', 403)
}
