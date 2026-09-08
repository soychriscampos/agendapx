import Link from 'next/link'

import { logout } from '@/app/actions'
import { AgendaContent } from '@/components/agenda/agenda-content'
import { DoctorScheduleForm } from '@/components/schedule/doctor-schedule-form'
import type { AgendaContext } from '@/lib/agenda/context'
import type { DoctorSchedule, RecurringUnavailability } from '@/lib/schedule/doctor-schedule'
import type { DoctorUnavailability } from '@/lib/unavailability/doctor-unavailability'
import type { Appointment } from '@/lib/appointments/appointments'

type AgendaViewProps = {
  context: AgendaContext
  doctorName?: string
  schedule?: DoctorSchedule
  recurringUnavailability?: RecurringUnavailability[]
  unavailability?: DoctorUnavailability[]
  appointments?: Appointment[]
}

export function AgendaView({ context, doctorName, schedule, recurringUnavailability, unavailability = [], appointments = [] }: AgendaViewProps) {
  const isMasterContext = context.actorRole === 'MASTER'

  if (!isMasterContext) return <AgendaContent context={context} unavailability={unavailability} appointments={appointments} />

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx · MASTER</p>
            <h1 className="mt-2 text-3xl font-semibold text-zinc-950">Agenda</h1>
            <p className="mt-2 text-sm text-zinc-600">Administrando: {doctorName}</p>
            <p className="mt-1 font-mono text-xs text-zinc-500">doctor_id: {context.doctorId}</p>
            <p className="mt-1 text-xs text-zinc-500">Zona horaria: {context.timezone}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/master/doctors" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100">
              Regresar a doctores
            </Link>
            <form action={logout}>
              <button type="submit" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100">Cerrar sesión</button>
            </form>
          </div>
        </header>
        <div className="mt-8">
          <AgendaContent context={context} unavailability={unavailability} appointments={appointments} />
          {schedule ? <div className="mt-10"><DoctorScheduleForm doctorId={context.doctorId} schedule={schedule} recurringUnavailability={recurringUnavailability ?? []} /></div> : null}
        </div>
      </div>
    </main>
  )
}
