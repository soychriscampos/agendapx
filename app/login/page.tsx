import { LoginForm } from '@/app/login/login-form'
import { redirectAuthenticatedUser } from '@/lib/auth'

type LoginPageProps = { searchParams: Promise<{ error?: string }> }

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectAuthenticatedUser()
  const { error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">AgendaPX</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">Iniciar sesión</h1>
        <p className="mt-2 text-sm text-zinc-600">Accede al espacio de trabajo de tu cuenta.</p>
        <LoginForm initialError={error} />
      </section>
    </main>
  )
}
