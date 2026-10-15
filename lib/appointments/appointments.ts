import type { AgendaUser } from '@/lib/auth'
import { getDateTimeInTimezone, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { createClient } from '@/lib/supabase/server'

export type AppointmentConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REMINDER_PENDING' | 'REMINDER_STARTED' | 'MANUAL_REQUIRED'
export type Appointment = { id: string; doctorId: string; patientName: string; startAt: string; endAt: string; status: 'CONFIRMED' | 'CANCELLED'; confirmationStatus: AppointmentConfirmationStatus; manualConfirmationRequested: boolean | null; createdSource: 'DOCTOR' | 'MASTER' | 'AGENT'; createdByUserId: string | null }
export type AppointmentInput = { patientName: string; date: string; start: string; end: string }
export type AppointmentConflict = { id: string; patientName: string; startAt: string; endAt: string }
export type ManualAppointmentPatientOption = {
  id: string
  fullName: string
  contacts: Array<{ contactId: string; contactName: string; relationship: string; phones: Array<{ id: string; phoneE164: string }> }>
}

export async function searchManualAppointmentPatients(doctorId: string, query: string): Promise<ManualAppointmentPatientOption[]> {
  const supabase = await createClient()
  const { data: patients, error } = await supabase.from('patients').select('id, full_name').eq('doctor_id', doctorId).ilike('full_name', `%${query.trim()}%`).order('full_name').limit(25)
  if (error) throw new Error('No se pudieron buscar pacientes.')
  const ids = (patients ?? []).map((patient) => patient.id)
  if (!ids.length) return []

  const { data: relations, error: relationsError } = await supabase.from('patient_contacts').select('patient_id, contact_id, relationship').eq('doctor_id', doctorId).in('patient_id', ids)
  if (relationsError) throw new Error('No se pudieron cargar los contactos relacionados.')
  const contactIds = [...new Set((relations ?? []).map((relation) => relation.contact_id))]
  if (!contactIds.length) return (patients ?? []).map((patient) => ({ id: patient.id, fullName: patient.full_name, contacts: [] }))

  const [contactsQuery, phonesQuery] = await Promise.all([
    supabase.from('contacts').select('id, full_name').eq('doctor_id', doctorId).in('id', contactIds),
    supabase.from('contact_phones').select('id, contact_id, phone_e164').eq('doctor_id', doctorId).in('contact_id', contactIds).order('created_at'),
  ])
  if (contactsQuery.error || phonesQuery.error) throw new Error('No se pudieron cargar los teléfonos de contacto.')
  const contactsById = new Map((contactsQuery.data ?? []).map((contact) => [contact.id, contact]))
  const phonesByContact = new Map<string, Array<{ id: string; phoneE164: string }>>()
  for (const phone of phonesQuery.data ?? []) {
    const phones = phonesByContact.get(phone.contact_id) ?? []
    phones.push({ id: phone.id, phoneE164: phone.phone_e164 })
    phonesByContact.set(phone.contact_id, phones)
  }
  return (patients ?? []).map((patient) => ({
    id: patient.id,
    fullName: patient.full_name,
    contacts: (relations ?? []).filter((relation) => relation.patient_id === patient.id).flatMap((relation) => {
      const contact = contactsById.get(relation.contact_id)
      if (!contact) return []
      return [{ contactId: contact.id, contactName: contact.full_name, relationship: relation.relationship, phones: phonesByContact.get(contact.id) ?? [] }]
    }),
  }))
}

export async function findManualAppointmentPhone(doctorId: string, phoneE164: string) {
  const supabase = await createClient()
  const { data: phone, error } = await supabase.from('contact_phones').select('id, contact_id').eq('doctor_id', doctorId).eq('phone_e164', phoneE164).maybeSingle()
  if (error) throw new Error('No se pudo buscar el teléfono.')
  if (!phone) return null
  const [{ data: contact, error: contactError }, { data: relations, error: relationError }] = await Promise.all([
    supabase.from('contacts').select('id, full_name').eq('doctor_id', doctorId).eq('id', phone.contact_id).maybeSingle(),
    supabase.from('patient_contacts').select('patient_id, relationship').eq('doctor_id', doctorId).eq('contact_id', phone.contact_id),
  ])
  if (contactError || relationError || !contact) throw new Error('No se pudo cargar el contacto encontrado.')
  return { phoneId: phone.id, contactId: contact.id, contactName: contact.full_name, relations: relations ?? [] }
}

async function resolveDoctor(actor: AgendaUser, doctorId: string) {
  const targetDoctorId = actor.role === 'DOCTOR' ? actor.doctor_id : doctorId
  if (!targetDoctorId) throw new Error('El usuario no tiene un doctor asociado.')
  if (actor.role === 'DOCTOR' && targetDoctorId !== doctorId) throw new Error('No puedes modificar citas de otro doctor.')
  const supabase = await createClient()
  const { data: doctor, error } = await supabase.from('doctors').select('id, timezone').eq('id', targetDoctorId).maybeSingle()
  if (error || !doctor) throw new Error('El doctor seleccionado no existe.')
  return { doctorId: doctor.id, timezone: doctor.timezone }
}

function interval(input: AppointmentInput, timezone: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date)
  const time = (value?: string) => !!value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!input.patientName.trim() || !date || !time(input.start) || !time(input.end) || input.start >= input.end) throw new Error('Indica nombre, fecha y un horario válido.')
  return { startAt: localDateTimeToUtc(input.date, input.start!, timezone), endAt: localDateTimeToUtc(input.date, input.end!, timezone) }
}

