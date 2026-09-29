import Link from 'next/link'
import Image from 'next/image'

import { redirectAuthenticatedUser } from '@/lib/auth'

const capabilities = [
  'Atiende llamadas de pacientes',
  'Consulta la disponibilidad del consultorio',
  'Gestiona solicitudes y citas',
  'Da seguimiento a confirmaciones y anticipos',
]

export default async function Home() {
  await redirectAuthenticatedUser()

  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"><Image src="/logo.png" alt="" width={32} height={32} />HelloPx</Link>
        <Link href="/login" className="text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Iniciar sesión</Link>
      </header>

      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <section className="grid items-center gap-16 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)] lg:gap-24 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-zinc-500">Asistente virtual para consultorios médicos</p>
            <h1 className="mt-6 max-w-xl text-5xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-6xl sm:leading-[1.04]">Tu consultorio puede contestar incluso cuando tú no puedes.</h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">HelloPx ayuda a consultorios médicos a atender llamadas, gestionar solicitudes de cita y mantener organizada su agenda mediante automatización e inteligencia artificial.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a href="#que-hace" className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-transform hover:bg-zinc-800 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Conocer HelloPx</a>
            </div>
          </div>

          <div aria-label="Vista conceptual del trabajo de HelloPx" className="relative">
            <div className="absolute -inset-5 rounded-[2rem] bg-zinc-50" aria-hidden="true" />
            <div className="relative rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_70px_-32px_rgba(24,24,27,0.35)] sm:p-7">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-5">
                <div><p className="text-sm font-semibold text-zinc-950">Actividad del consultorio</p><p className="mt-1 text-xs text-zinc-500">HelloPx está ayudando con lo importante</p></div>
                <span className="flex items-center gap-2 text-xs font-medium text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />Activo</span>
              </div>
              <div className="space-y-5 py-6">
                <div className="flex gap-4"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500">01</span><div><p className="text-sm font-medium text-zinc-900">Nueva solicitud de cita</p><p className="mt-1 text-sm leading-6 text-zinc-500">Se revisó la disponibilidad del consultorio.</p></div></div>
                <div className="flex gap-4"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500">02</span><div><p className="text-sm font-medium text-zinc-900">Seguimiento administrativo</p><p className="mt-1 text-sm leading-6 text-zinc-500">La confirmación quedó lista para revisión.</p></div></div>
              </div>
              <div className="border-t border-zinc-200 pt-5 text-xs text-zinc-400">Información administrativa, organizada.</div>
            </div>
          </div>
        </section>

        <section id="que-hace" className="grid gap-12 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Menos llamadas perdidas. Menos trabajo administrativo.</h2>
          <ul className="divide-y divide-zinc-200 border-y border-zinc-200">{capabilities.map((capability, index) => <li key={capability} className="flex items-center gap-5 py-5 text-base text-zinc-700 sm:py-6"><span className="w-6 shrink-0 text-xs font-medium tabular-nums text-zinc-400">0{index + 1}</span><span>{capability}</span></li>)}</ul>
        </section>

        <section className="grid gap-8 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Un asistente que trabaja con las reglas de tu consultorio</h2>
          <div className="max-w-2xl"><p className="text-lg leading-8 text-zinc-600">HelloPx puede configurarse con los horarios de atención, tipos de cita, preguntas que debe realizar al paciente, reglas administrativas e información del consultorio que está autorizado a proporcionar.</p><p className="mt-8 border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">HelloPx apoya la operación administrativa del consultorio. No proporciona diagnósticos, recetas ni asesoramiento médico.</p></div>
        </section>

        <section className="py-20 sm:py-24 lg:py-28"><div className="max-w-2xl"><h2 className="text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Conoce HelloPx</h2><p className="mt-5 text-lg leading-8 text-zinc-600">Estamos trabajando con nuestros primeros consultorios para construir una mejor forma de atender y gestionar citas.</p><a href="mailto:hellopx.app@gmail.com" className="mt-8 inline-block text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 transition-colors hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">hellopx.app@gmail.com</a></div></section>

        <footer className="flex flex-col gap-4 border-t border-zinc-200 py-7 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between"><span>© HelloPx</span><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><Link href="/privacy" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Privacidad</Link><Link href="/terms" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Términos</Link><Link href="/data-deletion" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Eliminación de datos</Link><a className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950" href="mailto:hellopx.app@gmail.com">hellopx.app@gmail.com</a></div></footer>
      </div>
    </main>
  )
}
