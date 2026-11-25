'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { validateCommercialInterest, v2QuestionOptions, type V2Answers } from '@/lib/survey/questions'

type Stage = 'loading' | 'intro' | 'questions' | 'product' | 'call' | 'thanks'
type QuestionKey = keyof typeof v2QuestionOptions
type Choice = string | string[]
type Payload = Record<string, unknown>

const questionOrder: QuestionKey[] = [
  'specialty', 'call_handler', 'appointment_channels', 'missed_calls', 'obstacle',
  'missed_call_followup', 'missed_calls_volume', 'assistant_concerns', 'commercial_interest',
]

const questionTitles: Record<QuestionKey, string> = {
  specialty: '¿Cuál es tu especialidad médica?',
  call_handler: '¿Quién atiende las llamadas y agenda las citas en tu consultorio?',
  appointment_channels: '¿Por qué medios piden cita tus pacientes?',
  missed_calls: '¿Con qué frecuencia quedan llamadas de pacientes sin contestar?',
  obstacle: '¿Cuál es el principal obstáculo para contestar todas las llamadas?',
  missed_call_followup: 'Cuando no pueden contestar, ¿qué sucede normalmente?',
  missed_calls_volume: 'Aproximadamente, ¿cuántas llamadas a la semana crees que se pierden?',
  assistant_concerns: '¿Qué te preocuparía de usar algo así?',
  commercial_interest: '¿Te gustaría escuchar cómo HelloPx atendería las llamadas de tu propio consultorio?',
}

const interestLabels: Record<string, string> = {
  personalized_demo: 'Sí, quiero una demostración personalizada.',
  information: 'Tal vez, me gustaría conocer más.',
  none: 'No por ahora.',
}

