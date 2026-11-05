'use client'

import { useEffect, useState, type CSSProperties } from 'react'

type Speaker = 'Px' | 'HelloPx'
type Utterance = { who: Speaker; text: string }
type Outcome = { kind: 'loading'; id: number } | { kind: 'result'; id: number; text: string }

const lines: Utterance[] = [
  { who: 'Px', text: 'Buenas tardes, ¿tienen lugar esta semana?' },
  { who: 'HelloPx', text: 'Claro. ¿Es primera consulta o seguimiento?' },
  { who: 'Px', text: 'Seguimiento.' },
  { who: 'HelloPx', text: 'Tengo el jueves a las 11:30 o el viernes a las 9:00.' },
  { who: 'Px', text: 'El jueves.' },
  { who: 'HelloPx', text: 'Muy bien, queda agendado jueves 11:30. Lo esperamos.' },
]

const barHeights = Array.from({ length: 19 }, (_, index) => 6 + Math.round(Math.abs(Math.sin(index * 0.81) * Math.cos(index * 0.16)) * 22))

export default function HeroConversation() {
  const [transcript, setTranscript] = useState<Utterance[]>([])
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [speaker, setSpeaker] = useState<Speaker>('HelloPx')
  const [isSpeaking, setIsSpeaking] = useState(false)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let timers: number[] = []

    const clearTimers = () => {
      timers.forEach(window.clearTimeout)
      timers = []
    }
    const later = (callback: () => void, delay: number) => {
      timers.push(window.setTimeout(callback, delay))
    }
    const addOutcome = (text: string) => {
      setIsSpeaking(false)
      setOutcomes((current) => [...current.filter((item) => item.kind !== 'loading'), { kind: 'result', id: Date.now(), text }])
    }

    const cycle = () => {
      clearTimers()
      setTranscript([])
      setOutcomes([])
      setIsSpeaking(false)

      if (reducedMotion) {
        setTranscript(lines)
        setSpeaker('Px')
        setIsSpeaking(false)
        setOutcomes([
          { kind: 'result', id: 1, text: 'Cita registrada: jueves, 11:30 a. m.' },
          { kind: 'result', id: 2, text: 'Recordatorio programado: miércoles, 5:00 p. m.' },
        ])
        return
      }

      lines.forEach((line, index) => later(() => {
        setTranscript((current) => [...current, line])
        setSpeaker(line.who)
        setIsSpeaking(true)
      }, 450 + index * 1850))

      later(() => {
        setOutcomes([{ kind: 'loading', id: 1 }])
        later(() => addOutcome('Cita registrada: jueves, 11:30 a. m.'), 850)
      }, 10200)

      later(() => {
        setOutcomes((current) => [...current, { kind: 'loading', id: 2 }])
        later(() => addOutcome('Recordatorio programado: miércoles, 5:00 p. m.'), 1000)
      }, 12400)

      later(cycle, 18500)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        clearTimers()
        setIsSpeaking(false)
      }
      else if (!reducedMotion) cycle()
    }

    later(cycle, 0)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearTimers()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return (
    <div className="call" aria-label="Demostración animada de una llamada">
      <div className="call-head">
        <span className="call-title"><span><i className="live" />Llamada en curso</span><span className="quiet">Consultorio de la Dra. Ruiz</span></span>
        <div className={`wave${isSpeaking ? ' is-speaking' : ''}`} aria-hidden="true" style={{ color: speaker === 'HelloPx' ? '#258db0' : '#9aa4ab' }}>
          {barHeights.map((height, index) => <i key={index} style={{ '--h': `${height}px`, '--dur': `${0.7 + (index % 6) * 0.13}s`, '--delay': `${-index * 0.08}s` } as CSSProperties} />)}
        </div>
      </div>
      <div className="transcript" aria-live="off">
        {transcript.map((line, index) => <div key={`${index}-${line.who}`} className={`utterance ${line.who === 'HelloPx' ? 'agent' : ''}`}><span className="speaker">{line.who}</span><span className="words">{line.text}</span></div>)}
      </div>
      <div className="outcomes">
        {outcomes.map((outcome) => outcome.kind === 'loading'
          ? <div key={outcome.id} className="loading" aria-label="Procesando"><i/><i/><i/></div>
          : <div key={outcome.id} className="outcome"><b>✓</b><span>{outcome.text}</span></div>)}
      </div>
      <div className="call-foot"><span>Voz activa</span><span>Atendiendo llamada</span></div>
    </div>
  )
}
