import { getCurrentUser } from '@/lib/auth'
import { getAvailableSlots } from '@/lib/availability/get-available-slots'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'No autorizado.' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return Response.json({ error: 'El cuerpo JSON no es válido.' }, { status: 400 }) }
  const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom : ''
  const dateTo = typeof body.dateTo === 'string' ? body.dateTo : dateFrom
  const doctorId = user.role === 'DOCTOR' ? user.doctor_id : typeof body.doctorId === 'string' ? body.doctorId : ''
  const durationMinutes = typeof body.durationMinutes === 'number' ? body.durationMinutes : Number(body.durationMinutes)
  const slotIntervalMinutes = body.slotIntervalMinutes === undefined ? undefined : Number(body.slotIntervalMinutes)
  if (!doctorId || !dateFrom || !dateTo || !Number.isFinite(durationMinutes) || (slotIntervalMinutes !== undefined && !Number.isFinite(slotIntervalMinutes))) return Response.json({ error: 'Los parámetros de disponibilidad no son válidos.' }, { status: 400 })

  try {
    return Response.json(await getAvailableSlots({ doctorId, dateFrom, dateTo, durationMinutes, slotIntervalMinutes }))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo calcular la disponibilidad.' }, { status: 400 })
  }
}