async function send(payload: Payload, signal?: AbortSignal) {
  const response = await fetch('/api/survey', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error. Intenta de nuevo.')
  return data as { state?: string; error?: string }
}

function Progress({ current, total }: { current: number; total: number }) {
  return <div className="mb-8 flex items-center gap-3">
    <span className="text-sm font-semibold text-[#258db0]">{current} de {total}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#dce9ee]">
      <div className="h-full bg-[#258db0] transition-all" style={{ width: `${(current / total) * 100}%` }} />
    </div>
  </div>
}

export function SurveyFlow({ demoNumber }: { demoNumber: string | null }) {
  const [stage, setStage] = useState<Stage>('loading')
  const [questionKey, setQuestionKey] = useState<QuestionKey>('specialty')
  const [answers, setAnswers] = useState<Partial<Record<QuestionKey, Choice>>>({})
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [startPending, setStartPending] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [consent, setConsent] = useState(false)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const startTokenRef = useRef<string | null>(null)
  const ignoreStoredStartTokenRef = useRef(false)

  function clearStartToken() {
    startTokenRef.current = null
    ignoreStoredStartTokenRef.current = true
    try { window.sessionStorage.removeItem('hellopx-survey-start-token') } catch { /* session storage can be unavailable */ }
  }

  function getStartToken() {
    if (startTokenRef.current) return startTokenRef.current
    const storageKey = 'hellopx-survey-start-token'
    let token: string | null = null
    if (!ignoreStoredStartTokenRef.current) {
      try { token = window.sessionStorage.getItem(storageKey) } catch { /* session storage can be unavailable */ }
    }
    ignoreStoredStartTokenRef.current = false
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(32))
      token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
      try { window.sessionStorage.setItem(storageKey, token) } catch { /* in-memory token still deduplicates retries */ }
    }
    startTokenRef.current = token
    return token
  }

  async function createV2Session(signal: AbortSignal) {
    let result = await send({ action: 'start', start_token: getStartToken() }, signal)
    if (result.state === 'legacy') {
      clearStartToken()
      result = await send({ action: 'start', start_token: getStartToken() }, signal)
      if (result.state === 'legacy') throw new Error('No pudimos preparar una sesión nueva. Recarga la página e intenta de nuevo.')
    }
    try { window.sessionStorage.removeItem('hellopx-survey-start-token') } catch { /* safe to retain only in memory */ }
  }

  function ensureSurveySession() {
    if (startPromiseRef.current) return startPromiseRef.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    const promise = createV2Session(controller.signal)
      .catch((caught: unknown) => {
        startPromiseRef.current = null
        if (controller.signal.aborted) throw new Error('El inicio tardó demasiado. Puedes continuar y volveremos a intentarlo al guardar tus respuestas.')
        throw caught instanceof Error ? caught : new Error('No pudimos iniciar la encuesta. Revisa tu conexión e intenta de nuevo.')
      })
      .finally(() => window.clearTimeout(timeout))
    startPromiseRef.current = promise
    return promise
  }

  useEffect(() => {
    fetch('/api/survey', { cache: 'no-store' }).then(response => response.json()).then(data => {
      if (data.state === 'completed') setStage('thanks')
      else if (data.state === 'started' && data.survey_version === 'v2') setStage('questions')
      else setStage('intro')
    }).catch(() => setStage('intro'))
  }, [])

  const visibleQuestions = questionOrder.filter(key => !(answers.missed_calls === 'Nunca' &&
    ['obstacle', 'missed_call_followup', 'missed_calls_volume'].includes(key)))
  const position = Math.max(0, visibleQuestions.indexOf(questionKey))
  const selected = answers[questionKey]
  const isMultiple = questionKey === 'appointment_channels' || questionKey === 'assistant_concerns'
  const isCommercialInterest = questionKey === 'commercial_interest'
  const extraField = questionKey === 'specialty' && selected === 'Otra'
    ? 'specialty_other'
    : questionKey === 'call_handler' && selected === 'Otro'
      ? 'call_handler_other'
      : questionKey === 'obstacle' && selected === 'Otro'
        ? 'obstacle_other'
        : questionKey === 'assistant_concerns' && Array.isArray(selected) && selected.includes('Otra')
          ? 'assistant_concerns_other'
          : null

  async function startSurvey() {
    if (startPending || startPromiseRef.current) return
    setStartPending(true)
    setError('')
    setQuestionKey('specialty')
    setStage('questions')
    try { await ensureSurveySession() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No pudimos iniciar la encuesta. Revisa tu conexión e intenta de nuevo.') }
    finally { setStartPending(false) }
  }

  function choose(option: string) {
    setError('')
    if (isCommercialInterest && option === 'none') {
      setName('')
      setWhatsapp('')
      setConsent(false)
    }
    setAnswers(current => {
      if (isCommercialInterest) return { ...current, [questionKey]: option }
      if (!isMultiple) return { ...current, [questionKey]: option }
      const currentValues = Array.isArray(current[questionKey]) ? current[questionKey] as string[] : []
      if (questionKey === 'assistant_concerns' && option === 'Nada, no me preocupa') {
        return { ...current, [questionKey]: currentValues.includes(option) ? [] : [option] }
      }
      const withoutExclusive = questionKey === 'assistant_concerns' ? currentValues.filter(value => value !== 'Nada, no me preocupa') : currentValues
      return { ...current, [questionKey]: withoutExclusive.includes(option) ? withoutExclusive.filter(value => value !== option) : [...withoutExclusive, option] }
    })
  }

  function visiblePrevious(key: QuestionKey) {
    const index = visibleQuestions.indexOf(key)
    return visibleQuestions[Math.max(0, index - 1)]
  }

  function goBack() {
    setError('')
    if (stage === 'product') {
      setStage('questions')
      setQuestionKey(visiblePrevious('assistant_concerns'))
      return
    }
    if (stage === 'call') {
      setStage('questions')
      setQuestionKey('assistant_concerns')
      return
    }
    if (stage === 'questions' && questionKey !== visibleQuestions[0]) {
      if (questionKey === 'commercial_interest') {
        setStage('call')
        return
      }
      if (questionKey === 'assistant_concerns') {
        setStage('product')
        return
      }
      const previous = visiblePrevious(questionKey)
      setQuestionKey(previous)
    }
  }

  async function recordDemoChoice(wantsDemo: boolean) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await ensureSurveySession()
      await send({ action: 'demo', wants_demo: wantsDemo })
      setStage('questions')
      setQuestionKey('commercial_interest')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos guardar tu respuesta. Revisa tu conexión e intenta de nuevo.')
    } finally { setPending(false) }
  }

  function trackCallClick() {
    const payload = JSON.stringify({ action: 'call' })
    if (!navigator.sendBeacon('/api/survey', new Blob([payload], { type: 'application/json' }))) {
      void send({ action: 'call' }).catch(() => setError('No pudimos registrar el clic. Puedes continuar y volver a intentarlo después.'))
    }
    setQuestionKey('commercial_interest')
    setStage('questions')
  }

  function buildAnswers(): V2Answers {
    const neverMissed = answers.missed_calls === 'Nunca'
    const concerns = Array.isArray(answers.assistant_concerns) ? answers.assistant_concerns : []
    const storedConcerns = concerns.map(value => value === 'Otra'
      ? `Otra: ${extra.assistant_concerns_other.trim()}`
      : value)
    return {
      specialty: answers.specialty as string,
      specialty_other: answers.specialty === 'Otra' ? extra.specialty_other.trim() : null,
      call_handler: answers.call_handler === 'Otro' ? `Otro: ${extra.call_handler_other.trim()}` : answers.call_handler as string,
      appointment_channels: answers.appointment_channels as string[],
      missed_calls: answers.missed_calls as string,
      obstacle: neverMissed ? null : answers.obstacle as string,
      obstacle_other: !neverMissed && answers.obstacle === 'Otro' ? extra.obstacle_other.trim() : null,
      missed_call_followup: neverMissed ? null : answers.missed_call_followup as string,
      missed_calls_volume: neverMissed ? null : answers.missed_calls_volume as string,
      assistant_concerns: storedConcerns,
    }
  }

  async function advance() {
    if (selected == null || (Array.isArray(selected) && selected.length === 0)) {
      setError('Selecciona una respuesta para continuar.')
      return
    }
    if (extraField && !extra[extraField]?.trim()) {
      setError('Especifica tu respuesta para continuar.')
      return
    }
    if (isCommercialInterest && selected !== 'none') {
      const hasSomeContact = !!name.trim() || !!whatsapp.trim()
      if (hasSomeContact && (name.trim().length < 2 || !/^\+?[0-9\s()-]{8,25}$/.test(whatsapp.trim()) || !consent)) {
        setError('Completa tu nombre y WhatsApp y acepta el consentimiento para que podamos contactarte.')
        return
      }
    }

    setError('')
    if (questionKey === 'assistant_concerns') {
      setPending(true)
      try {
        await ensureSurveySession()
        setStage('call')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No pudimos preparar la llamada de prueba. Revisa tu conexión e intenta de nuevo.')
      } finally { setPending(false) }
      return
    }
    if (!isCommercialInterest) {
      const next = visibleQuestions[position + 1]
      if (next === 'assistant_concerns') setStage('product')
      else if (next) setQuestionKey(next)
      return
    }

    if (!validateCommercialInterest(selected)) {
      setError('Selecciona una respuesta para continuar.')
      return
    }
    let answersPayload: V2Answers
    try { answersPayload = buildAnswers() }
    catch { setError('Completa las respuestas pendientes antes de finalizar.'); return }
    const hasContact = selected !== 'none' && (!!name.trim() || !!whatsapp.trim())
    const contact = hasContact
      ? { name: name.trim(), method: 'whatsapp', value: whatsapp.trim(), consent }
      : { name: null, method: null, value: null, consent: false }

    setPending(true)
    try {
      await ensureSurveySession()
      await send({ action: 'complete', survey_version: 'v2', answers: answersPayload, interest: selected, ...contact }, AbortSignal.timeout(10000))
      setStage('thanks')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos guardar tus respuestas. Revisa tu conexión e intenta de nuevo.')
    } finally { setPending(false) }
  }

  return <div className="min-h-screen bg-[#f7fafb] text-[#17232b]">
    <header className="border-b border-[#e0e9ed] bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-2 text-xl font-semibold tracking-[-.03em]"><Image src="/logo.png?v=2" alt="" width={30} height={30} /><span>Hello<span className="text-[#258db0]">Px</span></span></Link><span aria-hidden="true" />
    </div></header>
    <main className="mx-auto flex min-h-[calc(100vh-144px)] max-w-4xl items-center px-5 py-10 sm:px-8">
      <section className="w-full max-w-2xl">
        {stage === 'loading' && <p role="status">Cargando encuesta…</p>}
        {stage === 'intro' && <>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.12em] text-[#258db0]">Encuesta para médicos</p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-[-.035em] sm:text-5xl">Queremos conocer <span className="text-[#258db0]">tu experiencia.</span></h1>
          <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-[#52646f]">¿Cuántas llamadas de pacientes se quedan sin contestar mientras estás en consulta o fuera de horario?</p>
          <p className="mt-3 max-w-xl text-lg leading-8 text-[#52646f]">Estamos creando HelloPx, un asistente telefónico con IA que atiende llamadas y ayuda a agendar citas.</p>
          <div className="mt-7 grid gap-6 rounded-2xl border border-[#e0e9ed] bg-white p-6 shadow-[0_12px_36px_#17232b12] sm:grid-cols-[1.2fr_.8fr] sm:items-center sm:gap-8 sm:p-8">
            <div className="flex flex-col items-start"><p className="text-xs font-semibold uppercase tracking-[.08em] text-[#258db0]">~3 MINUTOS · 9 PREGUNTAS</p><p className="mt-3 text-xl font-semibold tracking-[-.02em] text-[#17232b]">Tu experiencia nos ayuda a crear algo realmente útil.</p></div>
            <div className="flex flex-col items-start sm:items-end"><button className="inline-flex items-center gap-2 rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white transition-colors hover:bg-[#304653] disabled:opacity-50" disabled={startPending} onClick={startSurvey}>Comenzar <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#61727c]">No solicitamos datos de pacientes. <Link className="underline underline-offset-4" href="/privacy">Aviso de privacidad</Link></p>
        </>}
        {stage === 'questions' && <>
          <Progress current={position + 1} total={visibleQuestions.length} />
          <h1 className="text-3xl font-semibold tracking-[-.03em] sm:text-4xl">{questionTitles[questionKey]}</h1>
          {(questionKey === 'appointment_channels' || questionKey === 'assistant_concerns') && <p className="mt-3 text-sm text-[#61727c]">Puedes elegir varias opciones.</p>}
          <div className="mt-8 grid gap-3">{(isCommercialInterest ? Object.keys(interestLabels) : v2QuestionOptions[questionKey]).map(option => {
            const active = Array.isArray(selected) ? selected.includes(option) : selected === option
            return <button key={option} type="button" aria-pressed={active} className={`min-h-14 rounded-xl border px-5 py-3 text-left font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#258db0] ${active ? 'border-[#258db0] bg-[#e8f5f9] text-[#145b73]' : 'border-[#d6e2e7] bg-white hover:border-[#88b9c8]'}`} onClick={() => choose(option)}>{isCommercialInterest ? interestLabels[option] : option}</button>
          })}</div>
          {extraField && <label className="mt-5 block text-sm font-medium">Especifica tu respuesta<input maxLength={120} value={extra[extraField] || ''} onChange={event => setExtra({ ...extra, [extraField]: event.target.value })} className="mt-2 w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3 outline-[#258db0]" /></label>}
          {isCommercialInterest && (selected === 'personalized_demo' || selected === 'information') && <div className="mt-7 rounded-2xl border border-[#e0e9ed] bg-white p-5">
            <p className="text-sm leading-6 text-[#52646f]">Déjanos tus datos y te contactaremos en los próximos días para preparar una demostración de HelloPx adaptada a tu consultorio.</p>
            <label className="mt-4 block text-sm font-medium">Nombre<input autoComplete="name" value={name} maxLength={120} onChange={event => setName(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3" /></label>
            <label className="mt-4 block text-sm font-medium">WhatsApp<input type="tel" autoComplete="tel" value={whatsapp} maxLength={25} onChange={event => setWhatsapp(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3" /></label>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-[#52646f]"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1.5 accent-[#258db0]" /><span>Autorizo a HelloPx a contactarme para hablar sobre una demostración personalizada.</span></label>
          </div>}
          <div className="mt-8 flex items-center justify-between gap-4"><button className="text-sm font-medium text-[#52646f] underline underline-offset-4 disabled:opacity-40" disabled={questionKey === visibleQuestions[0] || pending} onClick={goBack}>Anterior</button><button className="rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white transition-colors hover:bg-[#304653] disabled:opacity-50" disabled={pending} onClick={advance}>{pending ? 'Guardando…' : isCommercialInterest ? 'Finalizar encuesta' : questionKey === 'assistant_concerns' ? 'Continuar' : 'Siguiente'}</button></div>
        </>}
        {stage === 'product' && <>
          <Progress current={position + 1} total={visibleQuestions.length} />
          <h1 className="text-3xl font-semibold tracking-[-.03em] sm:text-4xl">Así funcionaría <span className="text-[#258db0]">HelloPx</span></h1>
          <p className="mt-3 text-base leading-7 text-[#52646f] sm:text-lg sm:leading-8">Un asistente telefónico con inteligencia artificial que atiende a tus pacientes de manera inmediata, incluso fuera de horario.</p>
          <div className="mt-6 divide-y divide-[#e6edf0]">
            <div className="flex w-full items-center gap-4 py-5 first:pt-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef3f5] sm:h-12 sm:w-12">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-[#258db0] sm:h-[22px] sm:w-[22px]"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.35 1.84.58 2.8.7a2 2 0 0 1 1.72 2.04Z" /><path d="M15 2h7v7" /><path d="m22 2-7 7" /></svg>
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#17232b] sm:text-lg">Contesta llamadas</h2>
                <p className="mt-1 text-sm leading-6 text-[#52646f]">Atiende las llamadas de tus pacientes.</p>
              </div>
            </div>
            <div className="flex w-full items-center gap-4 py-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef3f5] sm:h-12 sm:w-12">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-[#258db0] sm:h-[22px] sm:w-[22px]"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4Z" /><path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2.8-2.8 2.8" /><path d="M12 16h.01" /></svg>
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#17232b] sm:text-lg">Responde preguntas</h2>
                <p className="mt-1 text-sm leading-6 text-[#52646f]">Horarios, ubicación, costos y otras dudas administrativas.</p>
              </div>
            </div>
            <div className="flex w-full items-center gap-4 py-5 last:pb-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef3f5] sm:h-12 sm:w-12">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-[#258db0] sm:h-[22px] sm:w-[22px]"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 15 2 2 4-4" /></svg>
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#17232b] sm:text-lg">Agenda citas automáticamente</h2>
                <p className="mt-1 text-sm leading-6 text-[#52646f]">Consulta disponibilidad y registra las citas.</p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-start gap-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-[#61727c]"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <p className="text-sm leading-6 text-[#61727c]">HelloPx funciona mediante llamadas telefónicas, no como un bot de WhatsApp. No proporciona diagnósticos ni recomendaciones médicas.</p>
          </div>
          <div className="mt-8 flex items-center justify-between"><button className="text-sm font-medium text-[#52646f] underline underline-offset-4" onClick={goBack}>Anterior</button><button className="rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white transition-colors hover:bg-[#304653]" onClick={() => { setStage('questions'); setQuestionKey('assistant_concerns') }}>Continuar</button></div>
        </>}
        {stage === 'call' && <>
          <Progress current={position + 1} total={visibleQuestions.length} />
          <h1 className="text-3xl font-semibold tracking-[-.03em] sm:text-4xl">Escucha HelloPx en acción</h1>
          <p className="mt-5 text-lg leading-8 text-[#52646f]">Prueba cómo funciona nuestro asistente telefónico. Llama a un consultorio ficticio, simula ser un paciente y solicita una cita.</p>
          {demoNumber ? <><a href={`tel:${demoNumber}`} onClick={trackCallClick} className="mt-7 inline-block rounded-xl bg-[#258db0] px-6 py-3 font-medium text-white transition-colors hover:bg-[#1f7897]">Llamar y probar HelloPx</a><p className="mt-4 text-sm text-[#52646f]">¿Estás en computadora? Llama al {demoNumber.replace(/^(\+\d)(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3 $4')} desde tu celular.</p></> : <p role="alert" className="mt-7 text-sm text-[#52646f]">La llamada de prueba no está disponible en este momento.</p>}
          <div className="mt-8 flex items-center justify-between gap-4"><button className="text-sm font-medium text-[#52646f] underline underline-offset-4" onClick={goBack}>Anterior</button><button disabled={pending} className="rounded-xl border border-[#c6d5dc] bg-white px-6 py-3 font-medium disabled:opacity-50" onClick={() => recordDemoChoice(false)}>{pending ? 'Guardando…' : 'Continuar sin llamar'}</button></div>
        </>}
        {stage === 'thanks' && <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f5f9] text-[#258db0]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="m5 12 4 4L19 6" /></svg>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-.035em]">¡Muchas gracias por tu tiempo!</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[#52646f]">Tus respuestas nos ayudan a construir algo realmente útil, queremos que tu consultorio esté siempre disponible, con atención inmediata y no se te vaya ningún paciente.</p>
          <Link href="/" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#258db0] px-6 py-3 font-medium text-white transition-colors hover:bg-[#1f7897]">Visitar HelloPx<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M7 17 17 7M7 7h10v10" /></svg></Link>
        </div>}
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      </section>
    </main>
    <footer className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 border-t border-[#e0e9ed] px-5 py-5 text-xs text-[#61727c] sm:px-8"><span className="font-semibold">Hello<span className="text-[#258db0]">Px</span></span><Link href="/privacy" className="underline underline-offset-4">Aviso de privacidad</Link></footer>
  </div>
}
