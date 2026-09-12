'use client'

import { useActionState, useRef, useState, useTransition } from 'react'

import {
  createExistingContactAppointmentRequestAction,
  createExistingContactNewPatientRequestAction,
  createManualAppointmentRequestAction,
  lookupContactByPhoneAction,
  type AppointmentRequestActionState,
} from '@/app/actions'
import type { ExistingContactLookup } from '@/lib/requests/appointment-requests'

const initialState: AppointmentRequestActionState = {}
type IntakeField = { id: string; field_key: string; label: string; is_required: boolean; sort_order: number }

function RequestIntakeFields({ fields, values, onChange }: { fields: IntakeField[]; values: Record<string, string>; onChange: (fieldId: string, value: string) => void }) {
  if (!fields.length) return null
  return <section className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4"><div><h3 className="text-sm font-semibold text-zinc-900">Datos a recopilar</h3><p className="mt-1 text-xs text-zinc-500">Completa la información adicional de esta solicitud.</p></div>{fields.map((field) => <label key={field.id} className="block text-xs text-zinc-600">{field.label}{field.is_required ? <span className="text-red-700"> *</span> : null}<input name={`intake_${field.id}`} value={values[field.id] ?? ''} onChange={(event) => onChange(field.id, event.target.value)} required={field.is_required} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" /></label>)}</section>
}

