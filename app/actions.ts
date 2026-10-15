'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getCurrentUser, requireRole } from '@/lib/auth'
import { createDoctorUnavailability, deleteDoctorUnavailability, updateDoctorUnavailability, type UnavailabilityMutationResult } from '@/lib/unavailability/doctor-unavailability'
import type { AppointmentConflict } from '@/lib/appointments/appointments'
import { cancelAppointment, createManualAppointment, findManualAppointmentPhone, searchManualAppointmentPatients, updateAppointment, type AppointmentInput, type ManualAppointmentPatientOption } from '@/lib/appointments/appointments'
import {
  replaceDoctorRecurringUnavailability,
  replaceDoctorSchedule,
  type DoctorSchedule,
} from '@/lib/schedule/doctor-schedule'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createManualAppointmentRequest, createAppointmentRequestForExistingContact, createAppointmentRequestForNewPatient, lookupContactByPhone, type ExistingContactLookup, type RequestIntakeAnswer } from '@/lib/requests/appointment-requests'
import { normalizePhoneToE164 } from '@/lib/phone/normalize-phone'
import { startAppointmentConfirmationCall } from '@/lib/retell/appointment-confirmation'
import { getAppointmentConfirmationEmailPayload, getAppointmentConfirmationReminderUrl } from '@/lib/confirmations/appointment-confirmations'

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export type InviteDoctorState = {
  error?: string
  success?: string
}

function isExistingAuthUserError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('already registered') || normalized.includes('already exists') || normalized.includes('email_exists') || normalized.includes('duplicate')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

async function sendDoctorInvitationEmail(email: string, displayName: string, actionLink: string) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) throw new Error('Falta configurar RESEND_API_KEY o RESEND_FROM_EMAIL.')
  const safeName = escapeHtml(displayName)
  const safeLink = escapeHtml(actionLink)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'Tu invitación a HelloPx', html: `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#171717;line-height:1.6"><h1>Invitación a HelloPx</h1><p>Hola, ${safeName}.</p><p>Haz clic en el siguiente enlace para establecer tu contraseña y completar tu configuración:</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#171717;color:#fff;text-decoration:none">Establecer contraseña</a></p><p>Este enlace es personal y puede expirar.</p></body></html>` }),
    cache: 'no-store',
  })
  const body: unknown = await response.json().catch(() => null)
  const responseRecord = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  if (!response.ok || typeof responseRecord.id !== 'string') throw new Error(typeof responseRecord.message === 'string' ? responseRecord.message : `Resend respondió HTTP ${response.status}.`)
}

async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error('No se pudo verificar la cuenta de Auth.')
  return data.users.find((user) => user.email?.trim().toLowerCase() === email) ?? null
}

const allowedInviteTimezones = [
  'America/Tijuana',
  'America/Hermosillo',
  'America/Mazatlan',
  'America/Chihuahua',
  'America/Monterrey',
  'America/Mexico_City',
  'America/Cancun',
] as const

