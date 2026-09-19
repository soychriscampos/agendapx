'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { depositRuleSortOrder, validateDepositRule } from '@/lib/assistant/deposit-rules'

export type AssistantActionState = { error?: string; success?: string; id?: string }

async function targetDoctorId(doctorId: string) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'DOCTOR' && user.role !== 'MASTER')) throw new Error('No tienes permiso para modificar esta configuración.')
  if (!doctorId) throw new Error('El doctor seleccionado no es válido.')
  if (user.role === 'DOCTOR' && user.doctor_id !== doctorId) throw new Error('No puedes modificar la configuración de otro doctor.')
  return doctorId
}

function text(formData: FormData, key: string) { return String(formData.get(key) ?? '').trim() }
function optionalText(formData: FormData, key: string) { return text(formData, key) || null }
function booleanValue(formData: FormData, key: string) { return formData.get(key) === 'on' || formData.get(key) === 'true' }

async function validateDepositRuleReferences(supabase: Awaited<ReturnType<typeof createClient>>, doctorId: string, rules: Array<{ scope: string; appointment_type_id: string | null; intake_field_id: string | null }>) {
  const appointmentTypeIds = [...new Set(rules.filter((rule) => rule.scope === 'APPOINTMENT_TYPE').map((rule) => rule.appointment_type_id).filter((id): id is string => !!id))]
  const intakeFieldIds = [...new Set(rules.filter((rule) => rule.scope === 'INTAKE_FIELD').map((rule) => rule.intake_field_id).filter((id): id is string => !!id))]
  const [typesResult, fieldsResult] = await Promise.all([
    appointmentTypeIds.length ? supabase.from('appointment_types').select('id').eq('doctor_id', doctorId).in('id', appointmentTypeIds) : Promise.resolve({ data: [], error: null }),
    intakeFieldIds.length ? supabase.from('assistant_intake_fields').select('id').eq('doctor_id', doctorId).in('id', intakeFieldIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (typesResult.error || fieldsResult.error) throw new Error('No se pudieron validar las referencias de las reglas.')
  if ((typesResult.data?.length ?? 0) !== appointmentTypeIds.length || (fieldsResult.data?.length ?? 0) !== intakeFieldIds.length) throw new Error('Selecciona tipos de cita y preguntas que pertenezcan a este consultorio.')
}

async function finish(path: string, task: () => Promise<void>): Promise<AssistantActionState> {
  try { await task(); revalidatePath(path); return { success: 'Cambios guardados.' } }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudieron guardar los cambios.' } }
}

export async function saveAssistantSettings(formData: FormData) {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const confirmationEnabledValue = formData.get('confirmation_enabled')
    const confirmationEnabled = confirmationEnabledValue === 'true' || confirmationEnabledValue === 'on'
    const lead = Number(formData.get('confirmation_lead_minutes'))
    const window = Number(formData.get('confirmation_response_window_minutes'))
    const actionValue = optionalText(formData, 'unconfirmed_action')?.toUpperCase() || null
    if (!Number.isInteger(lead) || lead < 0 || !Number.isInteger(window) || window <= 0 || (actionValue !== null && !['CANCEL', 'MANUAL'].includes(actionValue)) || (confirmationEnabled && actionValue === null)) throw new Error('Las reglas de confirmación no son válidas.')
    const supabase = await createClient()
    const { error } = await supabase.from('assistant_settings').upsert({ doctor_id: doctorId, assistant_name: optionalText(formData, 'assistant_name'), confirmation_enabled: confirmationEnabled, confirmation_lead_minutes: lead, confirmation_response_window_minutes: window, unconfirmed_action: confirmationEnabled ? actionValue : null, manual_follow_up_on_no_answer: booleanValue(formData, 'manual_follow_up_on_no_answer') })
    if (error) throw new Error('No se pudo guardar la configuración del asistente.')
  })
}

export async function savePaymentInstructions(formData: FormData) {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const supabase = await createClient()
    const { error } = await supabase.from('doctor_payment_instructions').upsert({ doctor_id: doctorId, bank_name: optionalText(formData, 'bank_name'), account_holder: optionalText(formData, 'account_holder'), clabe: optionalText(formData, 'clabe'), account_number: optionalText(formData, 'account_number'), instructions: optionalText(formData, 'instructions'), message_template: optionalText(formData, 'message_template') })
    if (error) throw new Error('No se pudieron guardar los datos del anticipo.')
  })
}

