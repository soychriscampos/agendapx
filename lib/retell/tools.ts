import { getDateTimeInTimezone, localDateTimeToUtc } from '@/lib/agenda/timezone'
import { getAvailableSlots } from '@/lib/availability/get-available-slots'
import { normalizePhoneToE164 } from '@/lib/phone/normalize-phone'
import { formatTimeForVoice } from '@/lib/retell/voice-time'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverDepositRequestEmail } from '@/lib/deposits/phase9'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RELATIONSHIPS = new Set(['SELF', 'MOTHER', 'FATHER', 'CHILD', 'PARTNER', 'RELATIVE', 'OTHER'])

type JsonRecord = Record<string, unknown>
type ResolvedDoctor = { id: string; displayName: string; specialty: string | null; timezone: string; address: string | null; phone: string | null; whatsapp: string | null }
type IntakeAnswer = { intake_field_id: string; value: string | null }
type DepositPaymentInstructions = {
  bank_name: string | null
  account_holder: string | null
  clabe: string | null
  account_number: string | null
  instructions: string | null
  message_template: string | null
}
type DepositResolution = {
  rule_id: string | null
  rule_name: string
  type: 'PERCENTAGE' | 'FIXED'
  value: number
  appointment_price: number | null
  amount: number
  payment_instructions: DepositPaymentInstructions | null
}

