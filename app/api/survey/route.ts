import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateAnswers } from '@/lib/survey/questions'

const cookieName = 'hellopx_survey'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  return origin === new URL(request.url).origin
}

async function session(request: NextRequest) {
  const raw = request.cookies.get(cookieName)?.value
  const match = raw?.match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/)
  if (!match) return null
  const admin = createAdminClient()
  const { data, error } = await admin.from('commercial_survey_responses')
    .select('*').eq('id', match[1]).maybeSingle()
  if (error || !data) return null
  const expected = Buffer.from(data.session_token_hash, 'hex')
  const actual = Buffer.from(hash(match[2]), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? data : null
}

export async function GET(request: NextRequest) {
  const row = await session(request)
  if (!row) return NextResponse.json({ state: 'new' })
  return NextResponse.json({
    state: row.status, wants_demo: row.wants_demo,
    commercial_interest: row.commercial_interest, demo_call_clicked: !!row.demo_call_clicked_at,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail('Solicitud no permitida.', 403)
  if (Number(request.headers.get('content-length') || 0) > 12000) return fail('Solicitud demasiado grande.', 413)
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 12000) return fail('Solicitud demasiado grande.', 413)
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Datos inválidos.')
    body = parsed
  } catch { return fail('Datos inválidos.') }

  const admin = createAdminClient()
  const action = body.action
  if (action === 'start') {
    const token = typeof body.start_token === 'string' && /^[0-9a-f]{64}$/.test(body.start_token) ? body.start_token : null
    if (!token) return fail('No se pudo validar el inicio. Intenta de nuevo.')
    const tokenHash = hash(token)
    const existing = await session(request)
    if (existing) return NextResponse.json({ state: existing.status })
    const { data: prior, error: priorError } = await admin.from('commercial_survey_responses')
      .select('id, status').eq('session_token_hash', tokenHash).maybeSingle()
    if (priorError) return fail('No pudimos validar el inicio. Intenta de nuevo.', 503)
    if (prior) {
      const response = NextResponse.json({ state: prior.status })
      response.cookies.set(cookieName, `${prior.id}.${token}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/survey', maxAge: 60 * 60 * 24 * 30 })
      return response
    }
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const ipHash = hash(`${process.env.SUPABASE_SERVICE_ROLE_KEY}:${ip}`)
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await admin.from('commercial_survey_responses')
      .select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('started_at', since)
    if (countError) return fail('No pudimos iniciar la encuesta. Intenta más tarde.', 503)
    if ((count ?? 0) >= 20) return fail('Has iniciado demasiadas encuestas. Intenta más tarde.', 429)
    const id = randomUUID()
    const { error } = await admin.from('commercial_survey_responses').insert({ id, session_token_hash: tokenHash, ip_hash: ipHash })
    if (error) {
      // A simultaneous retry can win the unique-token insert after this request's lookup.
      const { data: raced } = await admin.from('commercial_survey_responses')
        .select('id, status').eq('session_token_hash', tokenHash).maybeSingle()
      if (!raced) return fail('No pudimos iniciar la encuesta. Intenta de nuevo.', 503)
      const response = NextResponse.json({ state: raced.status })
      response.cookies.set(cookieName, `${raced.id}.${token}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/survey', maxAge: 60 * 60 * 24 * 30 })
      return response
    }
    const response = NextResponse.json({ state: 'started' })
    response.cookies.set(cookieName, `${id}.${token}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/survey', maxAge: 60 * 60 * 24 * 30 })
    return response
  }

  const row = await session(request)
  if (!row) return fail('Tu sesión venció. Recarga la encuesta para comenzar de nuevo.', 401)
  if (action === 'complete') {
    if (row.status === 'completed') return NextResponse.json({ state: 'completed' })
    const answers = validateAnswers(body.answers)
    if (!answers) return fail('Revisa que todas las respuestas estén completas.')
    const { error } = await admin.from('commercial_survey_responses').update({ ...answers, status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'started')
    if (error) return fail('No pudimos guardar tus respuestas. Intenta de nuevo.', 503)
    return NextResponse.json({ state: 'completed' })
  }
  if (row.status !== 'completed') return fail('Termina primero las siete preguntas.')
  if (action === 'demo') {
    if (typeof body.wants_demo !== 'boolean' || row.wants_demo !== null) return fail('Decisión inválida.')
    const { error } = await admin.from('commercial_survey_responses').update({ wants_demo: body.wants_demo }).eq('id', row.id).is('wants_demo', null)
    if (error) return fail('No pudimos guardar tu decisión.', 503)
    return NextResponse.json({ ok: true })
  }
  if (action === 'call') {
    if (row.wants_demo !== true) return fail('Primero confirma que quieres conocer HelloPx.')
    const { error } = await admin.from('commercial_survey_responses').update({ demo_call_clicked_at: row.demo_call_clicked_at || new Date().toISOString() }).eq('id', row.id)
    if (error) return fail('No pudimos registrar el clic.', 503)
    return NextResponse.json({ ok: true })
  }
  if (action === 'interest') {
    if (row.commercial_interest !== null || row.wants_demo === null) return fail('Decisión inválida.')
    const interest = body.interest
    if (!['personalized_demo', 'information', 'none'].includes(String(interest))) return fail('Selecciona una opción.')
    let contact: Record<string, string | null> = { contact_name: null, contact_method: null, contact_value: null, contact_consent_at: null }
    if (interest !== 'none') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const method = body.method
      const value = typeof body.value === 'string' ? body.value.trim() : ''
      if (name.length < 2 || name.length > 120 || !['email', 'phone', 'whatsapp'].includes(String(method)) ||
        value.length < 5 || value.length > 160 || body.consent !== true ||
        (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ||
        (method !== 'email' && !/^\+?[0-9\s()-]{8,25}$/.test(value))) return fail('Completa tus datos y acepta el seguimiento.')
      contact = { contact_name: name, contact_method: String(method), contact_value: value, contact_consent_at: new Date().toISOString() }
    }
    const { error } = await admin.from('commercial_survey_responses').update({ commercial_interest: interest, ...contact })
      .eq('id', row.id).is('commercial_interest', null)
    if (error) return fail('No pudimos guardar tu respuesta. Intenta de nuevo.', 503)
    return NextResponse.json({ ok: true })
  }
  return fail('Acción inválida.')
}
