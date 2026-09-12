'use client'

/* eslint-disable @typescript-eslint/no-unused-vars */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { DoctorScheduleForm } from '@/components/schedule/doctor-schedule-form'
import { completeDoctorOnboarding, saveDoctorScheduleSettings, updateDoctorProfile } from '@/app/actions'
import { deleteDepositRule, saveAppointmentTypesForOnboarding, saveAssistantSettings, saveDepositRule, saveIntakeFieldsForOnboarding, saveKnowledgeItem, savePaymentInstructions } from '@/lib/assistant/assistant-configuration'
import type { DoctorSchedule } from '@/lib/schedule/doctor-schedule'

type AppointmentType = { id: string; name: string; duration_minutes: number; price: number | null; is_active: boolean }
type EditableAppointmentType = Omit<AppointmentType, 'duration_minutes'> & { duration_minutes: number | null }
type IntakeField = { id: string; field_key: string; label: string; is_required: boolean; is_active: boolean; sort_order: number }
type DepositRule = { id: string; name: string; scope: string; appointment_type_id: string | null; intake_field_id: string | null; operator: string | null; condition_value: string | null; deposit_type: string; deposit_value: number; is_active: boolean }
type DepositDraft = Omit<DepositRule, 'deposit_value'> & { deposit_value: number | null }
type KnowledgeItem = { id: string; title: string; content: string; is_active: boolean; sort_order: number }
type Settings = { assistant_name: string | null; confirmation_enabled: boolean | null; confirmation_lead_minutes: number | null; confirmation_response_window_minutes: number | null; unconfirmed_action: 'CANCEL' | 'MANUAL' | null; manual_follow_up_on_no_answer: boolean }
type Payment = { bank_name: string | null; account_holder: string | null; clabe: string | null; account_number: string | null; instructions: string | null; message_template: string | null }
type Doctor = { display_name: string; specialty: string | null; address: string | null; phone: string | null; whatsapp: string | null }
type CollectionSaveResult = { error?: string; items?: Array<{ index: number; id: string }> }
type DoctorProfileDraft = { displayName: string; specialty: string; address: string }

const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-zinc-700 focus:ring-2 focus:ring-zinc-100'
const commonQuestions = [{ key: 'patient_name', label: 'Nombre del paciente' }, { key: 'phone', label: 'Teléfono' }, { key: 'origin_city', label: 'Ciudad de procedencia' }, { key: 'reason_for_visit', label: 'Motivo de consulta' }, { key: 'age', label: 'Edad' }]
const knowledgeSuggestions = ['Servicios', 'Tratamientos', 'Formas de pago', 'Estacionamiento', 'Indicaciones para llegar', 'Qué cosas no atiende']