export function RequestCreateForm({ appointmentTypes, intakeFields }: { appointmentTypes: Array<{ id: string; name: string }>; intakeFields: IntakeField[] }) {
  const [state, formAction, pending] = useActionState(createManualAppointmentRequestAction, initialState)
  const [existingState, existingAction, existingPending] = useActionState(createExistingContactAppointmentRequestAction, initialState)
  const [newPatientState, newPatientAction, newPatientPending] = useActionState(createExistingContactNewPatientRequestAction, initialState)
  const [existing, setExisting] = useState<ExistingContactLookup | null | undefined>(undefined)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [newPatientMode, setNewPatientMode] = useState(false)
  const [lookupError, setLookupError] = useState<string>()
  const [intakeValues, setIntakeValues] = useState<Record<string, string>>({})
  const [lookupPending, startLookup] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function searchPhone() {
    const form = formRef.current
    if (!form) return
    setLookupError(undefined)
    startLookup(async () => {
      const result = await lookupContactByPhoneAction(new FormData(form))
      setLookupError(result.error)
      setExisting(result.contact)
      setSelectedPatientId(result.contact?.patients[0]?.id ?? '')
      setNewPatientMode(false)
    })
  }

  const intakeAnswers = intakeFields.map((field) => ({ intake_field_id: field.id, field_key: field.field_key, field_label: field.label, value: intakeValues[field.id] ?? '', required: field.is_required }))

  return (
    <section id="nueva-solicitud" className="max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Prueba manual</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">Nueva solicitud</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">Usa el teléfono para encontrar un contacto o registrar uno nuevo.</p>
      <form ref={formRef} action={existing ? (newPatientMode ? newPatientAction : existingAction) : formAction} className="mt-6 space-y-6">
        <label className="block text-xs text-zinc-500">
            Teléfono
            <input name="phone_e164" type="tel" inputMode="tel" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 font-mono text-sm" placeholder="669 123 4567" required />
        </label>
        <button type="button" onClick={searchPhone} disabled={lookupPending} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">{lookupPending ? 'Buscando…' : 'Buscar teléfono'}</button>
        <input type="hidden" name="intake_answers" value={JSON.stringify(intakeAnswers)} />
        {lookupError ? <p className="text-sm text-red-700" role="alert">{lookupError}</p> : null}
        {existing ? (
          <>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Contacto encontrado</p>
              <p className="mt-1 font-medium text-zinc-900">{existing.contactName}</p>
              <p className="mt-1 text-xs text-zinc-500">{existing.patients.length ? 'Pacientes relacionados' : 'Este contacto no tiene pacientes relacionados.'}</p>
            </div>
            <input type="hidden" name="contact_id" value={existing.contactId} />
            <input type="hidden" name="phone_id" value={existing.contactPhoneId} />
            {!newPatientMode && existing.patients.length ? (
              <>
                <label className="block text-xs text-zinc-500">
                  Paciente para esta solicitud
                  <select name="patient_id" value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" required>
                    <option value="">Selecciona un paciente</option>
                    {existing.patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName} · {patient.relationship}</option>)}
                  </select>
                </label>
                <div className="border-t border-zinc-200 pt-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Acción final</p><button type="submit" disabled={existingPending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60">{existingPending ? 'Creando…' : 'Crear solicitud'}</button><button type="button" onClick={() => setNewPatientMode(true)} className="mt-3 text-left text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline">+ Agregar nuevo paciente</button></div>
                <RequestIntakeFields fields={intakeFields} values={intakeValues} onChange={(fieldId, value) => setIntakeValues((current) => ({ ...current, [fieldId]: value }))} />
              </>
            ) : newPatientMode ? <><div className="rounded-lg border border-zinc-200 p-4"><button type="button" onClick={() => setNewPatientMode(false)} className="text-sm font-medium text-zinc-600 hover:text-zinc-950">← Elegir paciente relacionado</button><h3 className="mt-4 text-sm font-semibold text-zinc-900">Agregar nuevo paciente</h3><div className="mt-4 space-y-4"><label className="block text-xs text-zinc-600">Nombre del nuevo paciente<input name="patient_name" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" placeholder="María López" required /></label><label className="block text-xs text-zinc-600">Relación del contacto<select name="relationship" defaultValue="CHILD" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm"><option value="SELF">SELF · paciente</option><option value="MOTHER">MOTHER · madre</option><option value="FATHER">FATHER · padre</option><option value="CHILD">CHILD · hijo/a</option><option value="PARTNER">PARTNER · pareja</option><option value="RELATIVE">RELATIVE · familiar</option><option value="OTHER">OTHER · otra</option></select></label></div></div><RequestIntakeFields fields={intakeFields} values={intakeValues} onChange={(fieldId, value) => setIntakeValues((current) => ({ ...current, [fieldId]: value }))} /><div className="border-t border-zinc-200 pt-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Acción final</p><button type="submit" disabled={newPatientPending} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60">{newPatientPending ? 'Creando…' : 'Agregar paciente y crear solicitud'}</button></div></> : <><p className="text-sm text-amber-800">Este contacto no tiene un paciente relacionado todavía.</p><button type="button" onClick={() => setNewPatientMode(true)} className="text-left text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline">+ Agregar nuevo paciente</button></>}
            {existingState.error ? <p className="text-sm text-red-700" role="alert">{existingState.error}</p> : null}
            {existingState.success ? <p className="text-sm text-emerald-700" role="status">{existingState.success}</p> : null}
            {newPatientState.error ? <p className="text-sm text-red-700" role="alert">{newPatientState.error}</p> : null}
            {newPatientState.success ? <p className="text-sm text-emerald-700" role="status">{newPatientState.success}</p> : null}
          </>
        ) : (
          <>
            <label className="block text-xs text-zinc-500">
              Nombre del paciente
              <input name="patient_name" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" placeholder="María López" required />
            </label>
            <RequestIntakeFields fields={intakeFields} values={intakeValues} onChange={(fieldId, value) => setIntakeValues((current) => ({ ...current, [fieldId]: value }))} />
            <label className="block text-xs text-zinc-500">
              Nombre del contacto
              <input name="contact_name" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm" placeholder="Ana López" required />
            </label>
            <label className="block text-xs text-zinc-500">
              Relación
              <select name="relationship" defaultValue="SELF" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm">
                <option value="SELF">SELF · paciente</option><option value="MOTHER">MOTHER · madre</option><option value="FATHER">FATHER · padre</option><option value="CHILD">CHILD · hijo/a</option><option value="PARTNER">PARTNER · pareja</option><option value="RELATIVE">RELATIVE · familiar</option><option value="OTHER">OTHER · otra</option>
              </select>
            </label>
            <label className="block text-xs text-zinc-500">
              Tipo de cita opcional
              <select name="appointment_type_id" defaultValue="" className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm">
                <option value="">Sin definir</option>{appointmentTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
            {state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}
            {state.success ? <p className="text-sm text-emerald-700" role="status">{state.success}</p> : null}
            <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Creando…' : 'Crear solicitud'}</button>
          </>
        )}
      </form>
    </section>
  )
}
