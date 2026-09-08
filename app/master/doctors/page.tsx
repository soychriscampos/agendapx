import { logout } from '@/app/actions'
import { DoctorTable } from '@/app/master/doctors/doctor-table'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function MasterDoctorsPage() {
  const user = await requireRole('MASTER')
  const supabase = await createClient()
  const { data: doctors, error } = await supabase
    .from('doctors')
    .select('id, display_name, phone, whatsapp, status, timezone, retell_agent_id, twilio_phone_number')
    .order('display_name')

  if (error) {
    throw new Error('No se pudieron cargar los doctores.')
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx · MASTER</p>
            <h1 className="mt-2 text-3xl font-semibold text-zinc-950">Doctores</h1>
            <p className="mt-2 text-sm text-zinc-600">Hola, {user.full_name}. Configuración operativa de los doctores registrados.</p>
          </div>
          <form action={logout}>
            <button type="submit" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100">Cerrar sesión</button>
          </form>
        </header>
        <section className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <DoctorTable doctors={(doctors ?? []).map((doctor) => ({ ...doctor, status: doctor.status as 'ACTIVE' | 'INACTIVE' }))} />
        </section>
      </div>
    </main>
  )
}
