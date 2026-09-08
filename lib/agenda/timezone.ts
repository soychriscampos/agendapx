export function getDateInTimezone(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant)

  let year = 0
  let month = 0
  let day = 0

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value)
    if (part.type === 'month') month = Number(part.value)
    if (part.type === 'day') day = Number(part.value)
  }

  return new Date(year, month - 1, day)
}

type LocalDateTimeParts = { year: number; month: number; day: number; hour: number; minute: number }

function partsInTimezone(timezone: string, instant: Date): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute }
}

export function localDateTimeToUtc(date: string, time: string, timezone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) throw new Error('La fecha y hora no son válidas.')

  const desired = {
    year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]), minute: Number(timeMatch[2]),
  }
  const candidate = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute)
  const observed = partsInTimezone(timezone, new Date(candidate))
  const offset = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute) - candidate
  const result = new Date(candidate - offset)
  if (Number.isNaN(result.getTime())) throw new Error('La fecha y hora no son válidas.')
  return result
}

export function addLocalDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day + amount))
  return result.toISOString().slice(0, 10)
}

export function getDateTimeInTimezone(timezone: string, instant: Date) {
  const parts = partsInTimezone(timezone, instant)
  return {
    date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}