export async function inviteDoctor(
  _previousState: InviteDoctorState,
  formData: FormData,
): Promise<InviteDoctorState> {
  await requireRole('MASTER')

  const displayName = String(formData.get('display_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const phone = String(formData.get('phone') ?? '').trim()
  const sameAsWhatsapp = formData.get('same_as_whatsapp') === 'true'
  const whatsapp = sameAsWhatsapp ? phone : String(formData.get('whatsapp') ?? '').trim()
  const timezone = String(formData.get('timezone') ?? '').trim()

  if (!displayName) return { error: 'Escribe el nombre del doctor.' }
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Escribe un correo válido.' }
  if (!phone) return { error: 'Escribe el teléfono del doctor.' }
  if (!whatsapp) return { error: 'Escribe el WhatsApp del doctor.' }
  if (!allowedInviteTimezones.includes(timezone as (typeof allowedInviteTimezones)[number])) return { error: 'Selecciona una zona horaria válida.' }

  const appUrl = process.env.APP_URL
  if (!appUrl) return { error: 'La configuración de invitaciones no está disponible.' }

  const redirectTo = new URL('/auth/invite', appUrl).toString()
  const admin = createAdminClient()
  let doctorId: string | null = null
  let authUserId: string | null = null
  let authCreated = false

  try {
    const { data: doctor, error: doctorError } = await admin
      .from('doctors')
      .insert({ display_name: displayName, phone, whatsapp, timezone, onboarding_completed: false })
      .select('id')
      .single()

    if (doctorError || !doctor) return { error: 'No se pudo crear el doctor. Inténtalo de nuevo.' }
    doctorId = doctor.id

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (inviteError || !inviteData.user) {
      await admin.from('doctors').delete().eq('id', doctorId)
      if (inviteError && isExistingAuthUserError(inviteError.message)) {
        return { error: 'Ya existe una cuenta asociada a este correo.' }
      }
      return { error: 'No se pudo enviar la invitación. Inténtalo de nuevo.' }
    }
    authUserId = inviteData.user.id
    authCreated = true

    const { error: profileError } = await admin.from('users').insert({
      id: authUserId,
      doctor_id: doctorId,
      role: 'DOCTOR',
      full_name: displayName,
    })

    if (profileError) {
      if (authCreated) await admin.auth.admin.deleteUser(authUserId)
      await admin.from('doctors').delete().eq('id', doctorId)
      return { error: 'No se pudo completar la invitación. Inténtalo de nuevo.' }
    }

    revalidatePath('/master/doctors')
    return { success: 'Invitación enviada.' }
  } catch {
    if (authUserId && authCreated) await admin.auth.admin.deleteUser(authUserId)
    if (doctorId) await admin.from('doctors').delete().eq('id', doctorId)
    return { error: 'No se pudo completar la invitación. Inténtalo de nuevo.' }
  }
}

export async function resendDoctorInvitation(
  _previousState: InviteDoctorState,
  formData: FormData,
): Promise<InviteDoctorState> {
  await requireRole('MASTER')
  const doctorId = String(formData.get('doctor_id') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!doctorId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(doctorId)) return { error: 'El doctor no es válido.' }
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Escribe un correo válido.' }

  const appUrl = process.env.APP_URL
  if (!appUrl) return { error: 'La configuración de invitaciones no está disponible.' }
  const redirectTo = new URL('/auth/invite', appUrl).toString()
  const admin = createAdminClient()
  let authUserId: string | null = null
  let authCreated = false
  let profileCreated = false

  try {
    const { data: doctor, error: doctorError } = await admin.from('doctors').select('id, display_name, status, onboarding_completed').eq('id', doctorId).maybeSingle()
    if (doctorError || !doctor) return { error: 'No se encontró el doctor.' }
    if (doctor.status !== 'ACTIVE') return { error: 'Sólo se pueden invitar doctores activos.' }
    if (doctor.onboarding_completed) return { error: 'Este doctor ya completó su onboarding.' }

    const { data: linkedUsers, error: linkedUsersError } = await admin.from('users').select('id, doctor_id, role').eq('doctor_id', doctorId)
    if (linkedUsersError) return { error: 'No se pudo verificar el vínculo del doctor.' }
    if (linkedUsers?.some((user) => user.role !== 'DOCTOR')) return { error: 'El doctor tiene un vínculo de usuario inválido.' }

    const authUser = await findAuthUserByEmail(admin, email)
    const linkedUser = linkedUsers?.[0] ?? null
    if (linkedUser && linkedUser.id !== authUser?.id) return { error: 'Este doctor ya está vinculado a otro correo. Verifica el correo antes de reenviar.' }

    if (authUser) {
      authUserId = authUser.id
      const { data: authLinks, error: authLinksError } = await admin.from('users').select('id, doctor_id, role').eq('id', authUser.id)
      if (authLinksError) return { error: 'No se pudo verificar el vínculo de la cuenta.' }
      if (authLinks?.some((user) => user.doctor_id !== doctorId)) return { error: 'Este correo ya está asociado a otro doctor.' }

      if (!linkedUser) {
        const { error: profileError } = await admin.from('users').insert({ id: authUser.id, doctor_id: doctorId, role: 'DOCTOR', full_name: doctor.display_name })
        if (profileError) {
          const { data: existingProfile } = await admin.from('users').select('doctor_id, role').eq('id', authUser.id).maybeSingle()
          if (!existingProfile || existingProfile.doctor_id !== doctorId || existingProfile.role !== 'DOCTOR') return { error: 'No se pudo completar el vínculo del doctor sin modificar cuentas existentes.' }
        } else {
          profileCreated = true
        }
      }

      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
      const hashedToken = linkData?.properties?.hashed_token
      if (linkError || !hashedToken) return { error: 'No se pudo generar una nueva invitación para esta cuenta.' }
      const confirmationUrl = new URL('/auth/confirm', appUrl)
      confirmationUrl.searchParams.set('token_hash', hashedToken)
      confirmationUrl.searchParams.set('type', 'recovery')
      confirmationUrl.searchParams.set('next', '/auth/invite')
      await sendDoctorInvitationEmail(email, doctor.display_name, confirmationUrl.toString())
      revalidatePath('/master/doctors')
      return { success: 'Invitación reenviada.' }
    }

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (inviteError || !inviteData.user) return { error: isExistingAuthUserError(inviteError?.message ?? '') ? 'Este correo ya tiene una cuenta de Auth; verifica el vínculo antes de reenviar.' : 'No se pudo enviar la invitación. Inténtalo de nuevo.' }
    authUserId = inviteData.user.id
    authCreated = true
    const { error: profileError } = await admin.from('users').insert({ id: authUserId, doctor_id: doctorId, role: 'DOCTOR', full_name: doctor.display_name })
    if (profileError) return { error: 'No se pudo completar la invitación del doctor.' }
    profileCreated = true
    revalidatePath('/master/doctors')
    return { success: 'Invitación enviada.' }
  } catch (error) {
    if (profileCreated && authUserId) await admin.from('users').delete().eq('id', authUserId).eq('doctor_id', doctorId)
    if (authUserId && authCreated) await admin.auth.admin.deleteUser(authUserId)
    console.error('[Doctor invitation] Failed.', error)
    return { error: 'No se pudo completar el envío o provisioning de la invitación.' }
  }
}

export type InvitePasswordState = {
  error?: string
}

export type AcceptInvitationState = {
  error?: string
}

export async function acceptInvitation(
  _previousState: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const tokenHash = String(formData.get('token_hash') ?? '').trim()
  const type = String(formData.get('type') ?? '')
  if (!tokenHash || (type !== 'invite' && type !== 'recovery')) {
    return { error: 'Esta invitación ya no es válida. Solicita una nueva invitación.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) return { error: 'Esta invitación ya no es válida. Solicita una nueva invitación.' }

  redirect('/auth/invite')
}

export async function setInvitePassword(
  _previousState: InvitePasswordState,
  formData: FormData,
): Promise<InvitePasswordState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) {
    return { error: 'Esta invitación ya no está disponible.' }
  }

  const password = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('password_confirmation') ?? '')

  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (password !== confirmation) return { error: 'Las contraseñas no coinciden.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: 'No se pudo crear la contraseña. Inténtalo de nuevo.' }

  redirect('/onboarding')
}

export type CompleteOnboardingState = {
  error?: string
}

export async function completeDoctorOnboarding(): Promise<CompleteOnboardingState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) {
    return { error: 'No se pudo completar la configuración del doctor.' }
  }

  if (user.onboarding_completed) return {}

  const supabase = await createClient()
  const { error } = await supabase.rpc('complete_doctor_onboarding')
  if (error) return { error: 'No se pudo completar la configuración. Inténtalo de nuevo.' }

  revalidatePath('/onboarding')
  revalidatePath('/app/agenda')
  revalidatePath('/')
  return {}
}

