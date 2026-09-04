import { logout } from '@/app/actions'
import { requireRole } from '@/lib/auth'

export default async function AgendaPage() {
  const user = await requireRole('DOCTOR')

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-wide text-zinc-500">AgendaPX · DOCTOR</p>
            <h1 className="mt-2 text-3xl font-semibold text-zinc-950">Agenda</h1>
            <p className="mt-2 text-sm text-zinc-600">Hola, {user.full_name}.</p>
          </div>
          <form action={logout}>
            <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white">Cerrar sesión</button>
          </form>
        </header>
      </div>
    </main>
  )
}