export async function saveAppointmentType(formData: FormData): Promise<AssistantActionState> {
  let savedId = optionalText(formData, 'id')
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const name = text(formData, 'name'); const duration = Number(formData.get('duration_minutes')); const priceRaw = text(formData, 'price')
    if (!name || !Number.isInteger(duration) || duration <= 0) throw new Error('Indica nombre y una duración válida.')
    const price = priceRaw ? Number(priceRaw) : null
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('El precio no es válido.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, name, duration_minutes: duration, price, is_active: booleanValue(formData, 'is_active') }
    if (id) { const { error } = await supabase.from('appointment_types').update(values).eq('id', id).eq('doctor_id', doctorId); if (error) throw new Error('No se pudo guardar el tipo de cita.') } else { const { data, error } = await supabase.from('appointment_types').insert(values).select('id').single(); if (error) throw new Error('No se pudo guardar el tipo de cita.'); savedId = data.id }
  }).then((result) => ({ ...result, id: savedId ?? undefined }))
}

type OnboardingCollectionResult = { error?: string; success?: string; items?: Array<{ index: number; id: string }> }

export async function saveAppointmentTypesForOnboarding(formData: FormData): Promise<OnboardingCollectionResult> {
  try {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const rawItems: unknown = JSON.parse(String(formData.get('items') ?? '[]'))
    if (!Array.isArray(rawItems)) throw new Error('Los tipos de cita no son válidos.')
    const supabase = await createClient()
    const items: Array<{ index: number; id: string }> = []

    for (const [index, rawItem] of rawItems.entries()) {
      if (!rawItem || typeof rawItem !== 'object') throw new Error('Los tipos de cita no son válidos.')
      const item = rawItem as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const duration = Number(item.duration_minutes)
      const priceRaw = typeof item.price === 'string' ? item.price.trim() : item.price
      const price = priceRaw === '' || priceRaw == null ? null : Number(priceRaw)
      if (!name || !Number.isInteger(duration) || duration <= 0) throw new Error('Indica nombre y una duración válida.')
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('El precio no es válido.')
      const values = { doctor_id: doctorId, name, duration_minutes: duration, price, is_active: item.is_active === true }
      if (id) {
        const { error } = await supabase.from('appointment_types').update(values).eq('id', id).eq('doctor_id', doctorId)
        if (error) throw new Error('No se pudo guardar el tipo de cita.')
        items.push({ index, id })
      } else {
        const { data, error } = await supabase.from('appointment_types').insert(values).select('id').single()
        if (error) throw new Error('No se pudo guardar el tipo de cita.')
        items.push({ index, id: data.id })
      }
    }

    revalidatePath('/app/assistant')
    return { success: 'Tipos de cita guardados.', items }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudieron guardar los tipos de cita.' }
  }
}

export async function deleteAppointmentType(formData: FormData) { return deleteOwned('/app/assistant', 'appointment_types', text(formData, 'id'), text(formData, 'doctor_id')) }

export async function saveIntakeField(formData: FormData): Promise<AssistantActionState> {
  let savedId = optionalText(formData, 'id')
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const fieldKey = text(formData, 'field_key'); const label = text(formData, 'label'); const order = Number(formData.get('sort_order'))
    if (!fieldKey || !label || !Number.isInteger(order) || order < 0) throw new Error('Completa una clave, etiqueta y orden válidos.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, field_key: fieldKey, label, is_required: booleanValue(formData, 'is_required'), is_active: booleanValue(formData, 'is_active'), sort_order: order }
    if (id) { const { error } = await supabase.from('assistant_intake_fields').update(values).eq('id', id).eq('doctor_id', doctorId); if (error) throw new Error('No se pudo guardar el dato solicitado.') } else { const { data, error } = await supabase.from('assistant_intake_fields').insert(values).select('id').single(); if (error) throw new Error('No se pudo guardar el dato solicitado.'); savedId = data.id }
  }).then((result) => ({ ...result, id: savedId ?? undefined }))
}

export async function saveIntakeFieldsForOnboarding(formData: FormData): Promise<OnboardingCollectionResult> {
  try {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const rawItems: unknown = JSON.parse(String(formData.get('items') ?? '[]'))
    if (!Array.isArray(rawItems)) throw new Error('Los datos solicitados no son válidos.')
    const supabase = await createClient()
    const items: Array<{ index: number; id: string }> = []

    for (const [index, rawItem] of rawItems.entries()) {
      if (!rawItem || typeof rawItem !== 'object') throw new Error('Los datos solicitados no son válidos.')
      const item = rawItem as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const fieldKey = typeof item.field_key === 'string' ? item.field_key.trim() : ''
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      const order = Number(item.sort_order)
      if (!fieldKey || !label || !Number.isInteger(order) || order < 0) throw new Error('Completa una clave, etiqueta y orden válidos.')
      const values = { doctor_id: doctorId, field_key: fieldKey, label, is_required: item.is_required === true, is_active: item.is_active === true, sort_order: order }
      if (id) {
        const { error } = await supabase.from('assistant_intake_fields').update(values).eq('id', id).eq('doctor_id', doctorId)
        if (error) throw new Error('No se pudo guardar el dato solicitado.')
        items.push({ index, id })
      } else {
        const { data, error } = await supabase.from('assistant_intake_fields').insert(values).select('id').single()
        if (error) throw new Error('No se pudo guardar el dato solicitado.')
        items.push({ index, id: data.id })
      }
    }

    revalidatePath('/app/assistant')
    return { success: 'Datos solicitados guardados.', items }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudieron guardar los datos solicitados.' }
  }
}