export type UpdateDoctorState = {
  error?: string
  success?: string
}

export async function updateDoctorProfile(
  formData: FormData,
): Promise<UpdateDoctorState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) {
    return { error: 'No se pudo guardar la información del doctor.' }
  }

  const displayName = String(formData.get('p_display_name') ?? '').trim()
  const specialty = String(formData.get('p_specialty') ?? '').trim()
  const address = String(formData.get('p_address') ?? '').trim()
  if (!displayName) return { error: 'El nombre del doctor es obligatorio.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_doctor_profile', {
    p_display_name: displayName,
    p_specialty: specialty || null,
    p_address: address || null,
  })

  if (error) return { error: 'No se pudo guardar la información del doctor.' }

  revalidatePath('/onboarding')
  revalidatePath('/app/assistant')
  return { success: 'Información del doctor guardada.' }
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

export type SaveDoctorScheduleState = {
  error?: string
  success?: string
}

function validateSchedule(value: unknown, label = 'horario', allowOverlaps = false, allowDuplicateDays = false): DoctorSchedule {
  if (!Array.isArray(value)) throw new Error(`La configuración del ${label} no es válida.`)

  const seenDays = new Set<number>()
  const exactRanges = new Set<string>()
  const schedule: DoctorSchedule = []
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

  for (const day of value) {
    if (!day || typeof day !== 'object' || !('weekday' in day) || !('ranges' in day)) {
      throw new Error(`La configuración del ${label} no es válida.`)
    }

    const weekday = day.weekday
    const ranges = day.ranges
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || (!allowDuplicateDays && seenDays.has(weekday)) || !Array.isArray(ranges)) {
      throw new Error(`Cada día debe tener una configuración válida para ${label}.`)
    }
    seenDays.add(weekday)

    const parsedRanges = ranges.map((range: unknown) => {
      if (!range || typeof range !== 'object' || !('start' in range) || !('end' in range) || typeof range.start !== 'string' || typeof range.end !== 'string' || !timePattern.test(range.start) || !timePattern.test(range.end) || range.start >= range.end) {
        throw new Error(`Cada rango de ${label} debe tener horas válidas y no cruzar medianoche.`)
      }
      return { start: range.start, end: range.end }
    })

    for (const range of parsedRanges) {
      const key = `${weekday}-${range.start}-${range.end}`
      if (exactRanges.has(key)) throw new Error(`No se permiten rangos duplicados en ${label}.`)
      exactRanges.add(key)
    }

    if (!allowOverlaps) {
      const sortedRanges = [...parsedRanges].sort((a, b) => a.start.localeCompare(b.start))
      for (let index = 1; index < sortedRanges.length; index += 1) {
        if (sortedRanges[index - 1].end > sortedRanges[index].start) {
          throw new Error('Los horarios del mismo día no pueden solaparse.')
        }
      }
    }

    if (parsedRanges.length) schedule.push({ weekday, ranges: parsedRanges })
  }

  return schedule.sort((a, b) => a.weekday - b.weekday)
}

