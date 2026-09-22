'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getCurrentUser, requireRole } from '@/lib/auth'
import { createDoctorUnavailability, deleteDoctorUnavailability, updateDoctorUnavailability, type UnavailabilityMutationResult } from '@/lib/unavailability/doctor-unavailability'
import type { AppointmentConflict } from '@/lib/appointments/appointments'
import { cancelAppointment, createAppointment, updateAppointment, type AppointmentInput } from '@/lib/appointments/appointments'
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
    return { error: 'Tu cuenta aún no tiene un perfil de HelloPx habilitado.' }
  }

  if (profile.role === 'MASTER') redirect('/master/doctors')
  if (profile.role === 'DOCTOR' && profile.doctor_id) {
    const { data: doctor, error: doctorError } = await supabase
      .from('doctors')
      .select('onboarding_completed')
      .eq('id', profile.doctor_id)
      .maybeSingle()

    if (doctorError || !doctor) {
      await supabase.auth.signOut()
      return { error: 'El perfil de tu cuenta no tiene una configuración válida.' }
    }

    redirect(doctor.onboarding_completed ? '/app/agenda' : '/onboarding')
  }

  await supabase.auth.signOut()
  return { error: 'El perfil de tu cuenta no tiene una configuración válida.' }
}

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

    const { error: profileError } = await admin.from('users').insert({
      id: authUserId,
      doctor_id: doctorId,
      role: 'DOCTOR',
      full_name: displayName,
    })

    if (profileError) {
      await admin.auth.admin.deleteUser(authUserId)
      await admin.from('doctors').delete().eq('id', doctorId)
      return { error: 'No se pudo completar la invitación. Inténtalo de nuevo.' }
    }

    revalidatePath('/master/doctors')
    return { success: 'Invitación enviada.' }
  } catch {
    if (authUserId) await admin.auth.admin.deleteUser(authUserId)
    if (doctorId) await admin.from('doctors').delete().eq('id', doctorId)
    return { error: 'No se pudo completar la invitación. Inténtalo de nuevo.' }
  }
}

export type InvitePasswordState = {
  error?: string
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
  try { await createAppointment(user, String(formData.get('doctor_id') ?? ''), appointmentInput(formData)) }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudo crear la cita.' } }
  const doctorId = String(formData.get('doctor_id') ?? '')
  revalidatePath('/app/agenda'); revalidatePath(`/master/doctors/${doctorId}/agenda`)
  return { success: 'Cita creada.' }
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

export async function startAppointmentConfirmationAction(appointmentId: string): Promise<AppointmentActionState> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) return { error: 'No tienes permiso para iniciar una confirmación.' }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(appointmentId)) return { error: 'La cita no es válida.' }
  try {
    const result = await startAppointmentConfirmationCall(appointmentId)
    if (!result.ok) {
      if (result.code === 'CONTACT_PHONE_NOT_FOUND') return { error: 'Esta cita no tiene un teléfono de contacto para confirmar.' }
      if (result.code === 'APPOINTMENT_CANCELLED') return { error: 'La cita ya está cancelada.' }
      return { error: 'No fue posible iniciar la llamada de confirmación.' }
    }
    revalidatePath('/app/agenda')
    return { success: result.idempotent ? 'Ya hay una confirmación en curso.' : 'Llamada de confirmación iniciada.' }
  } catch {
    return { error: 'No fue posible iniciar la llamada de confirmación.' }
  }
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
