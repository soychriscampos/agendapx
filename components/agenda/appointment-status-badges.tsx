import type { Appointment } from '@/lib/appointments/appointments'

type Badge = { label: string; color: string }

function appointmentBadge(appointment: Appointment): Badge {
  if (appointment.status === 'CANCELLED') {
    return { label: 'Cita cancelada', color: 'bg-rose-100 text-rose-800' }
  }
  return { label: 'Cita agendada', color: 'bg-zinc-100 text-zinc-700' }
}

function attendanceBadge(appointment: Appointment): Badge | null {
  if (appointment.status === 'CANCELLED') return null
  if (appointment.manualConfirmationRequested === false && appointment.confirmationStatus === 'PENDING') {
    return { label: 'Confirmación desactivada', color: 'bg-zinc-100 text-zinc-600' }
  }

  switch (appointment.confirmationStatus) {
    case 'PENDING':
      return { label: 'Asistencia pendiente', color: 'bg-amber-100 text-amber-800' }
    case 'CONFIRMED':
      return { label: 'Asistencia confirmada', color: 'bg-emerald-100 text-emerald-800' }
    case 'CANCELLED':
      return { label: 'Confirmación cancelada', color: 'bg-zinc-100 text-zinc-700' }
    case 'REMINDER_PENDING':
      return { label: 'Llamada sin respuesta', color: 'bg-amber-100 text-amber-800' }
    case 'REMINDER_STARTED':
      return { label: 'Esperando respuesta', color: 'bg-sky-100 text-sky-800' }
    case 'MANUAL_REQUIRED':
      return { label: 'Requiere atención', color: 'bg-rose-100 text-rose-800' }
  }
}

export function AppointmentStatusBadges({ appointment, compact = false }: { appointment: Appointment; compact?: boolean }) {
  const badges = [appointmentBadge(appointment), attendanceBadge(appointment)].filter((badge): badge is Badge => badge !== null)
  const size = compact ? 'px-1 py-0.5 text-[9px] leading-3' : 'px-2 py-1 text-xs leading-4'

  return (
    <span className="flex min-w-0 max-w-full flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge.label} className={`inline-flex min-w-0 max-w-full whitespace-normal break-words rounded font-medium [overflow-wrap:anywhere] ${size} ${badge.color}`}>
          {badge.label}
        </span>
      ))}
    </span>
  )
}
