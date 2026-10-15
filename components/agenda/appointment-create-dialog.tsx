'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { createAppointmentAction, lookupManualAppointmentPhoneAction, searchManualAppointmentPatientsAction } from '@/app/actions'
import type { ManualAppointmentPatientOption } from '@/lib/appointments/appointments'

const timeInputClass = 'mt-1 block rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm'
const inputClass = 'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm'
const relationships = [
  ['SELF', 'Paciente'], ['MOTHER', 'Madre'], ['FATHER', 'Padre'], ['CHILD', 'Hijo/a'],
  ['PARTNER', 'Pareja'], ['RELATIVE', 'Familiar'], ['OTHER', 'Otra relación'],
]

export function AppointmentCreateDialog({ doctorId, onComplete, onClose }: { doctorId: string; onComplete: (message: string) => void; onClose: () => void }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const manualCreationKey = useRef<string | null>(null)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const [confirmation, setConfirmation] = useState(false)
  const [patientMode, setPatientMode] = useState<'NEW' | 'EXISTING'>('NEW')
  const [patientName, setPatientName] = useState('')
  const [patientQuery, setPatientQuery] = useState('')
  const [patients, setPatients] = useState<ManualAppointmentPatientOption[]>([])
  const [selectedPatient, setSelectedPatient] = useState<ManualAppointmentPatientOption | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneMatch, setPhoneMatch] = useState<Awaited<ReturnType<typeof lookupManualAppointmentPhoneAction>>['phone']>()
  const [phoneChecked, setPhoneChecked] = useState(false)
  const [phoneOwner, setPhoneOwner] = useState<'PATIENT' | 'OTHER' | ''>('')
  const [relationship, setRelationship] = useState('')
  const [contactName, setContactName] = useState('')
  const [lookupPending, startLookup] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    const keyField = event.currentTarget.elements.namedItem('manual_creation_key') as HTMLInputElement
    manualCreationKey.current ??= globalThis.crypto.randomUUID()
    keyField.value = manualCreationKey.current
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await createAppointmentAction({}, data)
      if (result.error) setError(result.error)
      else {
        onComplete('Cita creada')
        onClose()
        formRef.current?.reset()
        manualCreationKey.current = null
        router.refresh()
      }
    })
  }

  function resetPhoneResult() {
    setPhoneMatch(undefined)
    setPhoneChecked(false)
    setPhoneOwner('')
    setRelationship('')
    setContactName('')
  }

  function searchPatients() {
    startLookup(async () => {
      const result = await searchManualAppointmentPatientsAction(doctorId, patientQuery)
      if (result.error) setError(result.error)
      else setPatients(result.patients ?? [])
    })
  }

  function selectPatient(patient: ManualAppointmentPatientOption) {
    setSelectedPatient(patient)
    setPatientName(patient.fullName)
    setPatients([])
    setError(undefined)
    setPhone('')
    resetPhoneResult()
  }

  function selectExistingPhone(phoneE164: string) {
    setPhone(phoneE164)
    resetPhoneResult()
    startLookup(async () => {
      const result = await lookupManualAppointmentPhoneAction(doctorId, phoneE164)
      if (result.error) setError(result.error)
      else {
        setPhoneMatch(result.phone)
        setPhoneChecked(true)
        if (result.phone && selectedPatient) {
          const existingRelation = result.phone.relations.find((relation) => relation.patient_id === selectedPatient.id)
          if (existingRelation) setRelationship(existingRelation.relationship)
        }
      }
    })
  }

  function lookupPhone() {
    if (!phone.trim()) { setError('Escribe un teléfono para buscarlo.'); return }
    setError(undefined)
    startLookup(async () => {
      const result = await lookupManualAppointmentPhoneAction(doctorId, phone)
      if (result.error) setError(result.error)
      else {
        setPhoneMatch(result.phone)
        setPhoneChecked(true)
        setRelationship('')
        if (result.phone && patientMode === 'EXISTING' && selectedPatient) {
          const existingRelation = result.phone.relations.find((relation) => relation.patient_id === selectedPatient.id)
          if (existingRelation) setRelationship(existingRelation.relationship)
        }
      }
    })
  }

  const matchingPatientRelation = !!(phoneMatch && selectedPatient?.id && phoneMatch.relations.some((relation) => relation.patient_id === selectedPatient.id))
  const needsRelationship = confirmation && phoneChecked && !!phoneMatch && (patientMode === 'NEW' || !matchingPatientRelation)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-zinc-950/30 p-4" role="presentation" onClick={onClose}>
      <form ref={formRef} onSubmit={submit} onClick={(event) => event.stopPropagation()} className="my-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agenda</p><h2 className="mt-1 text-xl font-semibold text-zinc-950">Nueva cita</h2></div>
          <button type="button" onClick={onClose} className="text-sm text-zinc-500">Cerrar</button>
        </div>
        <input type="hidden" name="doctor_id" value={doctorId} />
        <input type="hidden" name="manual_creation_key" />
        <input type="hidden" name="manual_confirmation_requested" value={confirmation ? 'true' : 'false'} />
        <input type="hidden" name="patient_mode" value={patientMode} />
        <input type="hidden" name="patient_id" value={selectedPatient?.id ?? ''} />
        <input type="hidden" name="patient_name" value={patientName} />
        <input type="hidden" name="phone_e164" value={phone} />
        <input type="hidden" name="phone_owner" value={phoneOwner} />
        <input type="hidden" name="contact_name" value={contactName} />
        <input type="hidden" name="relationship" value={relationship} />

        <div className="mt-5 space-y-3">
          {!confirmation || patientMode === 'NEW' ? <label className="block text-xs text-zinc-500">Nombre del paciente<input value={patientName} onChange={(event) => setPatientName(event.target.value)} className={inputClass} required /></label> : null}
          <label className="block text-xs text-zinc-500">Fecha<input type="date" name="date" className={inputClass} required /></label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-500">Desde<input type="time" name="start" defaultValue="09:00" className={timeInputClass} required /></label>
            <span className="pb-2 text-sm text-zinc-400">a</span>
            <label className="text-xs text-zinc-500">Hasta<input type="time" name="end" defaultValue="10:00" className={timeInputClass} required /></label>
          </div>

          <label className="flex items-start gap-2 border-t border-zinc-100 pt-4 text-sm text-zinc-800">
            <input type="checkbox" checked={confirmation} onChange={(event) => {
              setConfirmation(event.target.checked)
              setError(undefined)
              setPatientMode('NEW'); setSelectedPatient(null); setPatients([]); setPatientQuery(''); setPhone(''); resetPhoneResult()
            }} className="mt-0.5 rounded border-zinc-300" />
            <span><span className="font-medium">Solicitar confirmación telefónica</span><span className="mt-0.5 block text-xs text-zinc-500">HelloPx llamará para confirmar esta cita.</span></span>
          </label>

          {confirmation ? <div className="space-y-4 rounded-lg bg-zinc-50 p-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-zinc-600">Paciente</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={patientMode === 'NEW'} onChange={() => { setPatientMode('NEW'); setSelectedPatient(null); setPatientName(''); setPhone(''); resetPhoneResult() }} />Registrar paciente nuevo</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={patientMode === 'EXISTING'} onChange={() => { setPatientMode('EXISTING'); setPatientName(''); setPhone(''); resetPhoneResult() }} />Elegir paciente existente</label>
            </fieldset>

            {patientMode === 'EXISTING' ? <div className="space-y-3">
              {!selectedPatient ? <>
                <label className="block text-xs text-zinc-500">Buscar paciente<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchPatients() } }} className={inputClass} placeholder="Escribe al menos dos letras" /></label>
                <button type="button" onClick={searchPatients} disabled={lookupPending || patientQuery.trim().length < 2} className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50">{lookupPending ? 'Buscando…' : 'Buscar paciente'}</button>
                {patients.length ? <ul className="max-h-36 divide-y divide-zinc-200 overflow-y-auto rounded-md border border-zinc-200 bg-white">{patients.map((patient) => <li key={patient.id}><button type="button" onClick={() => selectPatient(patient)} className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50">{patient.fullName}</button></li>)}</ul> : null}
              </> : <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"><span>{selectedPatient.fullName}</span><button type="button" onClick={() => { setSelectedPatient(null); setPatientName(''); setPhone(''); resetPhoneResult() }} className="text-zinc-500 underline">Cambiar</button></div>}
              {selectedPatient?.contacts.some((contact) => contact.phones.length) ? <label className="block text-xs text-zinc-500">Teléfono de contacto relacionado<select defaultValue="" onChange={(event) => { if (event.target.value) selectExistingPhone(event.target.value) }} className={inputClass}><option value="">Elige un teléfono o escribe otro</option>{selectedPatient.contacts.flatMap((contact) => contact.phones.map((item) => <option key={item.id} value={item.phoneE164}>{contact.contactName} · {contact.relationship} · {item.phoneE164}</option>))}</select></label> : null}
            </div> : null}

            <label className="block text-xs text-zinc-500">Teléfono para la confirmación<input type="tel" inputMode="tel" value={phone} onChange={(event) => { setPhone(event.target.value); resetPhoneResult() }} className={inputClass} placeholder="669 123 4567" required /></label>
            <button type="button" onClick={lookupPhone} disabled={lookupPending || !phone.trim()} className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50">{lookupPending ? 'Buscando…' : 'Verificar teléfono'}</button>

            {phoneChecked && phoneMatch ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"><p className="font-medium text-emerald-950">Se reutilizará el contacto {phoneMatch.contactName} y su teléfono.</p>{matchingPatientRelation ? <p className="mt-1 text-xs text-emerald-900">Ya está relacionado con este paciente como {relationships.find(([key]) => key === relationship)?.[1] ?? relationship}.</p> : <p className="mt-1 text-xs text-emerald-900">El contacto aún no está relacionado con este paciente. Indica la relación para crearla.</p>}</div> : null}

            {phoneChecked && !phoneMatch ? <fieldset className="space-y-2 rounded-md border border-zinc-200 bg-white p-3">
              <legend className="px-1 text-xs font-medium text-zinc-600">¿A quién pertenece este teléfono?</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="phone_owner_choice" value="PATIENT" required checked={phoneOwner === 'PATIENT'} onChange={() => { setPhoneOwner('PATIENT'); setContactName(''); setRelationship('SELF') }} />Al paciente</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="phone_owner_choice" value="OTHER" required checked={phoneOwner === 'OTHER'} onChange={() => { setPhoneOwner('OTHER'); setRelationship('') }} />A otra persona</label>
              {phoneOwner === 'PATIENT' ? <p className="text-xs text-zinc-500">Se registrará el contacto como el paciente (SELF).</p> : null}
              {phoneOwner === 'OTHER' ? <label className="block text-xs text-zinc-500">Nombre del contacto<input value={contactName} onChange={(event) => setContactName(event.target.value)} className={inputClass} required /></label> : null}
            </fieldset> : null}

            {needsRelationship || (phoneChecked && !phoneMatch && phoneOwner === 'OTHER') ? <label className="block text-xs text-zinc-500">Relación del contacto con el paciente<select value={relationship} onChange={(event) => setRelationship(event.target.value)} className={inputClass} required><option value="">Selecciona una relación</option>{relationships.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : null}
          </div> : null}
        </div>
        {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
        <button type="submit" disabled={pending || (confirmation && (!phoneChecked || (patientMode === 'EXISTING' && !selectedPatient)))} className="mt-5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Crear cita'}</button>
      </form>
    </div>
  )
}
