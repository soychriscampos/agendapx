'use client'

import { useState } from 'react'

const modes = {
  all: 'HelloPx atiende todas las llamadas que entran al número de tu consultorio.',
  miss: 'HelloPx entra cuando tú o tu equipo están atendiendo o fuera de horario.',
}

export default function ModeSelector() {
  const [mode, setMode] = useState<'all' | 'miss'>('all')

  return (
    <>
      <div className="segmented" role="group" aria-label="Modo de atención">
        <button type="button" className={mode === 'all' ? 'active' : ''} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Todas las llamadas</button>
        <button type="button" className={mode === 'miss' ? 'active' : ''} aria-pressed={mode === 'miss'} onClick={() => setMode('miss')}>Sólo las que no contestas</button>
      </div>
      <p className="mode-copy" aria-live="polite">{modes[mode]}</p>
    </>
  )
}
