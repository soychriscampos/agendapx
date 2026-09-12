import { createClient } from '@/lib/supabase/server'
import { normalizePhoneToE164 } from '@/lib/phone/normalize-phone'

export const PATIENT_CONTACT_RELATIONSHIPS = ['SELF', 'MOTHER', 'FATHER', 'CHILD', 'PARTNER', 'RELATIVE', 'OTHER'] as const
export type PatientContactRelationship = (typeof PATIENT_CONTACT_RELATIONSHIPS)[number]
export type RequestStatus = 'NEW' | 'WAITING_DEPOSIT' | 'DEPOSIT_CONFIRMED' | 'WAITING_SCHEDULING' | 'CONFIRMED' | 'CANCELLED'

export type AppointmentRequestListItem = {
  id: string
  patientName: string
  contactName: string
  relationship: PatientContactRelationship
  phone: string
  appointmentTypeName: string | null
  status: RequestStatus
  createdAt: string
}

export type AppointmentRequestDetail = AppointmentRequestListItem & {
  answers: Array<{ id: string; fieldKey: string; fieldLabel: string; value: string | null }>
}

export type ManualRequestInput = {
  doctorId: string
  patientName: string
  contactName: string
  relationship: PatientContactRelationship
  phoneE164: string
  appointmentTypeId?: string
  intakeAnswers: RequestIntakeAnswer[]
}

export type RequestIntakeAnswer = {
  intake_field_id: string | null
  field_key: string
  field_label: string
  value: string | null
}

export type ExistingContactLookup = {
  contactPhoneId: string
  contactId: string
  contactName: string
  patients: Array<{ id: string; fullName: string; relationship: PatientContactRelationship }>
}

function assertRelationship(value: string): asserts value is PatientContactRelationship {
  if (!PATIENT_CONTACT_RELATIONSHIPS.includes(value as PatientContactRelationship)) throw new Error('La relación con el paciente no es válida.')
}

export async function lookupContactByPhone(doctorId: string, phoneE164: string): Promise<ExistingContactLookup | null> {
  const normalizedPhone = normalizePhoneToE164(phoneE164)
  const supabase = await createClient()
  const { data: phone, error: phoneError } = await supabase.from('contact_phones').select('id, contact_id').eq('doctor_id', doctorId).eq('phone_e164', normalizedPhone).maybeSingle()
  if (phoneError) throw new Error('No se pudo buscar el teléfono.')
  if (!phone) return null

  const [contactQuery, relationsQuery] = await Promise.all([
    supabase.from('contacts').select('id, full_name').eq('id', phone.contact_id).eq('doctor_id', doctorId).maybeSingle(),
    supabase.from('patient_contacts').select('patient_id, relationship').eq('contact_id', phone.contact_id).eq('doctor_id', doctorId),
  ])
  if (contactQuery.error || relationsQuery.error || !contactQuery.data) throw new Error('No se pudo cargar el contacto encontrado.')
  const patientIds = (relationsQuery.data ?? []).map((relation) => relation.patient_id)
  const patientsQuery = patientIds.length ? await supabase.from('patients').select('id, full_name').eq('doctor_id', doctorId).in('id', patientIds) : { data: [], error: null }
  if (patientsQuery.error) throw new Error('No se pudieron cargar los pacientes relacionados.')
  const patientMap = new Map((patientsQuery.data ?? []).map((patient) => [patient.id, patient.full_name]))
  return {
    contactPhoneId: phone.id,
    contactId: phone.contact_id,
    contactName: contactQuery.data.full_name,
    patients: (relationsQuery.data ?? []).flatMap((relation) => {
      const fullName = patientMap.get(relation.patient_id)
      return fullName ? [{ id: relation.patient_id, fullName, relationship: relation.relationship as PatientContactRelationship }] : []
    }),
  }
}

