'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { questions, type Answers } from '@/lib/survey/questions'

type Stage = 'loading' | 'intro' | 'questions' | 'invite' | 'call' | 'interest' | 'thanks'
type Payload = Record<string, unknown>

async function send(payload: Payload, signal?: AbortSignal) {
  const response = await fetch('/api/survey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error. Intenta de nuevo.')
  return data
}

export function SurveyFlow({ demoNumber }: { demoNumber: string | null }) {
  const [stage, setStage] = useState<Stage>('loading')
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [startPending, setStartPending] = useState(false)
  const [error, setError] = useState('')
  const [interest, setInterest] = useState<'personalized_demo' | 'information' | 'none' | null>(null)
  const [name, setName] = useState('')
  const [method, setMethod] = useState<'email' | 'phone' | 'whatsapp'>('email')
  const [value, setValue] = useState('')
  const [consent, setConsent] = useState(false)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const startTokenRef = useRef<string | null>(null)

  function getStartToken() {
    if (startTokenRef.current) return startTokenRef.current
    const storageKey = 'hellopx-survey-start-token'
    let token: string | null = null
    try { token = window.sessionStorage.getItem(storageKey) } catch { /* session storage can be unavailable */ }
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(32))
      token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      try { window.sessionStorage.setItem(storageKey, token) } catch { /* in-memory token still deduplicates retries */ }
    }
    startTokenRef.current = token
    return token
  }

  function ensureSurveySession() {
    if (startPromiseRef.current) return startPromiseRef.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    const promise = send({ action: 'start', start_token: getStartToken() }, controller.signal)
      .then(() => {
        try { window.sessionStorage.removeItem('hellopx-survey-start-token') } catch { /* safe to retain only in memory */ }
      })
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
    fetch('/api/survey', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      if (data.state === 'completed') setStage(data.commercial_interest ? 'thanks' : data.wants_demo === null ? 'invite' : data.wants_demo ? 'call' : 'thanks')
      else if (data.state === 'started') setStage('questions')
      else setStage('intro')
    }).catch(() => setStage('intro'))
  }, [])

  async function run(payload: Payload, next: Stage) {
    if (pending) return
    setPending(true); setError('')
    try { await send(payload); setStage(next) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Intenta de nuevo.') }
    finally { setPending(false) }
  }

  async function startSurvey() {
    if (startPending || startPromiseRef.current) return
    setStartPending(true)
    setError('')
    setStage('questions')
    try {
      await ensureSurveySession()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos iniciar la encuesta. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setStartPending(false)
    }
  }

  const question = questions[index]
  const selected = question ? answers[question.key] : undefined
  const needsExtra = (question?.key === 'specialty' && selected === 'Otra') || (question?.key === 'obstacle' && selected === 'Otro')

  async function advance() {
    if (!selected || (Array.isArray(selected) && !selected.length) || (needsExtra && !extra[question.key]?.trim())) {
      setError('Selecciona una respuesta para continuar.'); return
    }
    setError('')
    if (index < questions.length - 1) { setIndex(index + 1); return }
    const payload: Answers = {
      specialty: answers.specialty as string, specialty_other: extra.specialty,
      call_handler: answers.call_handler as string, appointment_channels: answers.appointment_channels as string[],
      missed_calls: answers.missed_calls as string, obstacle: answers.obstacle as string,
      obstacle_other: extra.obstacle, missed_call_followup: answers.missed_call_followup as string,
      assistant_usefulness: answers.assistant_usefulness as string,
    }
    setPending(true)
    try {
      await ensureSurveySession()
      await send({ action: 'complete', answers: payload }, AbortSignal.timeout(10000))
      setStage('invite')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos guardar tus respuestas. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return <div className="min-h-screen bg-[#f7fafb] text-[#17232b]">
    <header className="border-b border-[#e0e9ed] bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-2 text-xl font-semibold tracking-[-.03em]"><Image src="/logo.png?v=2" alt="" width={30} height={30} /><span>Hello<span className="text-[#258db0]">Px</span></span></Link>
      <span aria-hidden="true" />
    </div></header>
    <main className="mx-auto flex min-h-[calc(100vh-144px)] max-w-4xl items-center px-5 py-10 sm:px-8">
      <section className="w-full max-w-2xl">
        {stage === 'loading' && <p role="status">Cargando encuesta…</p>}
        {stage === 'intro' && <><p className="mb-3 text-xs font-semibold uppercase tracking-[.12em] text-[#258db0]">Encuesta para médicos</p><h1 className="max-w-xl text-4xl font-semibold tracking-[-.035em] sm:text-5xl">Queremos conocer <span className="text-[#258db0]">tu experiencia.</span></h1><p className="mt-6 max-w-xl text-lg leading-8 text-[#52646f]">Estamos creando un asistente con IA que ayuda a los consultorios a atender las llamadas de sus px y gestionar citas por teléfono. Queremos conocer cómo lo hacen hoy y qué desafíos enfrentan.</p><div className="mt-7 grid gap-7 rounded-2xl border border-[#e0e9ed] bg-white p-6 shadow-[0_12px_36px_#17232b12] sm:grid-cols-[1.2fr_.8fr] sm:gap-8 sm:p-8"><div className="flex flex-col items-start"><p className="text-xs font-semibold uppercase tracking-[.08em] text-[#258db0]">~2 minutos · 7 preguntas</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.025em] text-[#17232b]">Tu experiencia nos ayuda a crear algo realmente útil.</h2></div><div className="flex flex-col items-start pt-6 sm:pt-7"><button className="inline-flex items-center gap-2 rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white hover:bg-[#304653] disabled:opacity-50" disabled={pending} onClick={startSurvey}>{pending ? 'Iniciando…' : <>Comenzar <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></>}</button></div></div><p className="mt-4 text-xs leading-5 text-[#61727c]">No solicitamos datos de pacientes. <Link className="underline underline-offset-4" href="/privacy">Aviso de privacidad</Link></p></>}
        {stage === 'questions' && question && <>
          <div className="mb-8 flex items-center gap-3"><span className="text-sm font-semibold text-[#258db0]">{index + 1} de {questions.length}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#dce9ee]"><div className="h-full bg-[#258db0] transition-all" style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div></div>
          <h1 className="text-3xl font-semibold tracking-[-.03em] sm:text-4xl">{question.title}</h1>
          {'multiple' in question && <p className="mt-3 text-sm text-[#61727c]">Puedes elegir varias opciones.</p>}
          <div className="mt-8 grid gap-3">{question.options.map((option) => {
            const active = Array.isArray(selected) ? selected.includes(option) : selected === option
            return <button key={option} type="button" aria-pressed={active} className={`min-h-14 rounded-xl border px-5 py-3 text-left font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#258db0] ${active ? 'border-[#258db0] bg-[#e8f5f9] text-[#145b73]' : 'border-[#d6e2e7] bg-white hover:border-[#88b9c8]'}`} onClick={() => {
              setError('')
              if ('multiple' in question) {
                const current = Array.isArray(selected) ? selected : []
                setAnswers({ ...answers, [question.key]: active ? current.filter((item) => item !== option) : [...current, option] })
              } else setAnswers({ ...answers, [question.key]: option })
            }}>{option}</button>
          })}</div>
          {needsExtra && <label className="mt-5 block text-sm font-medium">Especifica tu respuesta<input maxLength={120} value={extra[question.key] || ''} onChange={(event) => setExtra({ ...extra, [question.key]: event.target.value })} className="mt-2 w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3 outline-[#258db0]" /></label>}
          <div className="mt-8 flex items-center justify-between gap-4"><button className="text-sm font-medium text-[#52646f] underline underline-offset-4 disabled:opacity-40" disabled={index === 0 || pending} onClick={() => { setIndex(index - 1); setError('') }}>Anterior</button><button className="rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white hover:bg-[#304653] disabled:opacity-50" disabled={pending} onClick={advance}>{pending ? 'Guardando…' : index === 6 ? 'Terminar preguntas' : 'Siguiente'}</button></div>
        </>}
        {stage === 'invite' && <><h1 className="text-4xl font-semibold tracking-[-.035em]">¿Te gustaría conocer HelloPx en acción?</h1><p className="mt-5 text-lg leading-8 text-[#52646f]">Puedes escuchar cómo atiende una solicitud de cita en un consultorio ficticio.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><button className="rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white disabled:opacity-50" disabled={pending} onClick={() => run({ action: 'demo', wants_demo: true }, 'call')}>Sí, escuchar HelloPx</button><button className="rounded-xl border border-[#c6d5dc] bg-white px-6 py-3 font-medium disabled:opacity-50" disabled={pending} onClick={() => run({ action: 'demo', wants_demo: false }, 'thanks')}>Finalizar encuesta</button></div></>}
        {stage === 'call' && <><h1 className="text-4xl font-semibold tracking-[-.035em]">Prueba HelloPx en acción</h1><p className="mt-5 text-lg leading-8 text-[#52646f]">Simula ser un paciente y solicita una cita. Descubre cómo HelloPx atiende tu llamada.</p><a href="tel:+15705198499" onClick={() => { const payload = JSON.stringify({ action: 'call' }); if (!navigator.sendBeacon('/api/survey', new Blob([payload], { type: 'application/json' }))) void send({ action: 'call' }).catch(() => setError('No pudimos registrar el clic. Intenta de nuevo.')) }} className="mt-7 inline-block rounded-xl bg-[#258db0] px-6 py-3 font-medium text-white transition-colors hover:bg-[#1f7897]">Llamar y probar HelloPx</a><p className="mt-4 text-sm text-[#52646f]">¿Estás en computadora? Llama al +1 570 519 8499 desde tu celular.</p><button className="mt-8 rounded-xl border border-[#c6d5dc] bg-white px-6 py-3 font-medium" onClick={() => setStage('interest')}>Continuar</button></>}
        {stage === 'interest' && <><h1 className="text-4xl font-semibold tracking-[-.035em]">¿Te gustaría evaluar HelloPx para tu consultorio?</h1><div className="mt-8 grid gap-3">{[['personalized_demo', 'Sí, quiero una demostración personalizada.'], ['information', 'Me interesa recibir más información.'], ['none', 'Por ahora no.']].map(([key, label]) => <button key={key} className={`rounded-xl border px-5 py-4 text-left font-medium ${interest === key ? 'border-[#258db0] bg-[#e8f5f9]' : 'border-[#d6e2e7] bg-white'}`} onClick={() => setInterest(key as typeof interest)}>{label}</button>)}</div>{interest && interest !== 'none' && <div className="mt-8 grid gap-4"><label className="text-sm font-medium">Tu nombre<input autoComplete="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="mt-2 block w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3" /></label><label className="text-sm font-medium">Medio de contacto<select value={method} onChange={(e) => { setMethod(e.target.value as typeof method); setValue('') }} className="mt-2 block w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3"><option value="email">Correo electrónico</option><option value="phone">Teléfono</option><option value="whatsapp">WhatsApp</option></select></label><label className="text-sm font-medium">{method === 'email' ? 'Correo electrónico' : 'Número de contacto'}<input type={method === 'email' ? 'email' : 'tel'} autoComplete={method === 'email' ? 'email' : 'tel'} value={value} maxLength={160} onChange={(e) => setValue(e.target.value)} className="mt-2 block w-full rounded-xl border border-[#c6d5dc] bg-white px-4 py-3" /></label><label className="flex items-start gap-3 text-sm leading-6 text-[#52646f]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1.5 accent-[#258db0]" /><span>Autorizo a HelloPx a contactarme para atender mi solicitud y enviarme información relacionada con sus servicios, conforme al <Link href="/privacy" target="_blank" className="underline underline-offset-4">aviso de privacidad</Link>.</span></label></div>}<button disabled={!interest || pending} className="mt-8 rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white disabled:opacity-50" onClick={() => run({ action: 'interest', interest, name, method, value, consent }, 'thanks')}>{pending ? 'Guardando…' : 'Enviar respuesta'}</button></>}
        {stage === 'thanks' && <><h1 className="text-4xl font-semibold tracking-[-.035em]">Gracias por compartir tu experiencia.</h1><p className="mt-5 text-lg leading-8 text-[#52646f]">Tus respuestas nos ayudan a mejorar HelloPx para los consultorios médicos.</p><Link href="/" className="mt-8 inline-block rounded-xl bg-[#17232b] px-6 py-3 font-medium text-white">Volver al inicio</Link></>}
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      </section>
    </main>
    <footer className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 border-t border-[#e0e9ed] px-5 py-5 text-xs text-[#61727c] sm:px-8"><span className="font-semibold">Hello<span className="text-[#258db0]">Px</span></span><Link href="/privacy" className="underline underline-offset-4">Aviso de privacidad</Link></footer>
  </div>
}