export async function deleteIntakeField(formData: FormData) { return deleteOwned('/app/assistant', 'assistant_intake_fields', text(formData, 'id'), text(formData, 'doctor_id')) }

export async function saveDepositRule(formData: FormData): Promise<AssistantActionState> {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const id = optionalText(formData, 'id')
    const scope = text(formData, 'scope')
    const type = text(formData, 'deposit_type')
    const rawValue = text(formData, 'deposit_value')
    const value = rawValue ? Number(rawValue) : null
    const name = text(formData, 'name')
    const appointmentTypeId = optionalText(formData, 'appointment_type_id')
    const intakeFieldId = optionalText(formData, 'intake_field_id')
    const operator = optionalText(formData, 'operator')
    const conditionValue = optionalText(formData, 'condition_value')
    const supabase = await createClient()
    let sortOrder: number

    if (id) {
      sortOrder = Number(formData.get('sort_order'))
    } else {
      const { data, error } = await supabase.from('deposit_rules').select('sort_order').eq('doctor_id', doctorId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
      if (error) throw new Error('No se pudo determinar la prioridad de la regla.')
      sortOrder = (data?.sort_order ?? 0) + 10
    }

    const rule = { name, scope, appointment_type_id: appointmentTypeId, intake_field_id: intakeFieldId, operator, condition_value: conditionValue, deposit_type: type, deposit_value: value, sort_order: sortOrder }
    const validationError = validateDepositRule(rule)
    if (validationError) throw new Error(validationError)
    await validateDepositRuleReferences(supabase, doctorId, [rule])
    const values = { doctor_id: doctorId, ...rule, is_active: booleanValue(formData, 'is_active') }
    const query = id ? supabase.from('deposit_rules').update(values).eq('id', id).eq('doctor_id', doctorId) : supabase.from('deposit_rules').insert(values)
    const { error } = await query; if (error) throw new Error('No se pudo guardar la regla de anticipo.')
  })
}

export async function deleteDepositRule(formData: FormData) { return deleteOwned('/app/assistant', 'deposit_rules', text(formData, 'id'), text(formData, 'doctor_id')) }

export async function reorderDepositRules(formData: FormData): Promise<AssistantActionState> {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const rawIds: unknown = JSON.parse(String(formData.get('ids') ?? '[]'))
    if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string') || new Set(rawIds).size !== rawIds.length) throw new Error('El orden de las reglas no es válido.')
    const ids = rawIds as string[]
    const supabase = await createClient()
    const { data: currentRows, error: queryError } = await supabase.from('deposit_rules').select('id').eq('doctor_id', doctorId)
    if (queryError) throw new Error('No se pudo cargar el orden actual de las reglas.')
    const currentIds = new Set((currentRows ?? []).map((row) => row.id))
    if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) throw new Error('Las reglas cambiaron. Actualiza la página e inténtalo de nuevo.')
    const results = await Promise.all(ids.map((id, index) => supabase.from('deposit_rules').update({ sort_order: depositRuleSortOrder(index) }).eq('id', id).eq('doctor_id', doctorId)))
    if (results.some((result) => result.error)) throw new Error('No se pudo guardar el orden de las reglas.')
  })
}