export async function saveDoctorScheduleSettings(
  _previousState: SaveDoctorScheduleState,
  formData: FormData,
): Promise<SaveDoctorScheduleState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) {
    return { error: 'No tienes permiso para modificar horarios.' }
  }
  const doctorId = String(formData.get('doctor_id') ?? '')
  const rawSchedule = String(formData.get('schedule') ?? '')
  const rawRecurring = String(formData.get('recurring_unavailability') ?? '[]')

  try {
    if (!doctorId || !rawSchedule) throw new Error('El horario es obligatorio.')
    const schedule = validateSchedule(JSON.parse(rawSchedule))
    const recurringInput: unknown = JSON.parse(rawRecurring)
    const recurringSchedule = validateSchedule(recurringInput, 'indisponibilidad recurrente', true, true)
      .map((day, index) => {
        const rawDay = Array.isArray(recurringInput) ? recurringInput[index] : null
        const note = rawDay && typeof rawDay === 'object' && 'internalNote' in rawDay && typeof rawDay.internalNote === 'string'
          ? rawDay.internalNote.trim()
          : ''
        return { ...day, internalNote: note || null }
      })
    await replaceDoctorSchedule(user, doctorId, schedule)
    await replaceDoctorRecurringUnavailability(user, doctorId, recurringSchedule)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudo guardar el horario.' }
  }

  revalidatePath('/app/assistant')
  revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Horarios guardados correctamente.' }
}

