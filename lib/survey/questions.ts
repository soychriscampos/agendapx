export const v1Questions = [
  { key: 'specialty', options: ['Medicina general', 'Ginecología y obstetricia', 'Pediatría', 'Dermatología', 'Traumatología y ortopedia', 'Otra'] },
  { key: 'call_handler', options: ['Recepcionista o asistente', 'Yo personalmente', 'Ambos', 'Servicio externo', 'Otro'] },
  { key: 'appointment_channels', options: ['Llamadas telefónicas', 'WhatsApp', 'Redes sociales', 'Plataforma de reservas', 'Presencialmente'], multiple: true },
  { key: 'missed_calls', options: ['Frecuentemente', 'Algunas veces', 'Rara vez', 'Nunca', 'No lo sé'] },
  { key: 'obstacle', options: ['Estamos atendiendo pacientes', 'Recibimos llamadas fuera del horario', 'Varias llamadas llegan al mismo tiempo', 'No contamos con personal suficiente', 'Generalmente contestamos todas las llamadas', 'Otro'] },
  { key: 'missed_call_followup', options: ['Devolvemos la llamada después', 'El paciente vuelve a llamar', 'El paciente escribe por WhatsApp', 'No tenemos forma de darle seguimiento', 'No aplica / contestamos todas'] },
  { key: 'assistant_usefulness', options: ['Muy útil', 'Algo útil', 'Poco útil', 'Nada útil', 'No estoy seguro'] },
] as const

export const v2QuestionOptions = {
  specialty: ['Medicina general', 'Ginecología y obstetricia', 'Pediatría', 'Dermatología', 'Traumatología y ortopedia', 'Otra'],
  call_handler: ['Recepcionista o asistente', 'Yo personalmente', 'Ambos', 'Servicio externo', 'Otro'],
  appointment_channels: ['Llamadas telefónicas', 'WhatsApp', 'Redes sociales', 'Plataforma de reservas', 'Presencialmente'],
  missed_calls: ['Frecuentemente', 'Algunas veces', 'Rara vez', 'Nunca', 'No lo sé'],
  obstacle: ['Estamos atendiendo pacientes', 'Recibimos llamadas fuera del horario', 'Varias llamadas llegan al mismo tiempo', 'No contamos con personal suficiente', 'Otro'],
  missed_call_followup: ['Devolvemos la llamada después', 'El paciente vuelve a llamar', 'El paciente escribe por WhatsApp', 'No tenemos forma de darle seguimiento', 'No aplica'],
  missed_calls_volume: ['Menos de 5', 'Entre 5 y 15', 'Entre 15 y 30', 'Más de 30', 'No lo sé'],
  assistant_concerns: ['Que suene robótico o artificial', 'La privacidad de los datos de mis pacientes', 'Que se equivoque al agendar citas', 'El costo', 'Que mis pacientes no lo acepten', 'Nada, no me preocupa', 'Otra'],
  commercial_interest: ['personalized_demo', 'information', 'none'],
} as const

export type V1Answers = {
  specialty: string; specialty_other?: string; call_handler: string;
  appointment_channels: string[]; missed_calls: string; obstacle: string;
  obstacle_other?: string; missed_call_followup: string; assistant_usefulness: string
}

export type V2Answers = {
  specialty: string
  specialty_other: string | null
  call_handler: string
  appointment_channels: string[]
  missed_calls: string
  obstacle: string | null
  obstacle_other: string | null
  missed_call_followup: string | null
  missed_calls_volume: string | null
  assistant_concerns: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validSingle(value: unknown, options: readonly string[]) {
  return typeof value === 'string' && options.includes(value)
}

function validMultiple(value: unknown, options: readonly string[]) {
  return Array.isArray(value) && value.length > 0 && value.length <= options.length + 1 &&
    new Set(value).size === value.length && value.every(item => typeof item === 'string' && options.includes(item))
}

function validOther(choice: unknown, value: unknown, trigger: string) {
  if (choice === trigger) return typeof value === 'string' && !!value.trim() && value.trim().length <= 120
  return value == null || value === ''
}

export function validateV1Answers(value: unknown): V1Answers | null {
  if (!isRecord(value)) return null
  const answers = value
  for (const question of v1Questions) {
    const answer = answers[question.key]
    if ('multiple' in question) {
      if (!validMultiple(answer, question.options)) return null
    } else if (!validSingle(answer, question.options)) return null
  }
  if (!validOther(answers.specialty, answers.specialty_other, 'Otra') ||
    !validOther(answers.obstacle, answers.obstacle_other, 'Otro')) return null
  return answers as V1Answers
}

export function validateV2Answers(value: unknown): V2Answers | null {
  if (!isRecord(value)) return null
  const answers = value
  if (!validSingle(answers.specialty, v2QuestionOptions.specialty) ||
    !validOther(answers.specialty, answers.specialty_other, 'Otra') ||
    !(validSingle(answers.call_handler, v2QuestionOptions.call_handler.filter(option => option !== 'Otro')) ||
      (typeof answers.call_handler === 'string' && /^Otro: .{1,120}$/.test(answers.call_handler))) ||
    !validMultiple(answers.appointment_channels, v2QuestionOptions.appointment_channels) ||
    !validSingle(answers.missed_calls, v2QuestionOptions.missed_calls) ||
    !Array.isArray(answers.assistant_concerns) || answers.assistant_concerns.length === 0) return null

  const concerns = answers.assistant_concerns
  const concernOptions: readonly string[] = v2QuestionOptions.assistant_concerns
  const normalizedConcerns = concerns.every(item => typeof item === 'string' &&
    (concernOptions.includes(item) && item !== 'Otra' || (item.startsWith('Otra: ') && item.length <= 126)))
  if (!normalizedConcerns || new Set(concerns).size !== concerns.length || concerns.length > concernOptions.length) return null
  if (concerns.includes('Nada, no me preocupa') && concerns.length !== 1) return null

  const neverMissed = answers.missed_calls === 'Nunca'
  if (neverMissed) {
    if (answers.obstacle != null || answers.obstacle_other != null || answers.missed_call_followup != null || answers.missed_calls_volume != null) return null
  } else {
    if (!validSingle(answers.obstacle, v2QuestionOptions.obstacle) ||
      !validOther(answers.obstacle, answers.obstacle_other, 'Otro') ||
      !validSingle(answers.missed_call_followup, v2QuestionOptions.missed_call_followup) ||
      !validSingle(answers.missed_calls_volume, v2QuestionOptions.missed_calls_volume)) return null
  }

  return answers as unknown as V2Answers
}

export function validateCommercialInterest(value: unknown): value is 'personalized_demo' | 'information' | 'none' {
  return typeof value === 'string' && (v2QuestionOptions.commercial_interest as readonly string[]).includes(value)
}
