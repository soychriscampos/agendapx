import { getCurrentUser } from '@/lib/auth'
import { InvitePasswordForm } from '@/app/auth/invite/invite-password-form'

function InviteStatus({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-950">{title}</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">{message}</p>
        <a href="/login" className="mt-8 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white hover:bg-zinc-700">Volver al inicio</a>
      </section>
    </main>
  )
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams
  if (params.error === 'invalid') {
    return <InviteStatus title="Esta invitación ya no es válida." message="Puede haber expirado o haber sido utilizada anteriormente." />
  }

  const user = await getCurrentUser()
  if (!user || user.role !== 'DOCTOR' || !user.doctor_id) {
    return <InviteStatus title="No pudimos abrir esta invitación." message="Abre el enlace desde el correo de invitación o solicita uno nuevo." />
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-950">Crea tu contraseña</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">Usarás esta contraseña para entrar a HelloPx a partir de ahora.</p>
        <InvitePasswordForm />
      </section>
    </main>
  )
}
