import { AcceptInvitationForm } from '@/app/auth/accept/accept-invitation-form'

function InvalidInvitation() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-950">Esta invitación no es válida</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">Solicita una nueva invitación para continuar.</p>
        <a href="/login" className="mt-8 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white hover:bg-zinc-700">Volver al inicio</a>
      </section>
    </main>
  )
}

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const params = await searchParams
  if (!params.token_hash || (params.type !== 'invite' && params.type !== 'recovery')) return <InvalidInvitation />

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">HelloPx</p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-950">Aceptar invitación</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">Cuando estés lista, acepta la invitación para continuar con la creación de tu contraseña.</p>
        <AcceptInvitationForm tokenHash={params.token_hash} type={params.type} />
      </section>
    </main>
  )
}
