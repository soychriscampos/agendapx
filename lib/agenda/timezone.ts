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
