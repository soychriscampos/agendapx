const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/

export function normalizePhoneToE164(input: string): string {
  const value = input.trim()
  const normalized = value.startsWith('+')
    ? `+${value.slice(1).replace(/[\s().-]/g, '')}`
    : (() => {
        const digits = value.replace(/\D/g, '')
        return digits.length === 10 ? `+52${digits}` : digits
      })()

  if (!E164_PATTERN.test(normalized)) throw new Error('Ingresa un número de teléfono válido.')
  return normalized
}