function makeData(doctorId: string, values: Record<string, string | number | boolean | null | undefined>) { const data = new FormData(); data.set('doctor_id', doctorId); for (const [key, value] of Object.entries(values)) data.set(key, value == null ? '' : String(value)); return data }
function leadOptionFromMinutes(value: number | null) { return value === 240 ? 'same-day' : value === 1440 ? '1d' : value === 2880 ? '2d' : null }
function responseWindowOptionFromMinutes(value: number | null) { return value === 120 ? '2h' : value === 240 ? '4h' : value === 480 ? '8h' : value === 720 ? '12h' : value === 1440 ? '24h' : null }
function Button({ children, type = 'button', disabled = false, onClick }: { children: React.ReactNode; type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void }) { return <button type={type} disabled={disabled} onClick={onClick} className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button> }
function StepShell({ step, total, title, text, children, onBack, onNext, nextLabel = 'Continuar', pending = false }: { step: number; total: number; title: string; text: string; children: React.ReactNode; onBack?: () => void; onNext?: () => void; nextLabel?: string; pending?: boolean }) { return <main className="min-h-screen bg-[#fafaf9] px-5 py-8 text-zinc-950 sm:px-8 sm:py-12"><div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col"><div className="flex items-center justify-between"><span className="text-sm font-medium tracking-tight">HelloPx</span><span className="text-xs text-zinc-500">{step} de {total}</span></div><div className="mt-5 h-1 rounded-full bg-zinc-200"><div className="h-1 rounded-full bg-zinc-900 transition-all duration-500" style={{ width: `${(step / total) * 100}%` }} /></div><section className="my-auto py-12"><p className="text-sm font-medium text-zinc-500">Capacita a tu asistente</p><h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">{title}</h1><p className="mt-5 max-w-xl text-base leading-7 text-zinc-600">{text}</p><div className="mt-10">{children}</div></section><div className="flex items-center justify-between border-t border-zinc-200 pt-5"><button type="button" onClick={onBack} disabled={!onBack || pending} className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900 disabled:invisible">Atrás</button>{onNext ? <Button onClick={onNext} disabled={pending}>{pending ? 'Guardando…' : nextLabel}</Button> : null}</div></div></main> }

export function OnboardingWizard({ doctorId, doctor, timezone, schedule, settings, payment, appointmentTypes, intakeFields, depositRules, knowledgeItems }: { doctorId: string; doctor: Doctor; timezone: string; schedule: DoctorSchedule; settings: Settings | null; payment: Payment | null; appointmentTypes: AppointmentType[]; intakeFields: IntakeField[]; depositRules: DepositRule[]; knowledgeItems: KnowledgeItem[] }) {
  const configuredAssistantName = settings?.assistant_name?.trim(); const initialAssistantName = configuredAssistantName === 'Asistente HelloPx' ? '' : configuredAssistantName ?? '';
  const router = useRouter(); const [step, setStep] = useState(1); const [showCompletion, setShowCompletion] = useState(false); const [presentationMode, setPresentationMode] = useState(false); const [pending, startTransition] = useTransition(); const [completionPending, startCompletionTransition] = useTransition(); const [error, setError] = useState(''); const [completionError, setCompletionError] = useState(''); const [completionAttempted, setCompletionAttempted] = useState(false); const [assistantName, setAssistantName] = useState(initialAssistantName); const [nameChoice, setNameChoice] = useState<string | null>(null); const [types, setTypes] = useState<EditableAppointmentType[]>(appointmentTypes.map((item) => ({ ...item }))); const [questions, setQuestions] = useState(intakeFields.map((item) => ({ ...item }))); const existingRule = depositRules.find((item) => item.is_active) ?? null; const [wantsDeposit, setWantsDeposit] = useState<boolean | null>(null); const [deposit, setDeposit] = useState<DepositDraft>(existingRule ?? { id: '', name: 'Regla de anticipo', scope: 'ALL', appointment_type_id: null, intake_field_id: null, operator: null, condition_value: null, deposit_type: 'PERCENTAGE', deposit_value: null, is_active: true }); const [paymentDraft, setPaymentDraft] = useState(payment ?? { bank_name: '', account_holder: '', clabe: '', account_number: '', instructions: '', message_template: '' }); const [knowledge, setKnowledge] = useState(knowledgeItems.map((item) => ({ ...item }))); const [wantsConfirmation, setWantsConfirmation] = useState<boolean | null>(null); const [leadOption, setLeadOption] = useState<string | null>(null); const [responseWindowOption, setResponseWindowOption] = useState<string | null>(null); const [unconfirmedAction, setUnconfirmedAction] = useState<string | null>(null); const [manualFollowUp] = useState(settings?.manual_follow_up_on_no_answer ?? true);
  const total = 8; const displayName = assistantName.trim()
  const [doctorName, setDoctorName] = useState(doctor.display_name)
  const [doctorSpecialty, setDoctorSpecialty] = useState(doctor.specialty ?? '')
  const [doctorAddress, setDoctorAddress] = useState(doctor.address ?? '')
  const eligibleIntakeFields = questions.filter((item) => item.field_key !== 'patient_name' && item.field_key !== 'phone')
  const scheduleSaveRef = useRef<Promise<{ error?: string; success?: string }> | null>(null)
  const scheduleFormDataRef = useRef<FormData | null>(null)
  const doctorProfileSaveRef = useRef<Promise<{ error?: string; success?: string }> | null>(null)
  const doctorProfileDraftRef = useRef<DoctorProfileDraft | null>(null)
  const typesSaveRef = useRef<Promise<CollectionSaveResult> | null>(null)
  const questionsSaveRef = useRef<Promise<CollectionSaveResult> | null>(null)
  const confirmationSaveRef = useRef<Promise<{ error?: string; success?: string }> | null>(null)
  const typesDirtyRef = useRef(false)
  const questionsDirtyRef = useRef(false)
  const [completionStatus, setCompletionStatus] = useState<'running' | 'success' | 'error'>('running')
  useEffect(() => {
    const timer = setTimeout(() => { delete document.documentElement.dataset.onboardingDirection }, 320)
    return () => clearTimeout(timer)
  }, [step, presentationMode, showCompletion])
  useEffect(() => { if (showCompletion) document.documentElement.dataset.onboardingDirection = 'forward' }, [showCompletion])
  useEffect(() => () => { delete document.documentElement.dataset.onboardingDirection }, [])
  useEffect(() => {
    if (!settings) return
    const timer = setTimeout(() => {
      setWantsConfirmation(settings.confirmation_enabled ?? null)
      setLeadOption(leadOptionFromMinutes(settings.confirmation_lead_minutes))
      setResponseWindowOption(responseWindowOptionFromMinutes(settings.confirmation_response_window_minutes))
      setUnconfirmedAction(settings.unconfirmed_action === 'CANCEL' ? 'cancel' : settings.unconfirmed_action === 'MANUAL' ? 'manual' : null)
    }, 0)
    return () => clearTimeout(timer)
  }, [settings])
  function recordPersistenceError(message: string) { setError(message); setCompletionError(message) }
  function persistDoctorProfile() {
    const draft = doctorProfileDraftRef.current
    if (!draft) return Promise.resolve({ error: 'No se encontró la información del doctor.' })
    const formData = new FormData()
    formData.set('p_display_name', draft.displayName)
    formData.set('p_specialty', draft.specialty)
    formData.set('p_address', draft.address)
    const promise = updateDoctorProfile(formData).then((result) => { if (result.error) recordPersistenceError(result.error); return result })
    doctorProfileSaveRef.current = promise
    return promise
  }
  async function waitForDoctorProfile() {
    const result = doctorProfileSaveRef.current ? await doctorProfileSaveRef.current : await persistDoctorProfile()
    if (result.error) return (await persistDoctorProfile()).error
    return undefined
  }
  function continueDoctorProfileStep() {
    setError('')
    doctorProfileDraftRef.current = { displayName: doctorName.trim(), specialty: doctorSpecialty.trim(), address: doctorAddress.trim() }
    persistDoctorProfile()
    next()
  }
  function continueAssistantStep() { setError(''); if (!nameChoice) { setError('Elige una opción para continuar.'); return } if (nameChoice === 'yes' && !assistantName.trim()) { setError('Escribe un nombre para tu asistente o elige “Prefiero dejarlo así”.'); return } if (nameChoice === 'yes') { document.documentElement.dataset.onboardingDirection = 'forward'; setPresentationMode(true) } else next() }
  function continueScheduleStep() {
    const form = document.getElementById('onboarding-schedule-form') as HTMLFormElement | null
    if (!form) { setError('No se pudo leer el horario.'); return }
    scheduleFormDataRef.current = new FormData(form)
    const promise = saveDoctorScheduleSettings({}, scheduleFormDataRef.current).then((result) => { if (result.error) recordPersistenceError(result.error); return result })
    scheduleSaveRef.current = promise
    next()
  }
  function next() { setError(''); document.documentElement.dataset.onboardingDirection = 'forward'; setStep((value) => value + 1) }
  function back() { setError(''); document.documentElement.dataset.onboardingDirection = 'back'; setStep((value) => value - 1) }
  function updatePaymentField(field: keyof Payment, value: string) { setPaymentDraft((current) => ({ ...current, [field]: value })) }
  function continueDepositStep() { setError(''); if (wantsDeposit === null) { setError('Elige una opción para continuar.'); return } next() }
  function saveConfirmation() {
    const responseWindow = responseWindowOption === '2h' ? 120 : responseWindowOption === '4h' ? 240 : responseWindowOption === '8h' ? 480 : responseWindowOption === '12h' ? 720 : responseWindowOption === '24h' ? 1440 : settings?.confirmation_response_window_minutes ?? 240
    const lead = wantsConfirmation ? leadOption === '2d' ? 2880 : leadOption === '1d' ? 1440 : 240 : settings?.confirmation_lead_minutes ?? 240
    return saveAssistantSettings(makeData(doctorId, { assistant_name: displayName, confirmation_enabled: wantsConfirmation === true, confirmation_lead_minutes: lead, confirmation_response_window_minutes: responseWindow, unconfirmed_action: wantsConfirmation ? unconfirmedAction === 'cancel' ? 'CANCEL' : 'MANUAL' : '', manual_follow_up_on_no_answer: wantsConfirmation && manualFollowUp })).then((result) => { if (result.error) recordPersistenceError(result.error); return result })
  }
  function persistConfirmation() { if (wantsConfirmation === null) { setError('Elige si quieres que tu asistente confirme las citas.'); return } if (wantsConfirmation && (!leadOption || !responseWindowOption || !unconfirmedAction)) { setError('Completa las opciones de confirmación antes de continuar.'); return } confirmationSaveRef.current = saveConfirmation(); next() }
  function persistTypes() {
    const snapshot = types.map((item) => ({ id: item.id, name: item.name, duration_minutes: item.duration_minutes, price: item.price, is_active: item.is_active }))
    const promise = saveAppointmentTypesForOnboarding(makeData(doctorId, { items: JSON.stringify(snapshot) })).then((result) => { if (result.error) { typesDirtyRef.current = true; recordPersistenceError(result.error); return result } setTypes((current) => current.map((item, index) => { const saved = result.items?.find((value) => value.index === index); return saved ? { ...item, id: saved.id } : item })); typesDirtyRef.current = false; return result })
    typesSaveRef.current = promise
    return promise
  }
  function persistQuestions() {
    const snapshot = questions.map((item) => ({ id: item.id, field_key: item.field_key || `question_${item.sort_order + 1}`, label: item.label, is_required: item.is_required, is_active: item.is_active, sort_order: item.sort_order }))
    const promise = saveIntakeFieldsForOnboarding(makeData(doctorId, { items: JSON.stringify(snapshot) })).then((result) => { if (result.error) { questionsDirtyRef.current = true; recordPersistenceError(result.error); return result } setQuestions((current) => current.map((item, index) => { const saved = result.items?.find((value) => value.index === index); return saved ? { ...item, id: saved.id } : item })); questionsDirtyRef.current = false; return result })
    questionsSaveRef.current = promise
    return promise
  }
  async function waitForTypes() { const result = typesSaveRef.current ? await typesSaveRef.current : typesDirtyRef.current ? await persistTypes() : undefined; if (result?.error && typesDirtyRef.current) return (await persistTypes()).error; return result?.error }
  async function waitForQuestions() { const result = questionsSaveRef.current ? await questionsSaveRef.current : questionsDirtyRef.current ? await persistQuestions() : undefined; if (result?.error && questionsDirtyRef.current) return (await persistQuestions()).error; return result?.error }
  function continueTypes() { setError(''); persistTypes(); next() }
  function continueQuestions() { setError(''); startTransition(async () => { const typeError = await waitForTypes(); if (typeError) { setError(typeError); return } const questionError = await waitForQuestions(); if (questionError) { setError(questionError); return } next() }) }
  function addType() { typesDirtyRef.current = true; setTypes((items) => [...items, { id: '', name: '', duration_minutes: null, price: null, is_active: true }]) }
  function addQuestion() { questionsDirtyRef.current = true; setQuestions((items) => [...items, { id: '', field_key: `custom_${items.length + 1}`, label: '', is_required: false, is_active: true, sort_order: items.length }]) }
  function addKnowledge() { setKnowledge((items) => [...items, { id: '', title: '', content: '', is_active: true, sort_order: items.length }]) }
  function addKnowledgeSuggestion(title: string) { if (knowledge.some((item) => item.title.trim().toLowerCase() === title.toLowerCase())) return; setKnowledge((items) => [...items, { id: '', title, content: '', is_active: true, sort_order: items.length }]) }
  function persistAll() {
    setError('')
    setCompletionError('')
    setCompletionAttempted(false)
    setCompletionStatus('running')
    setShowCompletion(true)
    startTransition(async () => {
      const profileError = await waitForDoctorProfile()
      if (profileError) { setCompletionStatus('error'); return }
      const scheduleResult = scheduleSaveRef.current ? await scheduleSaveRef.current : undefined
      if (scheduleResult?.error) { setCompletionStatus('error'); return }
      const typeError = await waitForTypes()
      if (typeError) { setCompletionStatus('error'); return }
      const questionError = await waitForQuestions()
      if (questionError) { setCompletionStatus('error'); return }
      const confirmationResult = confirmationSaveRef.current ? await confirmationSaveRef.current : undefined
      if (confirmationResult?.error) { setCompletionStatus('error'); return }
      if (wantsDeposit) {
        const result = await saveDepositRule(makeData(doctorId, { id: deposit.id, name: deposit.name || 'Regla de anticipo', scope: deposit.scope, appointment_type_id: deposit.scope === 'APPOINTMENT_TYPE' ? deposit.appointment_type_id ?? '' : '', intake_field_id: deposit.scope === 'INTAKE_FIELD' ? deposit.intake_field_id ?? '' : '', operator: deposit.scope === 'INTAKE_FIELD' ? 'EQUALS' : '', condition_value: deposit.scope === 'INTAKE_FIELD' ? deposit.condition_value ?? '' : '', deposit_type: deposit.deposit_type, deposit_value: deposit.deposit_value ?? '', is_active: true }))
        if (result.error) { setCompletionStatus('error'); return }
      } else if (existingRule) {
        const result = await deleteDepositRule(makeData(doctorId, { id: existingRule.id }))
        if (result.error) { setCompletionStatus('error'); return }
      }
      if (wantsDeposit) {
        const result = await savePaymentInstructions(makeData(doctorId, { ...paymentDraft }))
        if (result.error) { setCompletionStatus('error'); return }
      }
      for (const item of knowledge.filter((value) => value.title.trim() && value.content.trim())) {
        const result = await saveKnowledgeItem(makeData(doctorId, { id: item.id, title: item.title, content: item.content, is_active: item.is_active, sort_order: item.sort_order }))
        if (result.error) { setCompletionStatus('error'); return }
      }
      setCompletionStatus('success')
    })
  }

  function completeOnboarding() {
    setCompletionAttempted(true)
    setCompletionStatus('running')
    setCompletionError('')
    startCompletionTransition(async () => {
      const result = await completeDoctorOnboarding()
      if (result.error) {
        setCompletionError(result.error)
        setCompletionStatus('error')
        return
      }
      router.push('/app/agenda')
    })
  }

  if (showCompletion) return <CompletionScreen assistantName={displayName} status={completionStatus} error={completionError} onRetry={completionAttempted ? completeOnboarding : persistAll} onDone={completeOnboarding} donePending={completionPending} />
  if (step === 8) return <StepShell step={8} total={total} title="¿Qué más debe saber tu asistente?" text="Cuéntale algunas cosas que tus pacientes suelen preguntar o que tu asistente debería saber antes de atenderlos." onBack={back} onNext={persistAll} nextLabel="Finalizar onboarding" pending={pending}><div className="space-y-6"><div><p className="text-sm font-medium text-zinc-800">Puedes empezar con una sugerencia:</p><div className="mt-3 flex flex-wrap gap-2">{knowledgeSuggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => addKnowledgeSuggestion(suggestion)} className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:border-zinc-500">{suggestion}</button>)}</div></div><div className="space-y-4">{knowledge.map((item, index) => <div key={`${item.id}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-4"><label className="block text-xs font-medium text-zinc-600">Tema o pregunta<input className={`${inputClass} mt-1`} value={item.title} onChange={(event) => setKnowledge((current) => current.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} placeholder="¿Hay estacionamiento?" /></label><label className="mt-4 block text-xs font-medium text-zinc-600">Respuesta<textarea className={`${inputClass} mt-1`} rows={3} value={item.content} onChange={(event) => setKnowledge((current) => current.map((value, i) => i === index ? { ...value, content: event.target.value } : value))} placeholder="Escribe una respuesta para tus pacientes" /></label></div>)}{!knowledge.length ? <p className="text-sm text-zinc-500">Agrega una sugerencia o enseña algo más a tu asistente.</p> : null}</div><button type="button" onClick={addKnowledge} className="text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Enseñarle otra cosa</button><p className="text-xs leading-5 text-zinc-500">Tu asistente puede orientar sobre los servicios del consultorio, pero no dará diagnósticos ni indicaciones médicas.</p>{error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}</div></StepShell>
  if (step === 1) return <StepShell step={1} total={total} title="Hola, doctor." text="Para que tu asistente pueda ayudarte, primero necesitamos que te conozca un poco mejor." onNext={continueDoctorProfileStep}><div className="space-y-4"><Editable label="Nombre del doctor" value={doctorName} onChange={setDoctorName} /><Editable label="Especialidad" value={doctorSpecialty} onChange={setDoctorSpecialty} /><Editable label="Dirección" value={doctorAddress} onChange={setDoctorAddress} /></div></StepShell>
  if (step === 2 && !presentationMode) return <StepShell step={2} total={total} title="Conoce a tu asistente." text="Tu asistente atenderá a tus pacientes cuando llamen al consultorio." onBack={back} onNext={continueAssistantStep}><div className="space-y-4"><p className="text-base font-medium">¿Quieres ponerle un nombre a tu asistente?</p><div className="grid gap-3 sm:grid-cols-2"><Choice active={nameChoice === 'yes'} onClick={() => { setError(''); setNameChoice('yes') }} label="Sí" /><Choice active={nameChoice === 'default'} onClick={() => { setError(''); setNameChoice('default') }} label="Prefiero dejarlo así" /></div>{nameChoice === 'yes' ? <div className="animate-[onboarding-in_300ms_ease-out]"><input className={inputClass} value={assistantName} onChange={(event) => { setError(''); setAssistantName(event.target.value) }} placeholder="Ej. Sofía" /></div> : null}{error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}</div></StepShell>
  if (step === 2 && presentationMode) return <Greeting assistantName={assistantName.trim()} onDone={() => { setPresentationMode(false); next() }} />
  if (step === 3) return <StepShell step={3} total={total} title="¿Cuándo atiendes?" text="Cuéntale a tu asistente tus horarios habituales." onBack={back} onNext={continueScheduleStep} nextLabel="Continuar"><DoctorScheduleForm doctorId={doctorId} schedule={schedule} recurringUnavailability={[]} showRecurringUnavailability initiallyEditing hideSubmitButton compactOnboarding formId="onboarding-schedule-form" /></StepShell>
  if (step === 4) return <StepShell step={4} total={total} title="¿Qué citas puede agendar?" text="Dile qué tipos de citas ofrece tu consultorio, cuánto duran y cuál es su costo si deseas informarlo." onBack={back} onNext={continueTypes}><div className="space-y-4">{types.map((item, index) => <div key={`${item.id}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-[1fr_180px_140px]"><label className="text-xs font-medium text-zinc-600">Nombre de la cita<input className={`${inputClass} mt-1`} value={item.name} onChange={(event) => { typesDirtyRef.current = true; setTypes((current) => current.map((value, i) => i === index ? { ...value, name: event.target.value } : value)) }} placeholder="Primera consulta" /></label><label className="text-xs font-medium text-zinc-600">Duración<div className="mt-1 flex items-center gap-2"><input className={inputClass} type="number" min="1" value={item.duration_minutes ?? ''} onChange={(event) => { typesDirtyRef.current = true; setTypes((current) => current.map((value, i) => i === index ? { ...value, duration_minutes: event.target.value ? Number(event.target.value) : null } : value)) }} placeholder="Ej. 60" aria-label="Duración en minutos" /><span className="shrink-0 text-sm text-zinc-500">minutos</span></div></label><label className="text-xs font-medium text-zinc-600">Costo opcional<div className="mt-1 flex items-center"><span className="rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">$</span><input className={`${inputClass} rounded-l-none`} type="number" min="0" step="0.01" value={item.price ?? ''} onChange={(event) => { typesDirtyRef.current = true; setTypes((current) => current.map((value, i) => i === index ? { ...value, price: event.target.value ? Number(event.target.value) : null } : value)) }} placeholder="Opcional" aria-label="Costo opcional" /></div></label></div></div>)}{!types.length ? <p className="text-sm text-zinc-500">Puedes agregar tu primer tipo de cita.</p> : null}<button type="button" onClick={addType} className="text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Agregar otro tipo de cita</button>{error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}</div></StepShell>
  if (step === 5) return <StepShell step={5} total={total} title="¿Qué debe preguntar?" text="Elige la información que necesita pedir antes de agendar. Puedes marcar cada pregunta como necesaria u opcional." onBack={back} onNext={continueQuestions}><div className="space-y-3">{commonQuestions.map((item) => { const selected = questions.find((value) => value.field_key === item.key); return <button type="button" key={item.key} onClick={() => { questionsDirtyRef.current = true; setQuestions((current) => selected ? current.filter((value) => value.field_key !== item.key) : [...current, { id: '', field_key: item.key, label: item.label, is_required: true, is_active: true, sort_order: current.length }]) }} className={`flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left text-sm transition ${selected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400'}`}><span>{item.label}</span><span>{selected ? '✓' : '+'}</span></button> })}{questions.filter((item) => !commonQuestions.some((common) => common.key === item.field_key)).map((item, index) => <div key={`${item.id}-${index}`} className="rounded-xl border border-zinc-200 bg-white p-4"><input className={inputClass} value={item.label} onChange={(event) => { questionsDirtyRef.current = true; setQuestions((current) => current.map((value, i) => value === item ? { ...value, label: event.target.value } : value)) }} placeholder="Otra pregunta" /><label className="mt-3 flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={item.is_required} onChange={(event) => { questionsDirtyRef.current = true; setQuestions((current) => current.map((value) => value === item ? { ...value, is_required: event.target.checked } : value)) }} />Necesaria</label></div>)}<button type="button" onClick={addQuestion} className="text-sm font-medium text-zinc-700 hover:text-zinc-950">+ Agregar otra pregunta</button>{error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}</div></StepShell>
  if (step === 6) return <StepShell step={6} total={total} title="Anticipos" text="Configura si necesitas pedir un anticipo antes de confirmar algunas citas." onBack={back} onNext={continueDepositStep}><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Choice active={wantsDeposit === false} onClick={() => setWantsDeposit(false)} label="No" /><Choice active={wantsDeposit === true} onClick={() => setWantsDeposit(true)} label="Sí" /></div>{wantsDeposit ? <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-4"><p className="text-sm font-medium">¿Cuándo debe pedirlo tu asistente?</p><div className="grid gap-3 sm:grid-cols-3"><Choice active={deposit.scope === 'ALL'} onClick={() => setDeposit((value) => ({ ...value, scope: 'ALL', appointment_type_id: null, intake_field_id: null, operator: null, condition_value: null }))} label="A todos" /><Choice active={deposit.scope === 'APPOINTMENT_TYPE'} onClick={() => setDeposit((value) => ({ ...value, scope: 'APPOINTMENT_TYPE', appointment_type_id: value.appointment_type_id ?? types[0]?.id ?? null, intake_field_id: null, operator: null, condition_value: null }))} label="Según el tipo de cita" /><Choice active={deposit.scope === 'INTAKE_FIELD'} onClick={() => setDeposit((value) => ({ ...value, scope: 'INTAKE_FIELD', appointment_type_id: null, intake_field_id: value.intake_field_id ?? eligibleIntakeFields[0]?.id ?? null, operator: 'EQUALS', condition_value: value.condition_value ?? null }))} label="Según un dato del paciente" /></div>{deposit.scope === 'APPOINTMENT_TYPE' ? <div className="space-y-3"><p className="text-sm font-medium">¿Para qué tipo de cita pides anticipo?</p>{types.length ? <select className={inputClass} value={deposit.appointment_type_id ?? ''} onChange={(event) => setDeposit((value) => ({ ...value, appointment_type_id: event.target.value || null }))}><option value="">Selecciona un tipo</option>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <p className="text-sm text-zinc-600">Primero agrega al menos un tipo de cita.</p>}</div> : null}{deposit.scope === 'INTAKE_FIELD' ? <div className="space-y-3"><p className="text-sm font-medium">¿En qué caso pides anticipo?</p>{eligibleIntakeFields.length ? <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700"><span>Cuando</span><select className={inputClass} value={deposit.intake_field_id ?? ''} onChange={(event) => setDeposit((value) => ({ ...value, intake_field_id: event.target.value || null }))}><option value="">selecciona una pregunta</option>{eligibleIntakeFields.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span>sea</span><input className={inputClass} value={deposit.condition_value ?? ''} onChange={(event) => setDeposit((value) => ({ ...value, condition_value: event.target.value }))} placeholder="escribe una respuesta" /></div> : <p className="text-sm text-zinc-600">Primero agrega una pregunta en el paso anterior.</p>}</div> : null}<div className="space-y-3"><p className="text-sm font-medium">¿Cuánto debe pedir?</p><div className="grid gap-3 sm:grid-cols-2"><select className={inputClass} value={deposit.deposit_type} onChange={(event) => setDeposit((value) => ({ ...value, deposit_type: event.target.value }))}><option value="PERCENTAGE">Porcentaje</option><option value="FIXED">Cantidad fija</option></select><div className="flex items-center"><span className="rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">{deposit.deposit_type === 'PERCENTAGE' ? '%' : String.fromCharCode(36)}</span><input className={inputClass} type="number" min="0.01" max={deposit.deposit_type === 'PERCENTAGE' ? 100 : undefined} step="0.01" value={deposit.deposit_value ?? ''} onChange={(event) => setDeposit((value) => ({ ...value, deposit_value: event.target.value ? Number(event.target.value) : null }))} placeholder="Ej. 50" aria-label="Valor del anticipo" /></div></div></div><div className="space-y-3"><p className="text-sm font-medium">¿Dónde deben depositar o transferir?</p><input className={inputClass} value={paymentDraft.bank_name ?? ''} onChange={(event) => updatePaymentField('bank_name', event.target.value)} placeholder="Banco" /><input className={inputClass} value={paymentDraft.account_holder ?? ''} onChange={(event) => updatePaymentField('account_holder', event.target.value)} placeholder="Titular" /><input className={inputClass} value={paymentDraft.clabe ?? ''} onChange={(event) => updatePaymentField('clabe', event.target.value)} placeholder="CLABE" /><input className={inputClass} value={paymentDraft.account_number ?? ''} onChange={(event) => updatePaymentField('account_number', event.target.value)} placeholder="Número de cuenta" /><textarea className={inputClass} rows={3} value={paymentDraft.instructions ?? ''} onChange={(event) => updatePaymentField('instructions', event.target.value)} placeholder="Instrucciones" /></div></div> : null}</div></StepShell>
  return <StepShell step={7} total={total} title="Confirma tus citas" text="Tu asistente puede llamar a tus pacientes antes de la consulta para confirmar que asistirán." onBack={back} onNext={persistConfirmation} pending={pending}><div className="space-y-6"><div><p className="text-sm font-medium">¿Quieres que tu asistente confirme las citas?</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Choice active={wantsConfirmation === true} onClick={() => { setError(''); setWantsConfirmation(true) }} label="Sí" /><Choice active={wantsConfirmation === false} onClick={() => { setError(''); setWantsConfirmation(false) }} label="No" /></div></div>{wantsConfirmation ? <div className="space-y-6 border-t border-zinc-200 pt-5"><div className="animate-[onboarding-step-forward_300ms_ease-out]"><p className="text-sm font-medium">¿Cuándo quieres que llame?</p><select className={inputClass} value={leadOption ?? ''} onChange={(event) => { setError(''); setLeadOption(event.target.value || null) }}><option value="">Selecciona una opción</option><option value="same-day">El mismo día</option><option value="1d">1 día antes</option><option value="2d">2 días antes</option></select></div>{leadOption ? <div className="animate-[onboarding-step-forward_300ms_ease-out]"><p className="mt-4 text-sm font-medium">Después de enviar el recordatorio, ¿cuánto tiempo quieres esperar antes de tomar una decisión sobre la cita?</p><select className={inputClass} value={responseWindowOption ?? ''} onChange={(event) => { setError(''); setResponseWindowOption(event.target.value || null) }}><option value="">Selecciona una opción</option><option value="2h">2 horas</option><option value="4h">4 horas</option><option value="8h">8 horas</option><option value="12h">12 horas</option><option value="24h">24 horas</option></select></div> : null}{leadOption && responseWindowOption ? <div className="animate-[onboarding-step-forward_300ms_ease-out]"><p className="text-sm font-medium">Si pasa ese tiempo y el paciente no confirma, ¿qué quieres que haga tu asistente?</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Choice active={unconfirmedAction === 'cancel'} onClick={() => { setError(''); setUnconfirmedAction('cancel') }} label="Cancelar la cita automáticamente" /><Choice active={unconfirmedAction === 'manual'} onClick={() => { setError(''); setUnconfirmedAction('manual') }} label="Dejarla pendiente para que yo decida" /></div></div> : null}{leadOption && responseWindowOption && unconfirmedAction ? <p className="animate-[onboarding-step-forward_300ms_ease-out] rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-600">HelloPx llamará una vez para confirmar la cita. Si el paciente no responde, te avisará y podrás enviarle un recordatorio por WhatsApp con un solo clic. Después esperará el tiempo que elijas antes de aplicar la acción configurada.</p> : null}</div> : null}{error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}</div></StepShell>
}

function Editable({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-xs font-medium text-zinc-600">{label}<input className={`${inputClass} mt-1`} value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function Readonly({ label, value }: { label: string; value: string | null }) { return <div><p className="text-xs font-medium text-zinc-500">{label}</p><p className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800">{value || 'No configurado'}</p></div> }
function Choice({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) { return <button type="button" onClick={onClick} className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'}`}>{label}</button> }
function Greeting({ assistantName, onDone }: { assistantName: string; onDone: () => void }) { const [showMessage, setShowMessage] = useState(false); const [showSupportMessage, setShowSupportMessage] = useState(false); useEffect(() => { const messageTimer = setTimeout(() => setShowMessage(true), 1400); const supportMessageTimer = setTimeout(() => setShowSupportMessage(true), 2100); const doneTimer = setTimeout(onDone, 4500); return () => { clearTimeout(messageTimer); clearTimeout(supportMessageTimer); clearTimeout(doneTimer) } }, [onDone]); return <main className="flex min-h-screen items-center justify-center bg-[#fafaf9] px-5 text-center text-zinc-950"><section className="max-w-md">{showMessage ? <div><p className="animate-[onboarding-step-forward_300ms_ease-out] text-3xl font-semibold tracking-tight">“Hola, soy {assistantName}.”</p>{showSupportMessage ? <p className="mt-4 animate-[onboarding-step-forward_300ms_ease-out] text-base leading-7 text-zinc-600">Estoy aquí para ayudarte con tus pacientes.</p> : null}</div> : <div><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900" aria-label="Cargando" /><p className="mt-4 text-sm text-zinc-600">Preparando tu asistente…</p></div>}</section></main> }
function CompletionScreen({ assistantName, status, error, onRetry, onDone, donePending }: { assistantName: string; status: 'running' | 'success' | 'error'; error?: string; onRetry: () => void; onDone: () => void; donePending?: boolean }) {
  const [state, setState] = useState(0)
  useEffect(() => {
    const timers = [
      setTimeout(() => setState(1), 2800),
      setTimeout(() => setState(2), 5600),
      setTimeout(() => setState(3), 8400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])
  const messages = ['Preparando a tu asistente…', 'Organizando tus horarios y tipos de cita…', 'Incorporando lo que debe saber sobre tu consultorio…', '¡Bienvendio!']
  const finalMessage = assistantName ? `${assistantName} ya conoce tus horarios, tus tipos de cita y la información que necesita para atender a tus pacientes.` : 'Tu asistente ya conoce tus horarios, tus tipos de cita y la información que necesita para atender a tus pacientes.'
  const showFinal = status === 'success' && state >= 3
  return <main className="flex min-h-screen items-center justify-center bg-[#fafaf9] px-5 text-center text-zinc-950"><section className="max-w-md">{status === 'error' ? <><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm" aria-hidden="true">!</div><p className="mt-7 animate-[onboarding-step-forward_300ms_ease-out] text-2xl font-semibold tracking-tight">No pudimos terminar de guardar toda la configuración.</p>{error ? <p className="mt-3 text-sm leading-6 text-red-700" role="alert">{error}</p> : null}<button type="button" onClick={onRetry} className="mt-7 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700">Intentar nuevamente</button></> : showFinal ? <><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm" aria-hidden="true">✓</div><p className="mt-7 animate-[onboarding-step-forward_300ms_ease-out] text-3xl font-semibold tracking-tight sm:text-4xl">Todo está preparado.</p><p className="mt-6 animate-[onboarding-step-forward_300ms_ease-out] text-sm leading-6 text-zinc-600">{finalMessage}</p><div className="mt-8"><Button onClick={onDone} disabled={donePending}>{donePending ? 'Entrando…' : 'Conocer HelloPx'}</Button></div></> : <><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900" aria-label="Cargando" /><p key={state} className="mt-7 animate-[onboarding-step-forward_300ms_ease-out] text-2xl font-semibold tracking-tight">{messages[state]}</p></>}</section></main>
}
