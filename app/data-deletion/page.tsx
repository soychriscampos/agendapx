import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Eliminación de Datos | HelloPx',
  description: 'Instrucciones para solicitar la eliminación de datos personales asociados con HelloPx.',
}

const sections = [
  {
    title: 'Cómo solicitar la eliminación de datos',
    content: (
      <>
        <ol>
          <li>Envía un correo a <a href="mailto:hellopx.app@gmail.com?subject=Data%20Deletion%20Request">hellopx.app@gmail.com</a>.</li>
          <li>Utiliza como asunto <span className="font-medium text-zinc-950">Data Deletion Request</span>.</li>
          <li>Incluye suficiente información para que podamos identificar la cuenta, el registro del paciente, la información de contacto u otros datos relacionados con la solicitud.</li>
        </ol>
        <p>HelloPx puede solicitar información adicional únicamente para verificar la identidad o localizar correctamente los datos relacionados con la solicitud.</p>
      </>
    ),
  },
  {
    title: 'Qué sucede después',
    content: (
      <>
        <p>HelloPx revisará la solicitud y puede contactar al solicitante si necesita información adicional. HelloPx eliminará o anonimizará los datos cuando corresponda.</p>
        <p>HelloPx puede conservar cierta información cuando sea necesario por obligaciones legales, seguridad, prevención de fraude, resolución de disputas u otras razones legítimas.</p>
        <p>No necesariamente toda la información puede eliminarse en todos los casos.</p>
      </>
    ),
  },
  {
    title: 'Datos proporcionados por un consultorio médico',
    content: <p>Cuando los datos hayan sido proporcionados a HelloPx por un consultorio médico, algunas solicitudes pueden requerir coordinación con el consultorio correspondiente para identificar correctamente la información o determinar cómo debe procesarse la solicitud.</p>,
  },
  {
    title: 'Contacto',
    content: <p>Para solicitar la eliminación de datos, envía un correo a <a href="mailto:hellopx.app@gmail.com?subject=Data%20Deletion%20Request">hellopx.app@gmail.com</a>.</p>,
  },
]

export default function DataDeletion() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"><Image src="/logo.png?v=2" alt="" width={32} height={32} />HelloPx</Link>
        <Link href="/" className="text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Inicio</Link>
      </header>

      <article className="mx-auto max-w-3xl px-6 pb-20 pt-16 sm:pb-28 sm:pt-20 lg:px-8">
        <div className="border-b border-zinc-200 pb-12 sm:pb-16">
          <p className="text-sm font-medium text-zinc-500">HelloPx</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl sm:leading-tight">Eliminación de Datos</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">Puedes solicitar la eliminación de datos personales asociados con HelloPx contactándonos en la dirección de correo que aparece a continuación.</p>
          <p className="mt-6 text-sm text-zinc-500">Última actualización: 29 de septiembre de 2026</p>
        </div>

        <div className="divide-y divide-zinc-200">
          {sections.map((section) => (
            <section key={section.title} className="py-10 first:pt-12 sm:py-12 sm:first:pt-16">
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-950 sm:text-2xl">{section.title}</h2>
              <div className="mt-5 space-y-5 text-base leading-7 text-zinc-600 [&_a]:font-medium [&_a]:text-zinc-950 [&_a]:underline [&_a]:decoration-zinc-300 [&_a]:underline-offset-4 [&_a:hover]:decoration-zinc-950 [&_li]:ml-5 [&_li]:pl-2 [&_ol]:list-decimal [&_ol]:space-y-3">{section.content}</div>
            </section>
          ))}
        </div>
      </article>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 border-t border-zinc-200 px-6 py-7 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <span>© HelloPx</span>
        <nav aria-label="Navegación legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Inicio</Link>
          <Link href="/privacy" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Privacidad</Link>
          <Link href="/terms" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Términos</Link>
          <Link href="/data-deletion" className="text-[#258db0] underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Eliminación de datos</Link>
        </nav>
      </footer>
    </main>
  )
}
