import Link from 'next/link'
import Image from 'next/image'

import ScrollReveal from '@/components/scroll-reveal'
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
      <div className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 opacity-65"
          style={{
            backgroundImage: 'linear-gradient(to right, rgba(39,39,42,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(39,39,42,0.04) 1px, transparent 1px), linear-gradient(to right, rgba(39,39,42,0.018) 1px, transparent 1px), linear-gradient(to bottom, rgba(39,39,42,0.018) 1px, transparent 1px)',
            backgroundSize: '40px 40px, 40px 40px, 160px 160px, 160px 160px',
            maskImage: 'radial-gradient(ellipse 82% 90% at 50% 0%, black 0%, black 38%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 82% 90% at 50% 0%, black 0%, black 38%, transparent 100%)',
          }}
        />
        <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"><Image src="/logo.png?v=2" alt="" width={32} height={32} />HelloPx</Link>
        <Link href="/login" className="-mr-3 -my-1 inline-flex items-center px-3 py-3 text-sm font-medium text-[#258db0] underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Iniciar sesión</Link>
        </header>

        <div className="relative z-10 mx-auto max-w-6xl px-6 lg:px-8">
        <section className="grid items-center gap-16 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)] lg:gap-24 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-zinc-600">Asistente virtual para consultorios médicos</p>
            <h1 className="mt-6 max-w-xl text-5xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-6xl sm:leading-[1.04]">HelloPx es el asistente de citas de tu consultorio.</h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">Atiende llamadas, consulta tu disponibilidad y ayuda a tus pacientes a agendar.</p>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-600">Úsalo para todas tus llamadas o solamente cuando tu equipo no pueda atender.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a href="#que-hace" className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-transform hover:bg-zinc-800 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Conocer HelloPx</a>
            </div>
          </div>

          <div aria-label="Vista conceptual del trabajo de HelloPx" className="relative">
            <div className="absolute -inset-5 rounded-[2rem] bg-zinc-50" aria-hidden="true" />
            <div className="relative rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_70px_-32px_rgba(24,24,27,0.35)] sm:p-7">
              <div className="flex items-center border-b border-zinc-200 pb-5">
                <div><p className="text-sm font-semibold text-zinc-950">HelloPx</p><p className="mt-1 text-xs text-zinc-600">Disponible 24/7</p></div>
              </div>
              <div className="space-y-5 py-6">
                <div className="rounded-xl bg-zinc-950 p-4 text-white"><p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">Llamada entrante</p><p className="mt-3 text-base leading-6">“Quiero agendar una cita”</p></div>
                <div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-[#258db0]" aria-hidden="true" /><p className="text-sm font-medium text-zinc-900">HelloPx consulta tu disponibilidad</p></div>
                <div className="border-t border-zinc-200 pt-5"><div className="flex items-center justify-between gap-4"><p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">Horarios disponibles</p><span className="text-xs text-zinc-500">Paciente elige</span></div><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">09:30</span><span className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">11:00</span><span className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">16:30</span></div></div>
                <div className="flex items-center gap-3 border-t border-zinc-200 pt-5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-500" aria-hidden="true">✓</span><p className="text-sm font-medium text-zinc-900">Solicitud lista para agendar</p></div>
              </div>
            </div>
          </div>
        </section>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <ScrollReveal><section id="que-hace" className="grid gap-12 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:gap-24 lg:py-28">
          <h2 className="order-1 max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight lg:order-2">Menos llamadas perdidas. Menos trabajo administrativo.</h2>
          <ul className="order-2 divide-y divide-zinc-200 border-y border-zinc-200 lg:order-1">{capabilities.map((capability, index) => <li key={capability} className="flex items-center gap-5 py-5 text-base text-zinc-700 sm:py-6"><span className="w-6 shrink-0 text-xs font-medium tabular-nums text-zinc-400">0{index + 1}</span><span>{capability}</span></li>)}</ul>
        </section></ScrollReveal>

        <ScrollReveal><section className="grid gap-10 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-24">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Menos preguntas repetitivas para ti y tu equipo</h2>
          <div className="max-w-2xl">
            <p className="text-lg leading-8 text-zinc-600">HelloPx también puede resolver dudas frecuentes sobre tu consultorio y tus servicios, para que tú y tu equipo no tengan que responder lo mismo una y otra vez.</p>
            <p className="mt-5 text-lg leading-8 text-zinc-600">Puede orientar a tus pacientes sobre ubicación, horarios, tipos de cita, servicios, costos autorizados y otros detalles administrativos.</p>
            <p className="mt-8 border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">Tú decides qué información puede comunicar.</p>
            <ul className="mt-8 grid gap-x-8 gap-y-4 border-t border-zinc-200 pt-6 sm:grid-cols-2">
              <li className="border-b border-zinc-200 pb-3 text-sm text-zinc-600">¿Dónde está el consultorio?</li>
              <li className="border-b border-zinc-200 pb-3 text-sm text-zinc-600">¿Qué horarios manejan?</li>
              <li className="border-b border-zinc-200 pb-3 text-sm text-zinc-600">¿Qué tipo de citas ofrecen?</li>
              <li className="border-b border-zinc-200 pb-3 text-sm text-zinc-600">¿Cuánto cuesta la consulta?</li>
            </ul>
          </div>
        </section></ScrollReveal>
        <ScrollReveal><section className="grid gap-10 border-b border-zinc-200 py-16 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-24">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Más capacidad para tu consultorio</h2>
          <div className="max-w-2xl">
            <p className="text-lg leading-8 text-zinc-600">HelloPx puede trabajar por sí solo o junto con tu personal. Atiende llamadas y tareas repetitivas mientras tu equipo se concentra en los pacientes y situaciones que requieren atención humana.</p>
            <p className="mt-6 border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">Amplía tus horas de atención sin tener que ampliar proporcionalmente tu estructura de personal.</p>
            <div className="mt-10 grid gap-6 border-t border-zinc-200 pt-6 sm:grid-cols-3 sm:gap-4">
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">24/7</p><p className="mt-1 text-sm leading-6 text-zinc-600">Disponibilidad constante</p></div>
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">Menos interrupciones</p><p className="mt-1 text-sm leading-6 text-zinc-600">Para ti y tu equipo</p></div>
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">Más capacidad</p><p className="mt-1 text-sm leading-6 text-zinc-600">Sin aumentar proporcionalmente la estructura</p></div>
            </div>
          </div>
        </section></ScrollReveal>

        <ScrollReveal><section className="grid gap-8 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:gap-24 lg:py-28">
          <h2 className="order-1 max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight lg:order-2">Un asistente que trabaja con las reglas de tu consultorio</h2>
          <div className="order-2 max-w-2xl lg:order-1"><p className="border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">HelloPx apoya la operación administrativa del consultorio. No proporciona diagnósticos, recetas ni asesoramiento médico.</p></div>
        </section></ScrollReveal>

        <ScrollReveal><section className="py-20 sm:py-24 lg:py-28"><div className="max-w-2xl"><h2 className="text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Conoce HelloPx</h2><p className="mt-5 text-lg leading-8 text-zinc-600">Estamos trabajando con nuestros primeros consultorios para construir una mejor forma de atender y gestionar citas.</p><a href="mailto:hellopx.app@gmail.com" className="mt-8 inline-block text-sm font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 transition-colors hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">hellopx.app@gmail.com</a></div></section></ScrollReveal>

        <footer className="flex flex-col gap-4 border-t border-zinc-200 py-7 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between"><span>© HelloPx</span><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><Link href="/privacy" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Privacidad</Link><Link href="/terms" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Términos</Link><Link href="/data-deletion" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Eliminación de datos</Link><a className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950" href="mailto:hellopx@gmail.com"></a></div></footer>
      </div>
    </main>
  )
}
