import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Términos de Servicio | HelloPx',
  description: 'Términos de Servicio de HelloPx, plataforma de asistencia administrativa para consultorios médicos.',
}

const sections = [
  {
    title: '1. Acerca de HelloPx',
    content: <p>HelloPx proporciona herramientas de asistencia administrativa y automatización para consultorios médicos. El servicio puede ayudar con llamadas, disponibilidad, solicitudes de cita, citas, confirmaciones, anticipos y otros procesos administrativos configurados por un consultorio médico.</p>,
  },
  {
    title: '2. Servicio exclusivamente administrativo',
    content: <p>HelloPx es una plataforma de asistencia administrativa. No proporciona diagnósticos médicos, recetas, recomendaciones de tratamiento, servicios de emergencia ni asesoramiento médico. Las decisiones médicas siguen siendo responsabilidad de profesionales de la salud calificados. HelloPx no sustituye a un médico, la atención médica ni los servicios de emergencia.</p>,
  },
  {
    title: '3. Cuenta y uso autorizado',
    content: (
      <>
        <p>Al utilizar HelloPx, aceptas:</p>
        <ul>
          <li>Proporcionar información correcta y actualizada;</li>
          <li>Proteger las credenciales de tu cuenta;</li>
          <li>Utilizar el servicio únicamente para fines lícitos; y</li>
          <li>No interferir con la seguridad, operación o disponibilidad del servicio.</li>
        </ul>
      </>
    ),
  },
  {
    title: '4. Responsabilidades del consultorio',
    content: (
      <>
        <p>Cada consultorio médico es responsable de la exactitud y actualización de su configuración de HelloPx, incluyendo:</p>
        <ul>
          <li>Horarios y disponibilidad del consultorio;</li>
          <li>Tipos de cita y costos;</li>
          <li>Instrucciones y preguntas configuradas para pacientes;</li>
          <li>Reglas administrativas; y</li>
          <li>Información que el asistente está autorizado a comunicar.</li>
        </ul>
        <p>Los consultorios médicos son responsables de revisar y mantener actualizada esta información.</p>
      </>
    ),
  },
  {
    title: '5. Comunicaciones y funciones automatizadas',
    content: <p>HelloPx puede utilizar llamadas, correo electrónico, mensajería y otras herramientas automatizadas para operar las funciones configuradas por un consultorio médico. Los canales de comunicación y las funciones automatizadas específicas pueden variar según la configuración del servicio y la disponibilidad de la tecnología correspondiente.</p>,
  },
  {
    title: '6. Disponibilidad del servicio',
    content: <p>HelloPx busca mantener el servicio disponible y confiable, pero no garantiza un funcionamiento ininterrumpido o libre de errores. El servicio puede verse afectado por mantenimiento, problemas técnicos o fallas e interrupciones de proveedores externos.</p>,
  },
  {
    title: '7. Cambios al servicio',
    content: <p>HelloPx puede modificar, mejorar, agregar o retirar funciones conforme evolucione el producto. Procuraremos realizar los cambios de manera que apoyen la operación y utilidad continua del servicio.</p>,
  },
  {
    title: '8. Propiedad intelectual',
    content: <p>El software, la marca, el diseño y el contenido original de HelloPx pertenecen a HelloPx o a sus respectivos titulares. El uso del servicio no te transfiere la propiedad del software ni de ninguna propiedad intelectual de HelloPx.</p>,
  },
  {
    title: '9. Suspensión o terminación',
    content: <p>HelloPx puede suspender o terminar el acceso cuando sea necesario para atender un uso ilegal, un riesgo de seguridad, un incumplimiento material de estos Términos o una amenaza para la operación del servicio. También podemos tomar medidas razonables para proteger el servicio y a sus usuarios.</p>,
  },
  {
    title: '10. Limitación de responsabilidad',
    content: (
      <>
        <p>HelloPx es una herramienta administrativa y no puede garantizar que cada llamada sea contestada correctamente, que cada comunicación sea entregada, que los proveedores externos estén disponibles de forma continua o que el servicio esté completamente libre de errores.</p>
        <p>En la medida permitida por la ley, HelloPx no será responsable por pérdidas derivadas de confiar en información configurada por un consultorio médico, comunicaciones omitidas o gestionadas incorrectamente, o interrupciones fuera del control razonable de HelloPx. Nada de estos Términos limita derechos o responsabilidades que legalmente no puedan excluirse o limitarse.</p>
      </>
    ),
  },
  {
    title: '11. Privacidad',
    content: <p>Nuestra <Link href="/privacy">Política de Privacidad</Link> explica cómo HelloPx trata la información personal cuando utilizas el servicio.</p>,
  },
  {
    title: '12. Cambios a estos términos',
    content: <p>HelloPx puede actualizar estos Términos ocasionalmente. La fecha de la última actualización se mostrará en esta página. El uso continuo del servicio después de una actualización significa que aceptas los Términos actualizados.</p>,
  },
  {
    title: '13. Contacto',
    content: <p>Las preguntas sobre estos Términos pueden enviarse a <a href="mailto:hellopx.app@gmail.com">hellopx.app@gmail.com</a>.</p>,
  },
]

export default function TermsOfService() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"><Image src="/logo.png" alt="" width={32} height={32} />HelloPx</Link>
        <Link href="/" className="text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900">Inicio</Link>
      </header>

      <article className="mx-auto max-w-3xl px-6 pb-20 pt-16 sm:pb-28 sm:pt-20 lg:px-8">
        <div className="border-b border-zinc-200 pb-12 sm:pb-16">
          <p className="text-sm font-medium text-zinc-500">HelloPx</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl sm:leading-tight">Términos de Servicio</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">Estos Términos de Servicio regulan el acceso y uso de HelloPx. Al utilizar HelloPx, aceptas estos Términos.</p>
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
          <Link href="/privacy" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Privacidad</Link>
          <Link href="/terms" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Términos</Link>
          <Link href="/data-deletion" className="underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">Eliminación de datos</Link>
        </nav>
      </footer>
    </main>
  )
}