function weekday(date: string) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day }
function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) { return startA < endB && endA > startB }

export async function findConfirmedAppointmentConflicts(doctorId: string, startAt: Date, endAt: Date, excludeAppointmentId?: string): Promise<AppointmentConflict[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('appointments').select('id, patient_name, start_at, end_at').eq('doctor_id', doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudieron revisar las citas existentes.')
  return (data ?? []).filter((item) => item.id !== excludeAppointmentId && overlaps(startAt, endAt, new Date(item.start_at), new Date(item.end_at))).map((item) => ({ id: item.id, patientName: item.patient_name, startAt: item.start_at, endAt: item.end_at }))
}

export async function checkAppointmentConflict(doctorId: string, startAt: Date, endAt: Date, timezone: string, excludeAppointmentId?: string) {
  const conflicts = await findConfirmedAppointmentConflicts(doctorId, startAt, endAt, excludeAppointmentId)
  if (conflicts.length) throw new Error('Ese horario ya tiene una cita confirmada.')

  const supabase = await createClient()
  const { data: blocks, error: blockError } = await supabase.from('doctor_unavailability').select('start_at, end_at').eq('doctor_id', doctorId)
  if (blockError) throw new Error('No se pudo revisar la disponibilidad del doctor.')
  if ((blocks ?? []).some((item) => overlaps(startAt, endAt, new Date(item.start_at), new Date(item.end_at)))) throw new Error('Ese horario está marcado como no disponible.')

  const localStart = getDateTimeInTimezone(timezone, startAt)
  const localEnd = getDateTimeInTimezone(timezone, endAt)
  if (localStart.date !== localEnd.date) throw new Error('La cita debe terminar el mismo día.')
  const { data: recurring, error: recurringError } = await supabase.from('doctor_recurring_unavailability').select('weekday, start_local, end_local').eq('doctor_id', doctorId).eq('weekday', weekday(localStart.date))
  if (recurringError) throw new Error('No se pudo revisar el horario fijo no disponible.')
  if ((recurring ?? []).some((item) => localStart.time < item.end_local.slice(0, 5) && localEnd.time > item.start_local.slice(0, 5))) throw new Error('Ese horario está marcado como no disponible.')

  const { data: schedule, error: scheduleError } = await supabase.from('doctor_schedule_windows').select('start_local, end_local').eq('doctor_id', doctorId).eq('weekday', weekday(localStart.date))
  if (scheduleError) throw new Error('No se pudo revisar el horario habitual.')
  if (!(schedule ?? []).some((item) => localStart.time >= item.start_local.slice(0, 5) && localEnd.time <= item.end_local.slice(0, 5))) throw new Error('La cita debe estar dentro del horario habitual.')
}

export async function listAppointments(doctorId: string): Promise<Appointment[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('appointments').select('id, doctor_id, patient_name, start_at, end_at, status, confirmation_status, manual_confirmation_requested, created_source, created_by_user_id').eq('doctor_id', doctorId).order('start_at')
  if (error) throw new Error('No se pudieron cargar las citas.')
  return (data ?? []).map((item) => ({ id: item.id, doctorId: item.doctor_id, patientName: item.patient_name, startAt: item.start_at, endAt: item.end_at, status: item.status, confirmationStatus: item.confirmation_status as AppointmentConfirmationStatus, manualConfirmationRequested: item.manual_confirmation_requested as boolean | null, createdSource: item.created_source, createdByUserId: item.created_by_user_id }))
}

export type ManualAppointmentConfirmationInput =
  | { requested: false }
  | { requested: true; patientMode: 'NEW'; patientName: string; phoneE164: string; phoneOwner?: 'PATIENT' | 'OTHER'; contactName?: string; relationship?: string }
  | { requested: true; patientMode: 'EXISTING'; patientId: string; phoneE164: string; phoneOwner?: 'PATIENT' | 'OTHER'; contactName?: string; relationship?: string }

export async function createManualAppointment(actor: AgendaUser, doctorId: string, input: AppointmentInput, confirmation: ManualAppointmentConfirmationInput, manualCreationKey: string) {
  const target = await resolveDoctor(actor, doctorId)
  const values = interval(input, target.timezone)
  await checkAppointmentConflict(target.doctorId, values.startAt, values.endAt, target.timezone)
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_manual_appointment', {
    p_manual_creation_key: manualCreationKey,
    p_doctor_id: target.doctorId,
    p_patient_name: input.patientName.trim(),
    p_start_at: values.startAt.toISOString(),
    p_end_at: values.endAt.toISOString(),
    p_manual_confirmation_requested: confirmation.requested,
    p_patient_mode: confirmation.requested ? confirmation.patientMode : null,
    p_patient_id: confirmation.requested && confirmation.patientMode === 'EXISTING' ? confirmation.patientId : null,
    p_phone_e164: confirmation.requested ? confirmation.phoneE164 : null,
    p_phone_owner: confirmation.requested ? confirmation.phoneOwner ?? null : null,
    p_contact_name: confirmation.requested ? confirmation.contactName ?? null : null,
    p_relationship: confirmation.requested ? confirmation.relationship ?? null : null,
  })
  if (error) throw new Error(error.message || 'No se pudo crear la cita.')
}

export async function updateAppointment(actor: AgendaUser, doctorId: string, id: string, input: AppointmentInput) {
  const target = await resolveDoctor(actor, doctorId)
  const values = interval(input, target.timezone)
  await checkAppointmentConflict(target.doctorId, values.startAt, values.endAt, target.timezone, id)
  const supabase = await createClient()
  const { error } = await supabase.from('appointments').update({ patient_name: input.patientName.trim(), start_at: values.startAt.toISOString(), end_at: values.endAt.toISOString() }).eq('id', id).eq('doctor_id', target.doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudo reprogramar la cita.')
}

export async function cancelAppointment(actor: AgendaUser, doctorId: string, id: string) {
  const target = await resolveDoctor(actor, doctorId)
  const supabase = await createClient()
  const { error } = await supabase.from('appointments').update({ status: 'CANCELLED' }).eq('id', id).eq('doctor_id', target.doctorId).eq('status', 'CONFIRMED')
  if (error) throw new Error('No se pudo cancelar la cita.')
}
