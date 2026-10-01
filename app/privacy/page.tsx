import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Política de Privacidad | HelloPx',
  description: 'Política de Privacidad de HelloPx para el tratamiento de información relacionada con el uso de la plataforma.',
}

const sections = [
  {
    title: '1. Información que recopilamos',
    content: (
      <>
        <p>Dependiendo de cómo se configure y utilice el servicio, HelloPx puede tratar:</p>
        <ul>
          <li>Información de la cuenta y del consultorio médico;</li>
          <li>Información de contacto;</li>
          <li>Información administrativa proporcionada durante llamadas o solicitudes de cita;</li>
          <li>Información sobre citas, disponibilidad, confirmaciones y seguimiento; y</li>
          <li>Información técnica básica necesaria para operar y proteger el servicio.</li>
        </ul>
        <p>La información concreta recopilada depende de la configuración del consultorio médico y de la forma en que se utiliza el servicio.</p>
      </>
    ),
  },
  {
    title: '2. Cómo utilizamos la información',
    content: (
      <>
        <p>HelloPx puede utilizar la información para:</p>
        <ul>
          <li>Operar y prestar el servicio;</li>
          <li>Gestionar llamadas y solicitudes de cita;</li>
          <li>Organizar y gestionar citas;</li>
          <li>Proporcionar información sobre disponibilidad;</li>
          <li>Realizar seguimiento administrativo;</li>
          <li>Enviar comunicaciones relacionadas con el servicio; y</li>
          <li>Mantener la seguridad, confiabilidad y soporte del servicio.</li>
        </ul>
      </>
    ),
  },
  {
    title: '3. Proveedores de servicios',
    content: (
      <>
        <p>HelloPx puede compartir información con proveedores tecnológicos cuando sea necesario para prestar y operar el servicio. Estos proveedores pueden incluir categorías como:</p>
        <ul>
          <li>Alojamiento e infraestructura;</li>
          <li>Bases de datos y autenticación;</li>
          <li>Correo electrónico;</li>
          <li>Telefonía y procesamiento de voz;</li>
          <li>Inteligencia artificial; y</li>
          <li>Servicios de mensajería, cuando corresponda.</li>
        </ul>
        <p>Estos proveedores tratan la información para prestar servicios a HelloPx.</p>
      </>
    ),
  },
  {
    title: '4. Compartición de datos',
    content: (
      <>
        <p className="font-medium text-zinc-950">HelloPx no vende información personal.</p>
        <p>La información puede compartirse:</p>
        <ul>
          <li>Con proveedores necesarios para operar el servicio;</li>
          <li>Cuando lo requiera la ley; o</li>
          <li>Cuando sea necesario para proteger derechos, seguridad o la integridad del servicio.</li>
        </ul>
      </>
    ),
  },
  {
    title: '5. Conservación de datos',
    content: <p>HelloPx conserva la información durante el tiempo necesario para operar el servicio, cumplir obligaciones legales, resolver disputas y proteger la seguridad del sistema.</p>,
  },
  {
    title: '6. Seguridad de los datos',
    content: <p>HelloPx aplica medidas técnicas y organizativas razonables destinadas a proteger la información. Sin embargo, ningún método de transmisión o almacenamiento puede garantizar una seguridad completa.</p>,
  },
  {
    title: '7. Tus derechos y solicitudes',
    content: (
      <p>Puedes contactar a HelloPx para solicitar acceso, corrección o eliminación de información personal cuando corresponda. Las solicitudes pueden enviarse a <a href="mailto:hellopx.app@gmail.com">hellopx.app@gmail.com</a>.</p>
    ),
  },
  {
    title: '8. Aclaración médica',
    content: <p>HelloPx proporciona asistencia administrativa para consultorios médicos. No proporciona diagnósticos médicos, recetas, recomendaciones de tratamiento ni asesoramiento médico.</p>,
  },
  {
    title: '9. Cambios a esta política',
    content: <p>HelloPx puede actualizar esta Política de Privacidad ocasionalmente. La fecha de la última actualización se mostrará en esta página.</p>,
  },
  {
    title: '10. Contacto',
    content: <p>Para preguntas o solicitudes relacionadas con la privacidad, contacta a <a href="mailto:hellopx.app@gmail.com">hellopx.app@gmail.com</a>.</p>,
  },
]

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"><Image src="/logo.png?v=2" alt="" width={32} height={32} />HelloPx</Link>
        <Link href="/" className="text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Inicio</Link>
      </header>

      <article className="mx-auto max-w-3xl px-6 pb-20 pt-16 sm:pb-28 sm:pt-20 lg:px-8">
        <div className="border-b border-zinc-200 pb-12 sm:pb-16">
          <p className="text-sm font-medium text-zinc-500">HelloPx</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl sm:leading-tight">Política de Privacidad</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">Esta Política de Privacidad describe cómo HelloPx recopila, utiliza y protege la información cuando utilizas el servicio.</p>
          <p className="mt-6 text-sm text-zinc-500">Última actualización: 29 de septiembre de 2026</p>
        </div>

        <div className="divide-y divide-zinc-200">
          {sections.map((section) => (
            <section key={section.title} className="py-10 first:pt-12 sm:py-12 sm:first:pt-16">
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-950 sm:text-2xl">{section.title}</h2>
              <div className="mt-5 space-y-5 text-base leading-7 text-zinc-600 [&_a]:font-medium [&_a]:text-zinc-950 [&_a]:underline [&_a]:decoration-zinc-300 [&_a]:underline-offset-4 [&_a:hover]:decoration-zinc-950 [&_li]:ml-5 [&_li]:pl-2 [&_ul]:list-disc [&_ul]:space-y-2">{section.content}</div>
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
