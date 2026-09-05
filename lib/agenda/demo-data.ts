export type DemoAppointmentStatus =
  | 'CONFIRMED'
  | 'PENDING_ADVANCE'
  | 'PENDING_CONFIRMATION'

export type DemoAgendaEvent =
  | {
      id: string
      kind: 'appointment'
      date: string
      start: string
      end: string
      patient: string
      appointmentType: string
      status: DemoAppointmentStatus
    }
  | {
      id: string
      kind: 'block'
      date: string
      start: string
      end: string
      label: 'No disponible' | 'Congreso' | 'Vacaciones'
    }

// Demo-only data. It is intentionally kept outside the visual components so it
// can later be replaced by calendar data without changing the agenda UI.
export const demoAgendaEvents: DemoAgendaEvent[] = [
  {
    id: 'appointment-1',
    kind: 'appointment',
    date: '2026-09-07',
    start: '09:00',
    end: '09:45',
    patient: 'Mariana López',
    appointmentType: 'Consulta de seguimiento',
    status: 'CONFIRMED',
  },
  {
    id: 'appointment-2',
    kind: 'appointment',
    date: '2026-09-07',
    start: '11:30',
    end: '12:15',
    patient: 'Carlos Méndez',
    appointmentType: 'Primera consulta',
    status: 'PENDING_ADVANCE',
  },
  {
    id: 'appointment-3',
    kind: 'appointment',
    date: '2026-09-08',
    start: '10:00',
    end: '10:45',
    patient: 'Sofía Ramírez',
    appointmentType: 'Consulta de seguimiento',
    status: 'PENDING_CONFIRMATION',
  },
  {
    id: 'appointment-4',
    kind: 'appointment',
    date: '2026-09-09',
    start: '16:00',
    end: '16:45',
    patient: 'Jorge Navarro',
    appointmentType: 'Consulta general',
    status: 'CONFIRMED',
  },
  {
    id: 'block-1',
    kind: 'block',
    date: '2026-09-08',
    start: '12:00',
    end: '18:00',
    label: 'Congreso',
  },
  {
    id: 'block-2',
    kind: 'block',
    date: '2026-09-10',
    start: '08:00',
    end: '18:00',
    label: 'Vacaciones',
  },
]

