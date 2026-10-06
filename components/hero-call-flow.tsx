'use client'

import { useEffect, useState } from 'react'

type Phase = 0 | 1 | 2 | 3 | 4 | 5

const phaseDurations: Record<Phase, number> = {
  0: 1000,
  1: 1300,
  2: 1400,
  3: 1100,
  4: 1100,
  5: 1900,
}

export default function HeroCallFlow() {
  const [phase, setPhase] = useState<Phase>(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase(5)
      return
    }

    let timeout: ReturnType<typeof setTimeout>

    const advance = (currentPhase: Phase) => {
      timeout = setTimeout(() => {
        const nextPhase = currentPhase === 5 ? 0 : ((currentPhase + 1) as Phase)
        setPhase(nextPhase)
        advance(nextPhase)
      }, phaseDurations[currentPhase])
    }

    advance(0)

    return () => clearTimeout(timeout)
  }, [])

  const showStatus = phase >= 1
  const isCheckingAvailability = phase === 2
  const showSchedule = phase >= 3
  const showSelection = phase >= 4
  const showReady = phase >= 5

  return (
    <div aria-label="Vista conceptual del trabajo de HelloPx" className="relative">
      <div className="absolute -inset-5 rounded-[2rem] bg-zinc-50" aria-hidden="true" />
      <div className="relative rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_70px_-32px_rgba(24,24,27,0.35)] sm:p-7">
        <div className="flex items-center border-b border-zinc-200 pb-5">
          <div>
            <p className="text-sm font-semibold text-zinc-950">HelloPx</p>
            <p className="mt-1 text-xs text-zinc-600">Disponible 24/7</p>
          </div>
        </div>

        <div className="space-y-5 py-6">
          <div className="rounded-xl bg-zinc-950 p-4 text-white">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">Llamada entrante</p>
            <p className="mt-3 text-base leading-6">“Quiero agendar una cita”</p>
          </div>

          <div className="min-h-6" aria-live="polite">
            {showStatus ? (
              <div key={phase < 3 ? phase : 'status'} className="hero-step-enter flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full bg-[#258db0] ${isCheckingAvailability ? 'hero-call-pulse' : ''}`} aria-hidden="true" />
                <p className="text-sm font-medium text-zinc-900">
                  {isCheckingAvailability ? (
                    <>
                      Consultando disponibilidad<span className="hero-typing-dots" aria-hidden="true">…</span>
                    </>
                  ) : (
                    'HelloPx está atendiendo'
                  )}
                </p>
              </div>
            ) : null}
          </div>

          <div className="min-h-[102px] border-t border-zinc-200 pt-5">
            {showSchedule ? (
              <div key="schedule" className="hero-step-enter">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">Horarios disponibles</p>
                  {showSelection ? <span className="text-xs text-zinc-500">Paciente elige</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['09:30', '11:00', '16:30'].map((slot) => {
                    const isSelected = showSelection && slot === '11:00'

                    return (
                      <span
                        key={slot}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors duration-200 ${isSelected ? 'border-[#258db0] bg-[#258db0]/10 text-zinc-950' : 'border-zinc-200 bg-zinc-50 text-zinc-700'}`}
                      >
                        {slot}
                      </span>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-12 border-t border-zinc-200 pt-5">
            {showReady ? (
              <div key="ready" className="hero-step-enter flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-500" aria-hidden="true">✓</span>
                <p className="text-sm font-medium text-zinc-900">Solicitud lista para agendar</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