export type UnavailabilityActionState = { error?: string; success?: string; appointments?: AppointmentConflict[] }

function unavailabilityConflict(result: UnavailabilityMutationResult): UnavailabilityActionState | null {
  return result.ok ? null : { error: 'Hay citas agendadas dentro de este periodo.', appointments: result.appointments }
}

export async function createDoctorUnavailabilityAction(
  _previousState: UnavailabilityActionState,
  formData: FormData,
): Promise<UnavailabilityActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para modificar la agenda.' }
  try {
    const result = await createDoctorUnavailability(user, String(formData.get('doctor_id') ?? ''), {
      mode: String(formData.get('mode') ?? '') as 'HOURS' | 'DAYS',
      dateFrom: String(formData.get('date_from') ?? ''),
      dateTo: String(formData.get('date_to') ?? ''),
      start: String(formData.get('start') ?? ''),
      end: String(formData.get('end') ?? ''),
      internalNote: String(formData.get('internal_note') ?? ''),
    })
    const conflict = unavailabilityConflict(result)
    if (conflict) return conflict
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudo guardar la indisponibilidad.' }
  }
  revalidatePath('/app/agenda')
  revalidatePath(`/master/doctors/${String(formData.get('doctor_id') ?? '')}/agenda`)
  return { success: 'Indisponibilidad guardada.' }
}

export async function deleteDoctorUnavailabilityAction(formData: FormData) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) throw new Error('No tienes permiso para modificar la agenda.')
  const doctorId = String(formData.get('doctor_id') ?? '')
  await deleteDoctorUnavailability(user, doctorId, String(formData.get('id') ?? ''))
  revalidatePath('/app/agenda')
  revalidatePath(`/master/doctors/${doctorId}/agenda`)
}

export async function updateDoctorUnavailabilityAction(formData: FormData): Promise<UnavailabilityActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para modificar la agenda.' }
  const doctorId = String(formData.get('doctor_id') ?? '')
  try {
    const result = await updateDoctorUnavailability(user, doctorId, {
      id: String(formData.get('id') ?? ''),
      mode: String(formData.get('mode') ?? '') as 'HOURS' | 'DAYS',
      dateFrom: String(formData.get('date_from') ?? ''),
      dateTo: String(formData.get('date_to') ?? ''),
      start: String(formData.get('start') ?? ''),
      end: String(formData.get('end') ?? ''),
      internalNote: String(formData.get('internal_note') ?? ''),
    })
    const conflict = unavailabilityConflict(result)
    if (conflict) return conflict
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudo actualizar la indisponibilidad.' }
  }
  revalidatePath('/app/agenda')
  revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Indisponibilidad actualizada.' }
}

export type AppointmentActionState = { error?: string; success?: string }

function appointmentInput(formData: FormData): AppointmentInput {
  return {
    patientName: String(formData.get('patient_name') ?? ''),
    date: String(formData.get('date') ?? ''),
    start: String(formData.get('start') ?? ''),
    end: String(formData.get('end') ?? ''),
  }
}

