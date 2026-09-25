export const LOGIN_DESTINATIONS = [
  '/master/doctors',
  '/onboarding',
  '/app/agenda',
] as const

export type LoginDestination = (typeof LOGIN_DESTINATIONS)[number]

type AuthDestinationSubject = {
  role: 'MASTER' | 'DOCTOR'
  doctor_id: string | null
  onboarding_completed: boolean | null
}

export function resolveAuthenticatedDestination(subject: AuthDestinationSubject): LoginDestination | null {
  if (subject.role === 'MASTER') return '/master/doctors'
  if (!subject.doctor_id || subject.onboarding_completed === null) return null
  return subject.onboarding_completed ? '/app/agenda' : '/onboarding'
}

export function isLoginDestination(value: unknown): value is LoginDestination {
  return typeof value === 'string' && LOGIN_DESTINATIONS.some((destination) => destination === value)
}
