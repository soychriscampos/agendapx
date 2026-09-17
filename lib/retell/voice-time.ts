const HOUR_WORDS = ['doce', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once']

const NUMBER_WORDS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte']

function numberToSpanish(value: number) {
  if (value <= 20) return NUMBER_WORDS[value]
  if (value < 30) return `veinti${NUMBER_WORDS[value - 20]}`
  const tens = value < 40 ? 'treinta' : 'cuarenta'
  const units = value % 10
  return units ? `${tens} y ${NUMBER_WORDS[units]}` : tens
}

export function formatTimeForVoice(time: string) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time)
  if (!match) throw new Error('La hora no es válida.')

  const [hour, minute] = time.split(':').map(Number)
  const hourWord = HOUR_WORDS[hour % 12]
  const minutePhrase = minute === 0 ? '' : minute === 30 ? ' y media' : ` y ${numberToSpanish(minute)}`
  const period = hour === 12 && minute === 0
    ? 'del mediodía'
    : hour === 12
      ? 'del día'
      : hour === 0
        ? 'de la madrugada'
        : hour < 12
          ? 'de la mañana'
          : 'de la tarde'

  return `${hourWord}${minutePhrase} ${period}`
}
