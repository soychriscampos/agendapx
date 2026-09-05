import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-zinc-500">AgendaPX</p>
        <p className="mt-8 text-6xl font-semibold tracking-tight text-zinc-950">404</p>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-950">Lo siento, esta página no existe</h1>
        <p className="mt-3 text-sm text-zinc-600">La dirección que intentaste abrir no está disponible.</p>
        <Link href="/" className="mt-8 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
          Volver al inicio
        </Link>
      </section>
    </main>
  )
}