export class RetellToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
    public readonly agentMessage?: string,
  ) {
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

const DEPOSIT_RESOLUTION_CODES = new Set([
  'REQUEST_NOT_FOUND',
  'REQUEST_NOT_WAITING_DEPOSIT',
  'APPOINTMENT_TYPE_REQUIRED',
  'APPOINTMENT_TYPE_NOT_FOUND',
  'DEPOSIT_RULE_NOT_FOUND',
  'AMBIGUOUS_DEPOSIT_RULE',
  'DEPOSIT_PRICE_REQUIRED',
  'INVALID_DEPOSIT_TYPE',
])

function depositResolutionCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  const values = [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
  return values.flatMap((value) => value.split(/[^A-Z_]+/)).find((value) => DEPOSIT_RESOLUTION_CODES.has(value)) ?? null
}

function depositResolutionMessage(code: string) {
  const messages: Record<string, string> = {
    REQUEST_NOT_FOUND: 'La solicitud no existe.',
    REQUEST_NOT_WAITING_DEPOSIT: 'La solicitud ya no está esperando anticipo.',
    APPOINTMENT_TYPE_REQUIRED: 'La solicitud no tiene tipo de cita.',
    APPOINTMENT_TYPE_NOT_FOUND: 'El tipo de cita no está disponible.',
    DEPOSIT_RULE_NOT_FOUND: 'No se pudo resolver la regla de anticipo configurada.',
    AMBIGUOUS_DEPOSIT_RULE: 'La configuración de anticipos es ambigua.',
    DEPOSIT_PRICE_REQUIRED: 'El tipo de cita no tiene un precio válido para calcular el anticipo.',
    INVALID_DEPOSIT_TYPE: 'La configuración del anticipo tiene un tipo inválido.',
  }
  return messages[code] ?? 'No se pudo resolver el anticipo.'
}

function nullableString(value: unknown, field: string) {
  if (value !== null && typeof value !== 'string') throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', `La respuesta de anticipo contiene ${field} inválido.`, 502)
  return value as string | null
}

function depositResolution(value: unknown): DepositResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo no es válida.', 502)
  const result = value as JsonRecord
  if (!result.deposit || typeof result.deposit !== 'object' || Array.isArray(result.deposit)) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo está incompleta.', 502)
  const deposit = result.deposit as JsonRecord
  const type = deposit.type
  if (typeof deposit.rule_name !== 'string' || (type !== 'PERCENTAGE' && type !== 'FIXED')) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo está incompleta.', 502)
  if (deposit.rule_id !== null && typeof deposit.rule_id !== 'string') throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo contiene rule_id inválido.', 502)
  if (typeof deposit.value !== 'number' || !Number.isFinite(deposit.value) || typeof deposit.amount !== 'number' || !Number.isFinite(deposit.amount)) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo contiene importes inválidos.', 502)
  if (deposit.appointment_price !== null && (typeof deposit.appointment_price !== 'number' || !Number.isFinite(deposit.appointment_price))) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo contiene un precio inválido.', 502)

  let paymentInstructions: DepositPaymentInstructions | null = null
  if (deposit.payment_instructions !== null) {
    const payment = record(deposit.payment_instructions)
    paymentInstructions = {
      bank_name: nullableString(payment.bank_name, 'bank_name'),
      account_holder: nullableString(payment.account_holder, 'account_holder'),
      clabe: nullableString(payment.clabe, 'clabe'),
      account_number: nullableString(payment.account_number, 'account_number'),
      instructions: nullableString(payment.instructions, 'instructions'),
      message_template: nullableString(payment.message_template, 'message_template'),
    }
  }

  return {
    rule_id: deposit.rule_id as string | null,
    rule_name: deposit.rule_name,
    type,
    value: deposit.value,
    appointment_price: deposit.appointment_price as number | null,
    amount: deposit.amount,
    payment_instructions: paymentInstructions,
  }
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

function greetingForTimezone(timezone: string) {
  const localTime = getDateTimeInTimezone(timezone, new Date()).time
  const hour = Number(localTime.slice(0, 2))
  if (hour >= 5 && hour < 12) return 'Buenos días'
  if (hour >= 12 && hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Builds the same minimal prompt variables used by the inbound webhook. */
export async function getRetellDynamicVariables(agentId: string, technicalPhoneNumber?: string): Promise<Record<string, string>> {
  const context = await getRetellInboundContext(agentId, technicalPhoneNumber)
  return Object.fromEntries(
    Object.entries({ ...context, greeting: greetingForTimezone(context.timezone) })
      .map(([key, value]) => [key, String(value)]),
  )
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
  const callerPhoneNumber = requiredString(body, 'caller_phone_number')
  try {
    phoneE164 = normalizePhoneToE164(callerPhoneNumber)
  } catch {
    throw new RetellToolError(
      'INVALID_REQUEST',
      'El teléfono de quien llama no es válido.',
      400,
      false,
      'Necesito un número de teléfono mexicano válido de 10 dígitos. ¿Me lo puedes repetir, por favor?',
    )
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
  const requestId = typeof result.request_id === 'string' ? result.request_id : null
  let deposit: DepositResolution | undefined

  if (requiresDeposit) {
    if (!requestId) throw new RetellToolError('PREPARE_BOOKING_INVALID', 'La preparación indicó un anticipo sin request_id.', 502)

    const { data: resolvedDeposit, error: depositError } = await supabase.rpc('resolve_deposit_for_request', {
      p_request_id: requestId,
    })

    if (depositError) {
      const code = depositResolutionCode(depositError)
      if (code) throw new RetellToolError(code, depositResolutionMessage(code), code === 'REQUEST_NOT_FOUND' ? 404 : 409)
      throw new RetellToolError('DEPOSIT_RESOLUTION_FAILED', 'No se pudo resolver el anticipo.', 502, true)
    }

    if (!resolvedDeposit || typeof resolvedDeposit !== 'object' || Array.isArray(resolvedDeposit)) throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo no es válida.', 502)
    const resolved = resolvedDeposit as JsonRecord
    if (typeof resolved.code === 'string' && DEPOSIT_RESOLUTION_CODES.has(resolved.code)) {
      throw new RetellToolError(resolved.code, depositResolutionMessage(resolved.code), resolved.code === 'REQUEST_NOT_FOUND' ? 404 : 409)
    }
    if (resolved.ok !== true || resolved.requires_deposit !== true || resolved.request_id !== requestId || resolved.request_status !== 'WAITING_DEPOSIT') {
      throw new RetellToolError('DEPOSIT_RESOLUTION_INVALID', 'La respuesta de anticipo no confirma una solicitud pendiente válida.', 502)
    }
    deposit = depositResolution(resolved)
    if (deposit.type === 'FIXED') await deliverDepositRequestEmail(requestId)
  }

  return {
    ok: result.ok === true && !requiresDeposit,
    requires_deposit: requiresDeposit,
    request_id: requestId,
    patient_id: typeof result.patient_id === 'string' ? result.patient_id : null,
    appointment_type_id: typeof result.appointment_type_id === 'string' ? result.appointment_type_id : null,
    request_status: typeof result.request_status === 'string' ? result.request_status : null,
    idempotent: result.idempotent === true,
    code: typeof result.code === 'string' ? result.code : null,
    ...(deposit ? { deposit } : {}),
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

  const startAt = localDateTimeToUtc(localDate, localTime, doctor.timezone)
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('book_appointment_from_request', {
    p_request_id: requestId,
    p_start_at: startAt.toISOString(),
  })
  if (error) throw new RetellToolError('BOOKING_FAILED', 'No se pudo crear la cita.', 500)

  const result = rpcResult(data)
  const code = typeof result.code === 'string' ? result.code : null
  const expectedBookingCodes = new Set(['TOO_SOON', 'OUTSIDE_SCHEDULE', 'SLOT_UNAVAILABLE'])
  const expectedBookingFailure = code !== null && expectedBookingCodes.has(code)
  let persistedStartAt = typeof result.start_at === 'string' && !Number.isNaN(new Date(result.start_at).getTime()) ? result.start_at : null
  if (!persistedStartAt && typeof result.appointment_id === 'string') {
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('start_at')
      .eq('id', result.appointment_id)
      .eq('doctor_id', doctor.id)
      .maybeSingle()
    if (!appointmentError && typeof appointment?.start_at === 'string' && !Number.isNaN(new Date(appointment.start_at).getTime())) persistedStartAt = appointment.start_at
  }
  if (!persistedStartAt) {
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('start_at')
      .eq('appointment_request_id', requestId)
      .eq('doctor_id', doctor.id)
      .maybeSingle()
    if (!appointmentError && typeof appointment?.start_at === 'string' && !Number.isNaN(new Date(appointment.start_at).getTime())) persistedStartAt = appointment.start_at
  }
  const persistedLocal = persistedStartAt ? getDateTimeInTimezone(doctor.timezone, new Date(persistedStartAt)) : null
  return {
    ok: expectedBookingFailure ? false : result.ok === true,
    code,
    retryable: expectedBookingFailure || result.retryable === true,
    idempotent: result.idempotent === true,
    appointment_id: typeof result.appointment_id === 'string' ? result.appointment_id : null,
    request_id: typeof result.request_id === 'string' ? result.request_id : null,
    status: typeof result.status === 'string' ? result.status : null,
    local_date: persistedLocal?.date ?? null,
    local_time: persistedLocal?.time ?? null,
  }
}
