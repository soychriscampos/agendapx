import type { SchedulingCallAttempt } from '@/lib/retell/scheduling-attempts'

function formatTimestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value))
}

export function SchedulingCallStatus({ attempt, contactName, timezone }: { attempt: SchedulingCallAttempt; contactName: string; timezone: string }) {
  const presentation = {
    CREATING: {
      message: 'HelloPx está preparando la llamada para coordinar la cita.',
      timeLabel: 'Iniciado',
      timestamp: attempt.createdAt,
    },
    DISPATCHED: {
      message: `HelloPx está llamando a ${contactName} para coordinar la cita.`,
      timeLabel: 'Iniciada',
      timestamp: attempt.dispatchedAt,
    },
    COMPLETED: {
      message: 'La última llamada terminó.',
      timeLabel: 'Terminó',
      timestamp: attempt.finishedAt,
    },
    NO_ANSWER: {
      message: 'No hubo respuesta en el último intento.',
      timeLabel: 'Último intento',
      timestamp: attempt.finishedAt,
    },
    FAILED: {
      message: 'No se pudo iniciar la última llamada.',
      timeLabel: 'Último intento',
      timestamp: attempt.finishedAt ?? attempt.updatedAt,
    },
    INTERRUPTED: {
      message: 'La última llamada se interrumpió.',
      timeLabel: 'Último intento',
      timestamp: attempt.finishedAt,
    },
  }[attempt.status]

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6" aria-live={attempt.status === 'CREATING' || attempt.status === 'DISPATCHED' ? 'polite' : undefined}>
      <h2 className="font-semibold text-zinc-950">Coordinación de cita</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-700">{presentation.message}</p>
      {presentation.timestamp ? <p className="mt-2 text-xs text-zinc-500">{presentation.timeLabel} {formatTimestamp(presentation.timestamp, timezone)}</p> : null}
    </section>
  )
}
