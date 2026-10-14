import Link from 'next/link'
import Image from 'next/image'

import HeroCallFlow from '@/components/hero-call-flow'
import ScrollReveal from '@/components/scroll-reveal'
import { redirectAuthenticatedUser } from '@/lib/auth'

const capabilities = [
  {
    title: 'Atiende llamadas',
    description: 'Responde a tus pacientes y resuelve dudas frecuentes.',
  },
  {
    title: 'Gestiona citas',
    description: 'Consulta tu disponibilidad y ayuda a agendar, reprogramar o cancelar.',
  },
  {
    title: 'Confirma citas por ti',
    description: 'Llama a tus pacientes antes de su cita para confirmar su asistencia.',
  },
  {
    title: 'Sigue tus reglas',
    description: 'Trabaja con tus horarios, tipos de cita y la información que tú autorices.',
  },
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
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">Atiende llamadas, consulta la disponibilidad de tu agenda y ayuda a tus pacientes a gestionar sus citas.</p>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-600">Puede encargarse de todas tus llamadas o entrar en acción solamente cuando tú o tu equipo no puedan atender.</p>
            <p className="mt-5 max-w-xl text-sm leading-6 text-zinc-600">Tus pacientes siguen llamando al número que ya conocen.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a href="mailto:hellopx.app@gmail.com?subject=Quiero%20probar%20HelloPx" className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-transform hover:bg-zinc-800 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Quiero probar HelloPx</a>
            </div>
          </div>

          <HeroCallFlow />
        </section>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <ScrollReveal><section id="que-hace" className="grid gap-12 border-b border-zinc-200 py-20 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Tu consultorio sigue atendiendo, incluso cuando tú no puedes contestar.</h2>
          <div className="max-w-2xl">
            <p className="max-w-xl text-lg leading-8 text-zinc-600">Mientras estás en consulta, atendiendo a un paciente o fuera del consultorio, alguien puede estar llamando para pedir información o intentar agendar.</p>
            <p className="mt-7 border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">Mientras tú atiendes a un paciente, HelloPx puede estar atendiendo al siguiente.</p>
            <ul className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200">
              {capabilities.map((capability) => <li key={capability.title} className="py-5 sm:py-6"><p className="text-base font-medium text-zinc-950">{capability.title}</p><p className="mt-2 text-sm leading-6 text-zinc-600">{capability.description}</p></li>)}
            </ul>
          </div>
        </section></ScrollReveal>

        <ScrollReveal><section className="grid gap-10 border-b border-zinc-200 py-16 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-24">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Menos interrupciones. Más capacidad.</h2>
          <div className="max-w-2xl">
            <p className="text-lg leading-8 text-zinc-600">HelloPx se ocupa de llamadas y tareas repetitivas alrededor de tu agenda para que tú y tu equipo puedan concentrarse en los pacientes.</p>
            <div className="mt-10 grid gap-6 border-t border-zinc-200 pt-6 sm:grid-cols-3 sm:gap-4">
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">24/7</p><p className="mt-1 text-sm leading-6 text-zinc-600">Puede atender aunque tu equipo no esté disponible.</p></div>
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">Confirmaciones</p><p className="mt-1 text-sm leading-6 text-zinc-600">No dependas de recordar cada llamada.</p></div>
              <div><p className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">Más llamadas atendidas</p><p className="mt-1 text-sm leading-6 text-zinc-600">Sin ampliar proporcionalmente tu estructura.</p></div>
            </div>
          </div>
        </section></ScrollReveal>

        <ScrollReveal><section className="grid gap-10 py-20 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
          <h2 className="max-w-md text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl sm:leading-tight">Tú decides cómo trabaja HelloPx.</h2>
          <div className="max-w-2xl">
            <p className="text-lg leading-8 text-zinc-600">Define tus horarios, tipos de cita, información autorizada y reglas del consultorio. HelloPx se encarga de seguirlas.</p>
            <p className="mt-7 border-l border-zinc-300 pl-5 text-sm leading-6 text-zinc-600">HelloPx apoya la operación administrativa del consultorio. No proporciona diagnósticos, recetas ni asesoramiento médico.</p>
            <div className="mt-14 border-t border-zinc-200 pt-12">
              <h3 className="text-2xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-3xl">¿Quieres ser de los primeros en probarlo?</h3>
              <p className="mt-5 text-lg leading-8 text-zinc-600">Estamos incorporando nuestros primeros consultorios.</p>
              <a href="mailto:hellopx.app@gmail.com?subject=Quiero%20probar%20HelloPx" className="mt-8 inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Quiero probar HelloPx</a>
            </div>
          </div>
        </section></ScrollReveal>

        <footer className="flex flex-col gap-4 border-t border-zinc-200 py-7 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between"><span>© HelloPx</span><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><Link href="/privacy" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Privacidad</Link><Link href="/terms" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Términos</Link><Link href="/data-deletion" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Eliminación de datos</Link><a className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950" href="mailto:hellopx@gmail.com"></a></div></footer>
      </div>
    </main>
  )
}