export async function listAppointmentRequests(doctorId: string): Promise<AppointmentRequestListItem[]> {
  const supabase = await createClient()
  const { data: rows, error } = await supabase.from('appointment_requests').select('id, patient_id, origin_contact_id, origin_contact_phone_id, appointment_type_id, status, created_at').eq('doctor_id', doctorId).order('created_at', { ascending: false })
  if (error) throw new Error('No se pudieron cargar las solicitudes.')
  if (!rows?.length) return []

  const patientIds = [...new Set(rows.map((row) => row.patient_id))]
  const contactIds = [...new Set(rows.map((row) => row.origin_contact_id))]
  const phoneIds = [...new Set(rows.map((row) => row.origin_contact_phone_id))]
  const typeIds = [...new Set(rows.flatMap((row) => row.appointment_type_id ? [row.appointment_type_id] : []))]
  const [patients, contacts, phones, relations, types] = await Promise.all([
    supabase.from('patients').select('id, full_name').eq('doctor_id', doctorId).in('id', patientIds),
    supabase.from('contacts').select('id, full_name').eq('doctor_id', doctorId).in('id', contactIds),
    supabase.from('contact_phones').select('id, phone_e164').eq('doctor_id', doctorId).in('id', phoneIds),
    supabase.from('patient_contacts').select('patient_id, contact_id, relationship').eq('doctor_id', doctorId).in('patient_id', patientIds).in('contact_id', contactIds),
    typeIds.length ? supabase.from('appointment_types').select('id, name').eq('doctor_id', doctorId).in('id', typeIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (patients.error || contacts.error || phones.error || relations.error || types.error) throw new Error('No se pudo cargar toda la información de las solicitudes.')
  const patientMap = new Map((patients.data ?? []).map((item) => [item.id, item.full_name]))
  const contactMap = new Map((contacts.data ?? []).map((item) => [item.id, item.full_name]))
  const phoneMap = new Map((phones.data ?? []).map((item) => [item.id, item.phone_e164]))
  const relationMap = new Map((relations.data ?? []).map((item) => [`${item.patient_id}:${item.contact_id}`, item.relationship as PatientContactRelationship]))
  const typeMap = new Map((types.data ?? []).map((item) => [item.id, item.name]))
  return rows.map((row) => ({ id: row.id, patientName: patientMap.get(row.patient_id) ?? 'Paciente no disponible', contactName: contactMap.get(row.origin_contact_id) ?? 'Contacto no disponible', relationship: relationMap.get(`${row.patient_id}:${row.origin_contact_id}`) ?? 'OTHER', phone: phoneMap.get(row.origin_contact_phone_id) ?? 'Teléfono no disponible', appointmentTypeName: row.appointment_type_id ? typeMap.get(row.appointment_type_id) ?? null : null, status: row.status as RequestStatus, createdAt: row.created_at }))
}

export async function getAppointmentRequest(doctorId: string, requestId: string): Promise<AppointmentRequestDetail | null> {
  const supabase = await createClient()
  const { data: row, error } = await supabase.from('appointment_requests').select('id, patient_id, origin_contact_id, origin_contact_phone_id, appointment_type_id, status, created_at').eq('id', requestId).eq('doctor_id', doctorId).maybeSingle()
  if (error) throw new Error('No se pudo cargar la solicitud.')
  if (!row) return null
  const [patient, contact, phone, relation, type, answers] = await Promise.all([
    supabase.from('patients').select('full_name').eq('id', row.patient_id).eq('doctor_id', doctorId).maybeSingle(),
    supabase.from('contacts').select('full_name').eq('id', row.origin_contact_id).eq('doctor_id', doctorId).maybeSingle(),
    supabase.from('contact_phones').select('phone_e164').eq('id', row.origin_contact_phone_id).eq('doctor_id', doctorId).maybeSingle(),
    supabase.from('patient_contacts').select('relationship').eq('doctor_id', doctorId).eq('patient_id', row.patient_id).eq('contact_id', row.origin_contact_id).maybeSingle(),
    row.appointment_type_id ? supabase.from('appointment_types').select('name').eq('id', row.appointment_type_id).eq('doctor_id', doctorId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('appointment_request_intake_answers').select('id, field_key, field_label, value').eq('request_id', requestId).eq('doctor_id', doctorId).order('created_at'),
  ])
  if (patient.error || contact.error || phone.error || relation.error || type.error || answers.error) throw new Error('No se pudo cargar el detalle completo de la solicitud.')
  return { id: row.id, patientName: patient.data?.full_name ?? 'Paciente no disponible', contactName: contact.data?.full_name ?? 'Contacto no disponible', relationship: (relation.data?.relationship as PatientContactRelationship | undefined) ?? 'OTHER', phone: phone.data?.phone_e164 ?? 'Teléfono no disponible', appointmentTypeName: type.data?.name ?? null, status: row.status as RequestStatus, createdAt: row.created_at, answers: (answers.data ?? []).map((answer) => ({ id: answer.id, fieldKey: answer.field_key, fieldLabel: answer.field_label, value: answer.value })) }
}

export async function createPatient(doctorId: string, fullName: string) {
  const supabase = await createClient(); const { data, error } = await supabase.from('patients').insert({ doctor_id: doctorId, full_name: fullName.trim() }).select('id').single()
  if (error || !data) throw new Error('No se pudo crear el paciente.'); return data.id as string
}

export async function createContact(doctorId: string, fullName: string) {
  const supabase = await createClient(); const { data, error } = await supabase.from('contacts').insert({ doctor_id: doctorId, full_name: fullName.trim() }).select('id').single()
  if (error || !data) throw new Error('No se pudo crear el contacto.'); return data.id as string
}

export async function createContactPhone(doctorId: string, contactId: string, phoneE164: string) {
  const normalizedPhone = normalizePhoneToE164(phoneE164); const supabase = await createClient(); const { data, error } = await supabase.from('contact_phones').insert({ doctor_id: doctorId, contact_id: contactId, phone_e164: normalizedPhone }).select('id').single()
  if (error || !data) throw new Error('No se pudo guardar el teléfono del contacto.'); return data.id as string
}

export async function createPatientContact(doctorId: string, patientId: string, contactId: string, relationship: PatientContactRelationship) {
  assertRelationship(relationship); const supabase = await createClient(); const { error } = await supabase.from('patient_contacts').insert({ doctor_id: doctorId, patient_id: patientId, contact_id: contactId, relationship })
  if (error) throw new Error('No se pudo relacionar el contacto con el paciente.')
}

export async function createAppointmentRequest(input: { doctorId: string; patientId: string; contactId: string; phoneId: string; appointmentTypeId?: string }) {
  const supabase = await createClient(); const { data, error } = await supabase.from('appointment_requests').insert({ doctor_id: input.doctorId, patient_id: input.patientId, origin_contact_id: input.contactId, origin_contact_phone_id: input.phoneId, appointment_type_id: input.appointmentTypeId || null, status: 'NEW' }).select('id').single()
  if (error || !data) throw new Error('No se pudo crear la solicitud.'); return data.id as string
}

export async function createAppointmentRequestForExistingContact(input: { patientId: string; contactId: string; phoneId: string; intakeAnswers: RequestIntakeAnswer[] }) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_appointment_request_for_existing_contact', {
    p_patient_id: input.patientId,
    p_contact_id: input.contactId,
    p_origin_contact_phone_id: input.phoneId,
    p_appointment_type_id: null,
    p_status: 'NEW',
    p_intake_answers: input.intakeAnswers,
    p_doctor_id: null,
  })
  if (error) throw new Error(`No se pudo crear la solicitud: ${error.message}`)
  if (!data) throw new Error('No se pudo crear la solicitud: la RPC no devolvió un id.')
  return { requestId: data as string }
}

export async function createAppointmentRequestForNewPatient(input: { patientName: string; contactId: string; phoneId: string; relationship: PatientContactRelationship; intakeAnswers: RequestIntakeAnswer[] }) {
  if (!input.patientName.trim()) throw new Error('Escribe el nombre del nuevo paciente.')
  assertRelationship(input.relationship)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_appointment_request_for_new_patient', {
    p_patient_name: input.patientName.trim(),
    p_contact_id: input.contactId,
    p_origin_contact_phone_id: input.phoneId,
    p_relationship: input.relationship,
    p_appointment_type_id: null,
    p_status: 'NEW',
    p_intake_answers: input.intakeAnswers,
    p_doctor_id: null,
  })
  if (error) throw new Error(`No se pudo crear la solicitud: ${error.message}`)
  if (!data) throw new Error('No se pudo crear la solicitud: la RPC no devolvió un id.')
  return { requestId: data as string }
}

