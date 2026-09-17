import { getDateTimeInTimezone } from '@/lib/agenda/timezone'
import { getAvailableSlots } from '@/lib/availability/get-available-slots'
import { normalizePhoneToE164 } from '@/lib/phone/normalize-phone'
import { formatTimeForVoice } from '@/lib/retell/voice-time'
import { createAdminClient } from '@/lib/supabase/admin'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RELATIONSHIPS = new Set(['SELF', 'MOTHER', 'FATHER', 'CHILD', 'PARTNER', 'RELATIVE', 'OTHER'])

type JsonRecord = Record<string, unknown>
type ResolvedDoctor = { id: string; displayName: string; specialty: string | null; timezone: string; address: string | null; phone: string | null; whatsapp: string | null }
type IntakeAnswer = { intake_field_id: string; value: string | null }

export class RetellToolError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly retryable = false) {
    super(message)
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RetellToolError('INVALID_REQUEST', 'El cuerpo de la operación no es válido.')
  return value as JsonRecord
}

function requiredString(body: JsonRecord, key: string, label = key) {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new RetellToolError('INVALID_REQUEST', `El campo ${label} es obligatorio.`)
  return value.trim()
}

function optionalString(body: JsonRecord, key: string) {
  const value = body[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new RetellToolError('INVALID_REQUEST', `El campo ${key} no es válido.`)
  return value.trim() || undefined
}

function requiredUuid(body: JsonRecord, key: string) {
  const value = requiredString(body, key)
  if (!UUID_PATTERN.test(value)) throw new RetellToolError('INVALID_REQUEST', `El campo ${key} no es válido.`)
  return value
}

function optionalUuid(body: JsonRecord, key: string) {
  const value = optionalString(body, key)
  if (value !== undefined && !UUID_PATTERN.test(value)) throw new RetellToolError('INVALID_REQUEST', `El campo ${key} no es válido.`)
  return value
}

function requiredDate(body: JsonRecord, key: string) {
  const value = requiredString(body, key)
  const instant = new Date(`${value}T00:00:00Z`)
  if (!DATE_PATTERN.test(value) || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) throw new RetellToolError('INVALID_REQUEST', `El campo ${key} no es válido.`)
  return value
}

function rejectDoctorId(body: JsonRecord) {
  if (body.doctor_id !== undefined) throw new RetellToolError('INVALID_REQUEST', 'doctor_id no es un parámetro permitido.')
}

function parseIntakeAnswers(value: unknown): IntakeAnswer[] {
  if (!Array.isArray(value)) throw new RetellToolError('INVALID_REQUEST', 'intake_answers debe ser un arreglo.')
  return value.map((item) => {
    const answer = record(item)
    const intakeFieldId = requiredUuid(answer, 'intake_field_id')
    const rawValue = answer.value
    if (rawValue !== null && rawValue !== undefined && typeof rawValue !== 'string') throw new RetellToolError('INVALID_REQUEST', 'El valor de intake no es válido.')
    return { intake_field_id: intakeFieldId, value: rawValue?.trim() || null }
  })
}

function rpcResult(value: unknown): JsonRecord {
  return record(value)
}

function localSlotPresentation(startAt: string, timezone: string) {
  const instant = new Date(startAt)
  const local = getDateTimeInTimezone(timezone, instant)
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return {
    local_date: local.date,
    local_time: local.time,
    label: `${values.weekday} ${values.day} de ${values.month} a las ${formatTimeForVoice(local.time)}`,
  }
}

export async function resolveRetellDoctor(agentId: string, technicalPhoneNumber?: string): Promise<ResolvedDoctor> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('doctors')
    .select('id, display_name, specialty, timezone, address, phone, whatsapp, twilio_phone_number')
    .eq('retell_agent_id', agentId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  if (error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo resolver la configuración del doctor.', 503, true)
  if (!data) throw new RetellToolError('DOCTOR_NOT_AVAILABLE', 'El agente no tiene un doctor activo configurado.', 404)
  if (technicalPhoneNumber && data.twilio_phone_number !== technicalPhoneNumber) throw new RetellToolError('TECHNICAL_PHONE_MISMATCH', 'El número técnico no corresponde al agente.', 403)

  return { id: data.id, displayName: data.display_name, specialty: data.specialty, timezone: data.timezone, address: data.address, phone: data.phone, whatsapp: data.whatsapp }
}

const WEEKDAY_LABELS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

function summarizeOfficeHours(rows: Array<{ weekday: number; start_local: string; end_local: string }>, timezone: string) {
  const grouped = new Map<number, string[]>()
  for (const row of rows) {
    const ranges = grouped.get(row.weekday) ?? []
    ranges.push(`${row.start_local.slice(0, 5)}–${row.end_local.slice(0, 5)}`)
    grouped.set(row.weekday, ranges)
  }
  const summary = Array.from(grouped.entries())
    .sort(([first], [second]) => first - second)
    .map(([weekday, ranges]) => `${WEEKDAY_LABELS[weekday - 1] ?? 'día'} ${ranges.join(', ')}`)
    .join('; ')
  return `Horario local del consultorio (${timezone}): ${summary || 'no configurado.'}`
}

function summarizeAdministrativeInfo(doctor: ResolvedDoctor) {
  const values = [
    doctor.address ? `Dirección: ${doctor.address}` : null,
    doctor.phone ? `Teléfono: ${doctor.phone}` : null,
    doctor.whatsapp ? `WhatsApp: ${doctor.whatsapp}` : null,
  ].filter((value): value is string => value !== null)
  return values.length ? values.join('. ') : 'Información administrativa no configurada.'
}

export async function getRetellInboundContext(agentId: string, technicalPhoneNumber?: string) {
  const doctor = await resolveRetellDoctor(agentId, technicalPhoneNumber)
  const supabase = createAdminClient()
  const [settings, schedule] = await Promise.all([
    supabase.from('assistant_settings').select('assistant_name').eq('doctor_id', doctor.id).maybeSingle(),
    supabase.from('doctor_schedule_windows').select('weekday, start_local, end_local').eq('doctor_id', doctor.id).order('weekday').order('start_local'),
  ])
  if (settings.error || schedule.error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar el contexto inicial.', 503, true)

  return {
    assistant_name: settings.data?.assistant_name ?? 'Asistente del consultorio',
    doctor_name: doctor.displayName,
    specialty: doctor.specialty ?? 'especialidad no configurada',
    timezone: doctor.timezone,
    office_hours_summary: summarizeOfficeHours(schedule.data ?? [], doctor.timezone),
    administrative_summary: summarizeAdministrativeInfo(doctor),
  }
}

async function assertRequestBelongsToDoctor(doctorId: string, requestId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('appointment_requests')
    .select('id, appointment_type_id')
    .eq('id', requestId)
    .eq('doctor_id', doctorId)
    .maybeSingle()

  if (error) {
    console.warn('[Retell] request lookup failed:', requestId, error.code ?? 'UNKNOWN', error.message)
    throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar la solicitud.', 503, true)
  }
  if (!data) throw new RetellToolError('REQUEST_NOT_FOUND', 'La solicitud no corresponde al doctor.', 404)
  return data
}

export async function getRetellContext(input: unknown) {
  const body = record(input)
  rejectDoctorId(body)
  const doctor = await resolveRetellDoctor(requiredString(body, 'agent_id'), optionalString(body, 'phone_number'))
  const supabase = createAdminClient()
  const [settings, appointmentTypes, intakeFields, knowledge] = await Promise.all([
    supabase.from('assistant_settings').select('assistant_name').eq('doctor_id', doctor.id).maybeSingle(),
    supabase.from('appointment_types').select('id, name, duration_minutes, price').eq('doctor_id', doctor.id).eq('is_active', true).order('created_at'),
    supabase.from('assistant_intake_fields').select('id, field_key, label, is_required, sort_order').eq('doctor_id', doctor.id).eq('is_active', true).order('sort_order').order('id'),
    supabase.from('assistant_knowledge_items').select('title, content, sort_order').eq('doctor_id', doctor.id).eq('is_active', true).order('sort_order').order('id'),
  ])
  if (settings.error || appointmentTypes.error || intakeFields.error || knowledge.error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar el contexto autorizado.', 503, true)

  return {
    ok: true,
    assistant_name: settings.data?.assistant_name ?? null,
    doctor_name: doctor.displayName,
    specialty: doctor.specialty,
    timezone: doctor.timezone,
    appointment_types: appointmentTypes.data ?? [],
    intake_fields: intakeFields.data ?? [],
    knowledge: knowledge.data ?? [],
  }
}

export async function prepareRetellBooking(input: unknown) {
  const body = record(input)
  rejectDoctorId(body)
  const doctor = await resolveRetellDoctor(requiredString(body, 'agent_id'), optionalString(body, 'phone_number'))
  const relationship = requiredString(body, 'relationship').toUpperCase()
  if (!RELATIONSHIPS.has(relationship)) throw new RetellToolError('INVALID_REQUEST', 'La relación con el paciente no es válida.')

  let phoneE164: string
  try {
    phoneE164 = normalizePhoneToE164(requiredString(body, 'caller_phone_number'))
  } catch {
    throw new RetellToolError('INVALID_REQUEST', 'El teléfono de quien llama no es válido.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('prepare_booking_from_call', {
    p_doctor_id: doctor.id,
    p_source_external_id: requiredString(body, 'call_id'),
    p_contact_name: requiredString(body, 'contact_name'),
    p_phone_e164: phoneE164,
    p_patient_name: requiredString(body, 'patient_name'),
    p_relationship: relationship,
    p_appointment_type_id: requiredUuid(body, 'appointment_type_id'),
    p_patient_id: optionalUuid(body, 'patient_id') ?? null,
    p_intake_answers: parseIntakeAnswers(body.intake_answers),
  })
  if (error) throw new RetellToolError('PREPARE_BOOKING_FAILED', 'No se pudo preparar la solicitud.', 500)

  const result = rpcResult(data)
  const requiresDeposit = result.requires_deposit === true
  return {
    ok: result.ok === true && !requiresDeposit,
    requires_deposit: requiresDeposit,
    request_id: typeof result.request_id === 'string' ? result.request_id : null,
    patient_id: typeof result.patient_id === 'string' ? result.patient_id : null,
    appointment_type_id: typeof result.appointment_type_id === 'string' ? result.appointment_type_id : null,
    request_status: typeof result.request_status === 'string' ? result.request_status : null,
    idempotent: result.idempotent === true,
    code: typeof result.code === 'string' ? result.code : null,
  }
}

export async function getRetellAvailability(input: unknown) {
  const body = record(input)
  rejectDoctorId(body)
  const doctor = await resolveRetellDoctor(requiredString(body, 'agent_id'), optionalString(body, 'phone_number'))
  const requestId = requiredUuid(body, 'request_id')
  console.warn('[Retell] get_availability request_id:', requestId)
  const request = await assertRequestBelongsToDoctor(doctor.id, requestId)
  if (!request.appointment_type_id) throw new RetellToolError('APPOINTMENT_TYPE_REQUIRED', 'La solicitud no tiene tipo de cita.', 409)

  const supabase = createAdminClient()
  const { data: appointmentType, error } = await supabase
    .from('appointment_types')
    .select('duration_minutes')
    .eq('id', request.appointment_type_id)
    .eq('doctor_id', doctor.id)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar el tipo de cita.', 503, true)
  if (!appointmentType) throw new RetellToolError('APPOINTMENT_TYPE_NOT_AVAILABLE', 'El tipo de cita ya no está disponible.', 409)

  const slots = await getAvailableSlots({
    doctorId: doctor.id,
    dateFrom: requiredDate(body, 'date_from'),
    dateTo: requiredDate(body, 'date_to'),
    durationMinutes: appointmentType.duration_minutes,
  }, supabase)

  return {
    ok: true,
    timezone: slots.timezone,
    slots: slots.slots.map((slot) => ({
      ...localSlotPresentation(slot.start, slots.timezone),
    })),
  }
}

export async function bookRetellAppointment(input: unknown) {
  const body = record(input)
  rejectDoctorId(body)
  const doctor = await resolveRetellDoctor(requiredString(body, 'agent_id'), optionalString(body, 'phone_number'))
  const requestId = requiredUuid(body, 'request_id')
  const request = await assertRequestBelongsToDoctor(doctor.id, requestId)
  if (!request.appointment_type_id) throw new RetellToolError('APPOINTMENT_TYPE_REQUIRED', 'La solicitud no tiene tipo de cita.', 409)
  const localDate = requiredDate(body, 'local_date')
  const localTime = requiredString(body, 'local_time')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new RetellToolError('INVALID_REQUEST', 'El campo local_time no es válido.')

  const supabase = createAdminClient()
  const { data: appointmentType, error: appointmentTypeError } = await supabase
    .from('appointment_types')
    .select('duration_minutes')
    .eq('id', request.appointment_type_id)
    .eq('doctor_id', doctor.id)
    .eq('is_active', true)
    .maybeSingle()
  if (appointmentTypeError) throw new RetellToolError('INTEGRATION_UNAVAILABLE', 'No se pudo cargar el tipo de cita.', 503, true)
  if (!appointmentType) throw new RetellToolError('APPOINTMENT_TYPE_NOT_AVAILABLE', 'El tipo de cita ya no está disponible.', 409)

  const availability = await getAvailableSlots({
    doctorId: doctor.id,
    dateFrom: localDate,
    dateTo: localDate,
    durationMinutes: appointmentType.duration_minutes,
  }, supabase)
  const selectedSlot = availability.slots.find((slot) => {
    const local = getDateTimeInTimezone(doctor.timezone, new Date(slot.start))
    return local.date === localDate && local.time === localTime
  })
  if (!selectedSlot) throw new RetellToolError('SLOT_UNAVAILABLE', 'El horario seleccionado ya no está disponible.', 409, true)

  const { data, error } = await supabase.rpc('book_appointment_from_request', {
    p_request_id: requestId,
    p_start_at: selectedSlot.start,
  })
  if (error) throw new RetellToolError('BOOKING_FAILED', 'No se pudo crear la cita.', 500)

  const result = rpcResult(data)
  return {
    ok: result.ok === true,
    code: typeof result.code === 'string' ? result.code : null,
    retryable: result.retryable === true,
    idempotent: result.idempotent === true,
    appointment_id: typeof result.appointment_id === 'string' ? result.appointment_id : null,
    request_id: typeof result.request_id === 'string' ? result.request_id : null,
    status: typeof result.status === 'string' ? result.status : null,
  }
}
