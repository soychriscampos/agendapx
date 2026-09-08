import { DoctorPlaceholder } from '@/components/doctor/doctor-placeholder'
import { DoctorScheduleForm } from '@/components/schedule/doctor-schedule-form'
import { resolveDoctorAgendaContext } from '@/lib/agenda/context'
import { getDoctorRecurringUnavailability, getDoctorSchedule } from '@/lib/schedule/doctor-schedule'
import { requireRole } from '@/lib/auth'

export default async function AssistantPage() {
  const user = await requireRole('DOCTOR')
  const context = await resolveDoctorAgendaContext(user)
  const [schedule, recurringUnavailability] = await Promise.all([
    getDoctorSchedule(context.doctorId, context.actorRole),
    getDoctorRecurringUnavailability(context.doctorId),
  ])

  return (
    <section className="space-y-8">
      <DoctorPlaceholder
        eyebrow="AgendaPX · DOCTOR"
        title="Mi asistente"
        description="Configura lo que tu asistente necesita saber para ayudarte con la atención de tus pacientes."
      />
      <DoctorScheduleForm doctorId={context.doctorId} schedule={schedule} recurringUnavailability={recurringUnavailability} />
    </section>
  )
}
