import { AssistantConfiguration } from '@/components/assistant/assistant-configuration'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { getDoctorSchedule } from '@/lib/schedule/doctor-schedule'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function AssistantPage() {
  const user = await requireRole('DOCTOR')
  const context = await resolveDoctorAgendaContext(user)
  const supabase = await createClient()
  const [doctorQuery, settingsQuery, paymentQuery, typesQuery, intakeQuery, depositsQuery, knowledgeQuery, schedule] = await Promise.all([
    supabase.from('doctors').select('display_name, specialty, address, phone, whatsapp, timezone').eq('id', context.doctorId).maybeSingle(),
    supabase.from('assistant_settings').select('assistant_name, confirmation_lead_minutes, confirmation_response_window_minutes, manual_follow_up_on_no_answer').eq('doctor_id', context.doctorId).maybeSingle(),
    supabase.from('doctor_payment_instructions').select('bank_name, account_holder, clabe, account_number, instructions, message_template').eq('doctor_id', context.doctorId).maybeSingle(),
    supabase.from('appointment_types').select('id, name, duration_minutes, price, is_active').eq('doctor_id', context.doctorId).order('created_at'),
    supabase.from('assistant_intake_fields').select('id, field_key, label, is_required, is_active, sort_order').eq('doctor_id', context.doctorId).order('sort_order').order('id'),
    supabase.from('deposit_rules').select('id, name, scope, origin_city, deposit_type, deposit_value, is_active').eq('doctor_id', context.doctorId).order('created_at'),
    supabase.from('assistant_knowledge_items').select('id, title, content, is_active, sort_order').eq('doctor_id', context.doctorId).order('sort_order').order('id'),
    getDoctorSchedule(context.doctorId, context.actorRole),
  ])

  if (doctorQuery.error || !doctorQuery.data) throw new Error('No se pudo cargar la información del consultorio.')
  if (settingsQuery.error || paymentQuery.error || typesQuery.error || intakeQuery.error || depositsQuery.error || knowledgeQuery.error) throw new Error('No se pudo cargar la configuración del asistente.')

  return (
    <AssistantConfiguration doctorId={context.doctorId} doctor={doctorQuery.data} timezone={doctorQuery.data.timezone} schedule={schedule} settings={settingsQuery.data} payment={paymentQuery.data} appointmentTypes={typesQuery.data ?? []} intakeFields={intakeQuery.data ?? []} depositRules={depositsQuery.data ?? []} knowledgeItems={knowledgeQuery.data ?? []} />
  )
}