export async function createAppointmentAction(_previousState: AppointmentActionState, formData: FormData): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para modificar la agenda.' }
  const doctorId = String(formData.get('doctor_id') ?? '')
  const wantsConfirmation = String(formData.get('manual_confirmation_requested') ?? '') === 'true'
  const manualCreationKey = String(formData.get('manual_creation_key') ?? '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manualCreationKey)) return { error: 'No se pudo validar la creación. Cierra y vuelve a abrir el formulario.' }
  try {
    const input = appointmentInput(formData)
    if (!wantsConfirmation) {
      await createManualAppointment(user, doctorId, input, { requested: false }, manualCreationKey)
    } else {
      const phoneE164 = normalizePhoneToE164(String(formData.get('phone_e164') ?? ''))
      const patientMode = String(formData.get('patient_mode') ?? '')
      const phoneOwner = String(formData.get('phone_owner') ?? '')
      const relationship = String(formData.get('relationship') ?? '')
      const contactName = String(formData.get('contact_name') ?? '').trim()
      if (patientMode === 'EXISTING') {
        const patientId = String(formData.get('patient_id') ?? '')
        if (!patientId) throw new Error('Selecciona un paciente existente.')
        const phoneMatch = await findManualAppointmentPhone(user.role === 'DOCTOR' ? user.doctor_id! : doctorId, phoneE164)
        const relationExists = phoneMatch?.relations.some((relation) => relation.patient_id === patientId) ?? false
        if (phoneMatch && !relationExists && !relationship) throw new Error('Indica la relación del contacto existente con el paciente.')
        let resolvedPhoneOwner: 'PATIENT' | 'OTHER' | undefined
        if (!phoneMatch) {
          if (phoneOwner !== 'PATIENT' && phoneOwner !== 'OTHER') throw new Error('Indica a quién pertenece el teléfono.')
          if (phoneOwner === 'OTHER' && (!contactName || !relationship || relationship === 'SELF')) throw new Error('Indica el nombre y la relación del contacto.')
          resolvedPhoneOwner = phoneOwner
        }
        await createManualAppointment(user, doctorId, input, { requested: true, patientMode, patientId, phoneE164, ...(resolvedPhoneOwner ? { phoneOwner: resolvedPhoneOwner } : {}), ...(contactName ? { contactName } : {}), ...(relationship ? { relationship } : {}) }, manualCreationKey)
      } else if (patientMode === 'NEW') {
        if (!input.patientName.trim()) throw new Error('Escribe el nombre del paciente.')
        const phoneMatch = await findManualAppointmentPhone(user.role === 'DOCTOR' ? user.doctor_id! : doctorId, phoneE164)
        if (phoneMatch && !relationship) throw new Error('Indica la relación del contacto existente con el paciente.')
        if (!phoneMatch && phoneOwner !== 'PATIENT' && phoneOwner !== 'OTHER') throw new Error('Indica a quién pertenece el teléfono.')
        if (!phoneMatch && phoneOwner === 'OTHER' && (!contactName || !relationship || relationship === 'SELF')) throw new Error('Indica el nombre y la relación del contacto.')
        const resolvedPhoneOwner: 'PATIENT' | 'OTHER' | undefined = phoneMatch ? undefined : phoneOwner as 'PATIENT' | 'OTHER'
        await createManualAppointment(user, doctorId, input, { requested: true, patientMode, patientName: input.patientName, phoneE164, ...(resolvedPhoneOwner ? { phoneOwner: resolvedPhoneOwner } : {}), ...(contactName ? { contactName } : {}), ...(relationship ? { relationship } : {}) }, manualCreationKey)
      } else {
        throw new Error('Elige si quieres usar un paciente nuevo o existente.')
      }
    }
  }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo crear la cita.' } }
  revalidatePath('/app/agenda'); revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Cita creada.' }
}

export type ManualAppointmentLookupState = { error?: string; patients?: ManualAppointmentPatientOption[]; phone?: Awaited<ReturnType<typeof findManualAppointmentPhone>> }

async function authorizedAgendaDoctor(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, requestedDoctorId: string) {
  const doctorId = user.role === 'DOCTOR' ? user.doctor_id : requestedDoctorId.trim()
  if (!doctorId) throw new Error('No tienes permiso para consultar esta agenda.')
  if (user.role === 'DOCTOR' && requestedDoctorId && requestedDoctorId !== doctorId) throw new Error('No puedes consultar pacientes de otro doctor.')
  const supabase = await createClient()
  const { data, error } = await supabase.from('doctors').select('id').eq('id', doctorId).maybeSingle()
  if (error || !data) throw new Error('El doctor seleccionado no existe.')
  return doctorId
}

export async function searchManualAppointmentPatientsAction(doctorId: string, query: string): Promise<ManualAppointmentLookupState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para buscar pacientes.' }
  if (query.trim().length < 2) return { patients: [] }
  try { return { patients: await searchManualAppointmentPatients(await authorizedAgendaDoctor(user, doctorId), query) } }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudieron buscar pacientes.' } }
}

