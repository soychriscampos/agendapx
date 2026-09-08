'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type AssistantActionState = { error?: string; success?: string }

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

async function finish(path: string, task: () => Promise<void>): Promise<AssistantActionState> {
  try { await task(); revalidatePath(path); return { success: 'Cambios guardados.' } }
  catch (error) { return { error: error instanceof Error ? error.message : 'No se pudieron guardar los cambios.' } }
}

export async function saveAssistantSettings(formData: FormData) {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id'))
    const lead = Number(formData.get('confirmation_lead_minutes'))
    const window = Number(formData.get('confirmation_response_window_minutes'))
    if (!Number.isInteger(lead) || lead < 0 || !Number.isInteger(window) || window <= 0) throw new Error('Las reglas de confirmación no son válidas.')
    const supabase = await createClient()
    const { error } = await supabase.from('assistant_settings').upsert({ doctor_id: doctorId, assistant_name: optionalText(formData, 'assistant_name'), confirmation_lead_minutes: lead, confirmation_response_window_minutes: window, manual_follow_up_on_no_answer: booleanValue(formData, 'manual_follow_up_on_no_answer') })
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
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const name = text(formData, 'name'); const duration = Number(formData.get('duration_minutes')); const priceRaw = text(formData, 'price')
    if (!name || !Number.isInteger(duration) || duration <= 0) throw new Error('Indica nombre y una duración válida.')
    const price = priceRaw ? Number(priceRaw) : null
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('El precio no es válido.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, name, duration_minutes: duration, price, is_active: booleanValue(formData, 'is_active') }
    const query = id ? supabase.from('appointment_types').update(values).eq('id', id).eq('doctor_id', doctorId) : supabase.from('appointment_types').insert(values)
    const { error } = await query; if (error) throw new Error('No se pudo guardar el tipo de cita.')
  })
}

export async function deleteAppointmentType(formData: FormData) { return deleteOwned('/app/assistant', 'appointment_types', text(formData, 'id'), text(formData, 'doctor_id')) }

export async function saveIntakeField(formData: FormData): Promise<AssistantActionState> {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const fieldKey = text(formData, 'field_key'); const label = text(formData, 'label'); const order = Number(formData.get('sort_order'))
    if (!fieldKey || !label || !Number.isInteger(order) || order < 0) throw new Error('Completa una clave, etiqueta y orden válidos.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, field_key: fieldKey, label, is_required: booleanValue(formData, 'is_required'), is_active: booleanValue(formData, 'is_active'), sort_order: order }
    const query = id ? supabase.from('assistant_intake_fields').update(values).eq('id', id).eq('doctor_id', doctorId) : supabase.from('assistant_intake_fields').insert(values)
    const { error } = await query; if (error) throw new Error('No se pudo guardar el dato solicitado.')
  })
}

export async function deleteIntakeField(formData: FormData) { return deleteOwned('/app/assistant', 'assistant_intake_fields', text(formData, 'id'), text(formData, 'doctor_id')) }

export async function saveDepositRule(formData: FormData): Promise<AssistantActionState> {
  return finish('/app/assistant', async () => {
    const doctorId = await targetDoctorId(text(formData, 'doctor_id')); const id = optionalText(formData, 'id'); const scope = text(formData, 'scope'); const type = text(formData, 'deposit_type'); const value = Number(formData.get('deposit_value')); const name = text(formData, 'name'); const city = optionalText(formData, 'origin_city')
    if (!name || !['ALL', 'ORIGIN_CITY'].includes(scope) || !['PERCENTAGE', 'FIXED'].includes(type) || !Number.isFinite(value) || value <= 0 || (type === 'PERCENTAGE' && value > 100) || (scope === 'ORIGIN_CITY' && !city) || (scope === 'ALL' && city)) throw new Error('La regla de anticipo no es válida.')
    const supabase = await createClient(); const values = { doctor_id: doctorId, name, scope, origin_city: scope === 'ORIGIN_CITY' ? city : null, deposit_type: type, deposit_value: value, is_active: booleanValue(formData, 'is_active') }
    const query = id ? supabase.from('deposit_rules').update(values).eq('id', id).eq('doctor_id', doctorId) : supabase.from('deposit_rules').insert(values)
    const { error } = await query; if (error) throw new Error('No se pudo guardar la regla de anticipo.')
  })
}

export async function deleteDepositRule(formData: FormData) { return deleteOwned('/app/assistant', 'deposit_rules', text(formData, 'id'), text(formData, 'doctor_id')) }

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