export async function saveRequestIntakeAnswers(doctorId: string, requestId: string, answers: Array<{ intakeFieldId?: string; fieldKey: string; fieldLabel: string; value: string | null }>) {
  if (!answers.length) return
  const supabase = await createClient(); const { error } = await supabase.from('appointment_request_intake_answers').upsert(answers.map((answer) => ({ doctor_id: doctorId, request_id: requestId, intake_field_id: answer.intakeFieldId || null, field_key: answer.fieldKey, field_label: answer.fieldLabel, value: answer.value })), { onConflict: 'request_id,field_key' })
  if (error) throw new Error('No se pudieron guardar las respuestas de intake.')
}

export async function createManualAppointmentRequest(input: ManualRequestInput) {
  if (!input.patientName.trim() || !input.contactName.trim()) throw new Error('Escribe el nombre del paciente y del contacto.')
  const normalizedPhone = normalizePhoneToE164(input.phoneE164); assertRelationship(input.relationship)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_appointment_request', {
    p_patient_name: input.patientName.trim(),
    p_contact_name: input.contactName.trim(),
    p_phone_e164: normalizedPhone,
    p_relationship: input.relationship,
    p_appointment_type_id: input.appointmentTypeId || null,
    p_status: 'NEW',
    p_intake_answers: input.intakeAnswers,
    p_doctor_id: null,
  })
  if (error) throw new Error(`No se pudo crear la solicitud: ${error.message}`)
  if (!data) throw new Error('No se pudo crear la solicitud: la RPC no devolvió un id.')
  return { requestId: data as string }
}