export async function lookupManualAppointmentPhoneAction(doctorId: string, inputPhone: string): Promise<ManualAppointmentLookupState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para buscar contactos.' }
  try {
    const targetDoctorId = await authorizedAgendaDoctor(user, doctorId)
    return { phone: await findManualAppointmentPhone(targetDoctorId, normalizePhoneToE164(inputPhone)) }
  } catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo buscar el teléfono.' } }
}

export async function updateAppointmentAction(_previousState: AppointmentActionState, formData: FormData): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para modificar la agenda.' }
  try { await updateAppointment(user, String(formData.get('doctor_id') ?? ''), String(formData.get('id') ?? ''), appointmentInput(formData)) }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo reprogramar la cita.' } }
  const doctorId = String(formData.get('doctor_id') ?? '')
  revalidatePath('/app/agenda'); revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Cita reprogramada.' }
}

export async function cancelAppointmentAction(formData: FormData): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para modificar la agenda.' }
  const doctorId = String(formData.get('doctor_id') ?? '')
  try { await cancelAppointment(user, doctorId, String(formData.get('id') ?? '')) }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo cancelar la cita.' } }
  revalidatePath('/app/agenda'); revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Cita cancelada.' }
}

export async function startAppointmentConfirmationAction(appointmentId: string, selectedDoctorId: string): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) return { error: 'No tienes permiso para iniciar una confirmación.' }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(appointmentId)) return { error: 'La cita no es válida.' }
  const targetDoctorId = user.role === 'DOCTOR' ? user.doctor_id : selectedDoctorId?.trim()
  if (!targetDoctorId) return { error: 'No tienes permiso para iniciar una confirmación.' }

  const supabase = await createClient()
  const { data: doctor, error: doctorError } = await supabase
    .from('doctors')
    .select('id')
    .eq('id', targetDoctorId)
    .maybeSingle()
  if (doctorError) return { error: 'No se pudo validar el doctor seleccionado.' }
  if (!doctor) return { error: 'El doctor seleccionado no existe.' }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .select('id, manual_confirmation_requested')
    .eq('id', appointmentId)
    .eq('doctor_id', doctor.id)
    .maybeSingle()
  if (appointmentError) return { error: 'No se pudo validar la cita seleccionada.' }
  if (!appointment) return { error: 'La cita no corresponde al doctor seleccionado.' }
  if (appointment.manual_confirmation_requested === false) return { error: 'Esta cita no tiene confirmación telefónica activada.' }

  try {
    const result = await startAppointmentConfirmationCall(appointmentId)
    if (!result.ok) {
      if (result.code === 'CONTACT_PHONE_NOT_FOUND') return { error: 'Esta cita no tiene un teléfono de contacto para confirmar.' }
      if (result.code === 'APPOINTMENT_CANCELLED') return { error: 'La cita ya está cancelada.' }
      return { error: 'No fue posible iniciar la llamada de confirmación.' }
    }
    revalidatePath('/app/agenda')
    revalidatePath(`/master/doctors/${doctor.id}/agenda`)
    return { success: result.idempotent ? 'Ya hay una confirmación en curso.' : 'Llamada de confirmación iniciada.' }
  } catch {
    return { error: 'No fue posible iniciar la llamada de confirmación.' }
  }
}

export async function openAppointmentConfirmationReminderAction(appointmentId: string): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para enviar este recordatorio.' }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(appointmentId)) return { error: 'La cita no es válida.' }

  const supabase = await createClient()
  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, confirmation_status')
    .eq('id', appointmentId)
    .eq('doctor_id', user.doctor_id)
    .maybeSingle()

  if (error || !appointment || appointment.confirmation_status !== 'REMINDER_PENDING') {
    return { error: 'Este recordatorio ya no está disponible.' }
  }

  const payload = await getAppointmentConfirmationEmailPayload(appointmentId)
  if (!payload || payload.appointment.confirmation_status !== 'REMINDER_PENDING') {
    return { error: 'Este recordatorio ya no está disponible.' }
  }

  redirect(getAppointmentConfirmationReminderUrl(payload.action.id))
}

