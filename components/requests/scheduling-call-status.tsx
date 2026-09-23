'use client'

import { useEffect, useState } from 'react'

import type { SchedulingCallAttempt } from '@/lib/retell/scheduling-attempts'

function formatTimestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value))
}

export function SchedulingCallStatus({ attempt, contactName, timezone }: { attempt: SchedulingCallAttempt; contactName: string; timezone: string }) {
  const [previousStatus, setPreviousStatus] = useState(attempt.status)
  const [statusChanged, setStatusChanged] = useState(false)

  useEffect(() => {
    if (previousStatus === attempt.status) return
    const frame = window.requestAnimationFrame(() => {
      setPreviousStatus(attempt.status)
      setStatusChanged(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attempt.status, previousStatus])

  useEffect(() => {
    if (!statusChanged) return
    const timeout = window.setTimeout(() => setStatusChanged(false), 160)
    return () => window.clearTimeout(timeout)
  }, [statusChanged])

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
    <section className="rounded-xl border border-zinc-300 bg-zinc-50 p-5 sm:p-6" aria-live="polite">
      <h2 className="font-semibold text-zinc-950">Coordinación de cita</h2>
      <div className={statusChanged ? 'scheduling-status-update' : undefined}>
        <p className="mt-3 text-sm leading-6 text-zinc-700">{presentation.message}</p>
        {presentation.timestamp ? <p className="mt-2 text-xs text-zinc-500">{presentation.timeLabel} {formatTimestamp(presentation.timestamp, timezone)}</p> : null}
      </div>
    </section>
  )
}
