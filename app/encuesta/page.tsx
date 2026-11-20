import type { Metadata } from 'next'
import { connection } from 'next/server'
import { SurveyFlow } from './survey-flow'

export const metadata: Metadata = {
  title: 'Encuesta para médicos | HelloPx',
  description: 'Cuéntanos cómo atiende tu consultorio las llamadas y solicitudes de cita.',
}

export default async function SurveyPage() {
  await connection()
  return <SurveyFlow demoNumber="+15705198499" />
}