export type AppointmentRequestActionState = { error?: string; success?: string; requestId?: string }

function requestIntakeAnswers(formData: FormData): RequestIntakeAnswer[] {
  const raw = String(formData.get('intake_answers') ?? '[]')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Las respuestas de intake no son válidas.') }
  if (!Array.isArray(parsed)) throw new Error('Las respuestas de intake no son válidas.')
  return parsed.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Las respuestas de intake no son válidas.')
    const answer = item as Record<string, unknown>
    const fieldKey = typeof answer.field_key === 'string' ? answer.field_key.trim() : ''
    const fieldLabel = typeof answer.field_label === 'string' ? answer.field_label.trim() : ''
    const value = typeof answer.value === 'string' ? answer.value.trim() : null
    const required = answer.required === true
    if (!fieldKey || !fieldLabel || (required && !value)) throw new Error(`Completa el campo "${fieldLabel || fieldKey}".`)
    return { intake_field_id: typeof answer.intake_field_id === 'string' ? answer.intake_field_id : null, field_key: fieldKey, field_label: fieldLabel, value }
  })
}

export type ContactLookupActionState = { error?: string; contact?: ExistingContactLookup | null }

export async function lookupContactByPhoneAction(formData: FormData): Promise<ContactLookupActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para buscar contactos.' }
  try {
    const phoneE164 = normalizePhoneToE164(String(formData.get('phone_e164') ?? ''))
    const contact = await lookupContactByPhone(user.doctor_id, phoneE164)
    return { contact }
  } catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo buscar el teléfono.' } }
}

export async function createManualAppointmentRequestAction(_previousState: AppointmentRequestActionState, formData: FormData): Promise<AppointmentRequestActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para crear solicitudes.' }
  const doctorId = user.doctor_id
  try {
    const phoneE164 = normalizePhoneToE164(String(formData.get('phone_e164') ?? ''))
    const result = await createManualAppointmentRequest({ doctorId, patientName: String(formData.get('patient_name') ?? ''), contactName: String(formData.get('contact_name') ?? ''), relationship: String(formData.get('relationship') ?? '') as 'SELF' | 'MOTHER' | 'FATHER' | 'CHILD' | 'PARTNER' | 'RELATIVE' | 'OTHER', phoneE164, appointmentTypeId: String(formData.get('appointment_type_id') ?? '').trim() || undefined, intakeAnswers: requestIntakeAnswers(formData) })
    revalidatePath('/app/requests')
    return { success: 'Solicitud creada.', requestId: result.requestId }
  } catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo crear la solicitud.' } }
}

export async function createExistingContactAppointmentRequestAction(_previousState: AppointmentRequestActionState, formData: FormData): Promise<AppointmentRequestActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para crear solicitudes.' }
  try {
    const result = await createAppointmentRequestForExistingContact({ patientId: String(formData.get('patient_id') ?? ''), contactId: String(formData.get('contact_id') ?? ''), phoneId: String(formData.get('phone_id') ?? ''), intakeAnswers: requestIntakeAnswers(formData) })
    revalidatePath('/app/requests')
    return { success: 'Solicitud creada.', requestId: result.requestId }
  } catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo crear la solicitud.' } }
}

export async function createExistingContactNewPatientRequestAction(_previousState: AppointmentRequestActionState, formData: FormData): Promise<AppointmentRequestActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para crear solicitudes.' }
  try {
    const result = await createAppointmentRequestForNewPatient({ patientName: String(formData.get('patient_name') ?? ''), contactId: String(formData.get('contact_id') ?? ''), phoneId: String(formData.get('phone_id') ?? ''), relationship: String(formData.get('relationship') ?? '') as 'SELF' | 'MOTHER' | 'FATHER' | 'CHILD' | 'PARTNER' | 'RELATIVE' | 'OTHER', intakeAnswers: requestIntakeAnswers(formData) })
    revalidatePath('/app/requests')
    return { success: 'Solicitud creada.', requestId: result.requestId }
  } catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo crear la solicitud.' } }
}