export async function saveDepositRulesForOnboarding(formData: FormData): Promise<AssistantActionState> {
  try {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const rawItems: unknown = JSON.parse(String(formData.get('items') ?? '[]'))
    const rawDeletedIds: unknown = JSON.parse(String(formData.get('deleted_ids') ?? '[]'))
    const wantsDeposit = formData.get('wants_deposit') === 'true'
    if (!Array.isArray(rawItems) || !Array.isArray(rawDeletedIds) || rawDeletedIds.some((id) => typeof id !== 'string')) throw new Error('Las reglas de anticipo no son válidas.')

    const supabase = await createClient()
    const { data: existingRows, error: queryError } = await supabase.from('deposit_rules').select('id').eq('doctor_id', doctorId)
    if (queryError) throw new Error('No se pudieron cargar las reglas actuales.')
    const existingIds = new Set((existingRows ?? []).map((row) => row.id))
    const deletedIds = rawDeletedIds as string[]
    if (new Set(deletedIds).size !== deletedIds.length) throw new Error('Las reglas seleccionadas para eliminar no son válidas.')

    const normalized = rawItems.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error('Las reglas de anticipo no son válidas.')
      const item = rawItem as Record<string, unknown>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Regla de anticipo ${index + 1}`
      const scope = typeof item.scope === 'string' ? item.scope : ''
      const appointmentTypeId = typeof item.appointment_type_id === 'string' && item.appointment_type_id ? item.appointment_type_id : null
      const intakeFieldId = typeof item.intake_field_id === 'string' && item.intake_field_id ? item.intake_field_id : null
      const operator = typeof item.operator === 'string' && item.operator ? item.operator : null
      const conditionValue = typeof item.condition_value === 'string' && item.condition_value.trim() ? item.condition_value.trim() : null
      const depositType = typeof item.deposit_type === 'string' ? item.deposit_type : ''
      const rawValue = item.deposit_value
      const depositValue = rawValue === '' || rawValue == null ? null : Number(rawValue)
      const isActive = item.is_active === true && wantsDeposit
      const rule = { name, scope, appointment_type_id: appointmentTypeId, intake_field_id: intakeFieldId, operator, condition_value: conditionValue, deposit_type: depositType, deposit_value: depositValue, sort_order: depositRuleSortOrder(index) }
      const validationError = validateDepositRule(rule)

      if (!id && !wantsDeposit) return null
      if (!id) throw new Error('Una regla nueva no tiene un identificador válido.')
      if (!existingIds.has(id) && validationError && !wantsDeposit) return null
      if (validationError) throw new Error(validationError)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Una regla tiene un identificador no válido.')
      return { id, ...rule, is_active: isActive }
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    const ids = normalized.map((item) => item.id).filter(Boolean)
    if (new Set(ids).size !== ids.length || deletedIds.some((id) => ids.includes(id))) throw new Error('Hay reglas repetidas o seleccionadas para eliminar y conservar a la vez.')
    const persistedIdsInItems = new Set(ids.filter((id) => existingIds.has(id)))
    if ([...existingIds].some((id) => !persistedIdsInItems.has(id) && !deletedIds.includes(id))) throw new Error('Las reglas cambiaron. Vuelve a cargar la página antes de finalizar.')
    if (wantsDeposit && !normalized.some((item) => item.is_active)) throw new Error('Activa al menos una regla o selecciona que no necesitas anticipo.')
    await validateDepositRuleReferences(supabase, doctorId, normalized)

    const existingItems = normalized.filter((item) => existingIds.has(item.id)).map((item) => ({ ...item, doctor_id: doctorId }))
    const newItems = normalized.filter((item) => !existingIds.has(item.id)).map((item) => ({ ...item, doctor_id: doctorId }))

    if (existingItems.length) {
      const { error } = await supabase.from('deposit_rules').upsert(existingItems, { onConflict: 'id' })
      if (error) throw new Error('No se pudieron actualizar las reglas de anticipo.')
    }
    if (newItems.length) {
      const { error } = await supabase.from('deposit_rules').insert(newItems)
      if (error) throw new Error('No se pudieron agregar las nuevas reglas de anticipo.')
    }
    if (deletedIds.length) {
      const { error } = await supabase.from('deposit_rules').delete().eq('doctor_id', doctorId).in('id', deletedIds)
      if (error) throw new Error('No se pudieron eliminar las reglas seleccionadas.')
    }

    revalidatePath('/onboarding')
    revalidatePath('/app/assistant')
    return { success: 'Reglas de anticipo guardadas.' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudieron guardar las reglas de anticipo.' }
  }
}

export async function saveKnowledgeItem(formData: FormData): Promise<AssistantActionState> {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const title = text(formData, 'title'); const content = text(formData, 'content'); const order = Number(formData.get('sort_order'))
    if (!title || !content || !Number.isInteger(order) || order < 0) throw new Error('Completa título, contenido y orden válidos.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, title, content, is_active: booleanValue(formData, 'is_active'), sort_order: order }
    const query = id ? supabase.from('assistant_knowledge_items').update(values).eq('id', id).eq('doctor_id', doctorId) : supabase.from('assistant_knowledge_items').insert(values)
    const { error } = await query; if (error) throw new Error('No se pudo guardar la información administrativa.')
  })
}

export async function deleteKnowledgeItem(formData: FormData) { return deleteOwned('/app/assistant', 'assistant_knowledge_items', text(formData, 'id'), text(formData, 'doctor_id')) }

async function deleteOwned(path: string, table: string, id: string, doctorId: string): Promise<AssistantActionState> {
  return finish(path, async () => { const targetId = await targetDoctorId(doctorId); if (!id) throw new Error('El registro seleccionado no es válido.'); const supabase = await createClient(); const { error } = await supabase.from(table).delete().eq('id', id).eq('doctor_id', targetId); if (error) throw new Error('No se pudo eliminar el registro.') })
}
