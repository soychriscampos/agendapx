export const questions = [
  { key: 'specialty', title: '¿Cuál es tu especialidad médica?', options: ['Medicina general', 'Ginecología y obstetricia', 'Pediatría', 'Dermatología', 'Traumatología y ortopedia', 'Otra'] },
  { key: 'call_handler', title: '¿Quién se encarga de atender las llamadas y agendar citas en tu consultorio?', options: ['Recepcionista o asistente', 'Yo personalmente', 'Ambos', 'Servicio externo', 'Otro'] },
  { key: 'appointment_channels', title: '¿Por qué medios solicitan citas tus pacientes?', options: ['Llamadas telefónicas', 'WhatsApp', 'Redes sociales', 'Plataforma de reservas', 'Presencialmente'], multiple: true },
  { key: 'missed_calls', title: '¿Con qué frecuencia quedan llamadas de pacientes sin contestar?', options: ['Frecuentemente', 'Algunas veces', 'Rara vez', 'Nunca', 'No lo sé'] },
  { key: 'obstacle', title: '¿Cuál es el principal obstáculo para contestar todas las llamadas?', options: ['Estamos atendiendo pacientes', 'Recibimos llamadas fuera del horario', 'Varias llamadas llegan al mismo tiempo', 'No contamos con personal suficiente', 'Generalmente contestamos todas las llamadas', 'Otro'] },
  { key: 'missed_call_followup', title: '¿Qué sucede normalmente cuando no pueden contestar una llamada?', options: ['Devolvemos la llamada después', 'El paciente vuelve a llamar', 'El paciente escribe por WhatsApp', 'No tenemos forma de darle seguimiento', 'No aplica / contestamos todas'] },
  { key: 'assistant_usefulness', title: '¿Qué tan útil te resultaría un asistente que contestara llamadas y ayudara a gestionar citas cuando tu consultorio no puede atenderlas?', options: ['Muy útil', 'Algo útil', 'Poco útil', 'Nada útil', 'No estoy seguro'] },
] as const

export type Answers = {
  specialty: string; specialty_other?: string; call_handler: string;
  appointment_channels: string[]; missed_calls: string; obstacle: string;
  obstacle_other?: string; missed_call_followup: string; assistant_usefulness: string
}

export function validateAnswers(value: unknown): Answers | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const answers = value as Record<string, unknown>
  for (const question of questions) {
    const answer = answers[question.key]
    if ('multiple' in question) {
      if (!Array.isArray(answer) || answer.length < 1 || answer.length > question.options.length ||
        new Set(answer).size !== answer.length || answer.some((item) => !question.options.includes(item))) return null
    } else if (typeof answer !== 'string' || !(question.options as readonly string[]).includes(answer)) return null
  }
  for (const [choice, field] of [['specialty', 'specialty_other'], ['obstacle', 'obstacle_other']] as const) {
    const extra = answers[field]
    if (answers[choice] === 'Otra' || answers[choice] === 'Otro') {
      if (typeof extra !== 'string' || !extra.trim() || extra.trim().length > 120) return null
    } else if (extra != null && extra !== '') return null
  }
  return answers as Answers
}
