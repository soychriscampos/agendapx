import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'

import AppointmentCalculator from '@/components/appointment-calculator'
import HeroConversation from '@/components/landing-v5/hero-conversation'
import LandingEnhancements from '@/components/landing-v5/landing-enhancements'
import ModeSelector from '@/components/landing-v5/mode-selector'
import { redirectAuthenticatedUser } from '@/lib/auth'
import styles from './landing.module.css'

const faqs = [
  ['¿Puedo activar y desactivar HelloPx cuando quiera?', 'Sí. La idea es que entre en acción en el momento que lo necesites.'],
  ['¿Qué pasa si salgo a un congreso o de vacaciones?', 'Sólo basta con bloquear esos días y HelloPx no ofrecerá citas mientras no estés.'],
  ['¿Necesito cambiar el número de mi consultorio?', 'No. Tus pacientes siguen llamando al número de siempre. HelloPx recibe las llamadas mediante el desvío de tu línea, siempre que sea compatible.'],
  ['¿Y si mi línea no permite desvío de llamadas?', 'Revisamos contigo las alternativas disponibles para tu línea.'],
  ['¿Puede trabajar junto con mi recepcionista?', 'Por supuesto. Y de hecho puede ayudarle a recibir las llamadas mientras atiende a los px que están en tu consultorio, así no se descuida nada.'],
  ['Sólo estoy yo en mi consultorio, ¿HelloPx es para mí?', 'HelloPx puede encargarse de todo el trabajo de recepción de llamadas mientras tú te enfocas en la consulta. Así que la respuesta es sí.'],
  ['¿HelloPx cuenta con agenda?', 'Sí. Esta agenda permite al asistente consultar disponibilidad, agendar y ver a quiénes llamar para confirmar su cita. Pero también tanto el asistente como tú, o alguien de tu equipo, pueden agregar citas o cancelarlas de manera manual.'],
]

function VoiceWave({ id, bars }: { id: string; bars: number }) {
  return (
    <span className="wave" id={id} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        const height = 7 + Math.round(Math.abs(Math.sin(index * 0.81) * Math.cos(index * 0.16)) * 30)
        const style = { '--h': `${height}px`, '--dur': `${0.7 + (index % 6) * 0.13}s`, '--delay': `${-index * 0.08}s` } as CSSProperties
        return <i key={index} style={style} />
      })}
    </span>
  )
}

export default async function Home() {
  await redirectAuthenticatedUser()

  return (
    <div className={`${styles.landing} flex min-h-screen flex-col bg-white text-zinc-900`}>
      <header className="nav wrap">
        <Link href="/" className="brand"><Image src="/logo.png?v=2" alt="" width={28} height={28} />HelloPx</Link>
        <nav aria-label="Navegación principal">
          <a href="#como">Cómo funciona</a>
          <a href="#calculadora">Calculadora</a>
          <a href="#faq">FAQ</a>
          <button className="btn rounded-lg bg-zinc-900 text-sm font-medium text-white" data-demo type="button">Agenda tu demo</button>
        </nav>
      </header>

      <main id="hellopx-landing" className="flex-1">
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <h1>El teléfono de tu consultorio <span className="blue">siempre contesta,</span> incluso fuera de horario.</h1>
              <p className="lead">HelloPx es un asistente de voz con inteligencia artificial. Atiende llamadas, agenda citas y llama para confirmarlas.</p>
              <button className="btn rounded-lg bg-zinc-900 text-sm font-medium text-white" data-demo type="button">Agenda tu demo ↗</button>
            </div>
            <HeroConversation />
          </div>
        </section>

        <section className="section wrap reveal" id="como" data-reveal>
          <p className="eyebrow">CÓMO FUNCIONA</p>
          <h2 className="how-title">Contesta el teléfono, atiende a tus px y agenda tus citas.</h2>
          <div className="steps">
            <article className="step"><p className="step-label">01 · CONECTA</p><h3>Tu mismo número.</h3><p>Hacemos el enlace con tu línea actual. Tus px marcan y reciben llamadas del número que ya conocen (plan celular o sígueme para fijos).</p></article>
            <article className="step"><p className="step-label">02 · CONVERSA</p><h3>Voz humana y en español.</h3><p>HelloPx atiende como lo haría cualquier asistente siguiendo las reglas de tu consultorio, resolviendo dudas y contestando de inmediato.</p></article>
            <article className="step"><p className="step-label">03 · CITAS</p><h3>Agenda y recordatorios.</h3><p>El asistente consulta disponibilidad y se pone de acuerdo con tu px para concretar una cita. También llamará para confirmarlas.</p></article>
          </div>
        </section>

        <section className="statement reveal" data-reveal><div className="wrap"><h2>Integra al <i>team</i> de tu consultorio o clínica a un asistente disponible <span>24/7</span>.</h2></div></section>

        <section className="section choice reveal" data-reveal>
          <div className="wrap choice-grid">
            <div>
              <h2>Tú decides cuándo entra en <span className="blue">acción.</span></h2>
              <ModeSelector />
              <p className="mode-end">Activa o desactiva cuando lo necesites. Así, si alguien llama para pedir información o intentar agendar, siempre será atendido.</p>
            </div>
            <aside className="rules">
              <h3>Reglas de tu consultorio</h3>
              <ul><li>Horarios de atención</li><li>Tipos de cita</li><li>Preguntas que hace al paciente</li><li>Confirmaciones</li><li>Información que puede dar</li><li>Días bloqueados</li></ul>
            </aside>
          </div>
        </section>

        <section className="section wrap reveal" id="calculadora" data-reveal>
          <h2>Cuánto vale <span className="blue">lo que hoy se pierde</span> por teléfono.</h2>
          <p className="calc-intro">Cada llamada es un posible px, descubre cuánto te están costando esas oportunidades. Desliza según tus estimaciones:</p>
          <AppointmentCalculator />
        </section>

        <section className="audio-section reveal" data-reveal>
          <div className="wrap audio-center">
            <p className="eyebrow">ESCUCHA A HELLOPX EN ACCIÓN</p>
            <h2>Descubre cómo sería hablar con el asistente.</h2>
            <button type="button" className="audio-visual" aria-label="Vista previa del reproductor; no hay audio cargado" disabled><VoiceWave id="audio-wave" bars={31} /></button>
            <p className="audio-disclaimer">Este audio representa una llamada con el asistente. Se utiliza la voz de HelloPx; el doctor y sus datos son ficticios para esta prueba.</p>
            <button className="btn light rounded-lg text-sm font-medium" data-demo type="button">Agenda tu demo ↗</button>
          </div>
        </section>

        <section className="section wrap limits reveal" data-reveal>
          <h2>Lo que HelloPx <span className="blue">no hace.</span></h2>
          <p><strong>No da consejo médico. No diagnostica ni receta.</strong> Sólo gestiona citas e información administrativa autorizada.</p>
        </section>

        <section className="section wrap faq reveal" id="faq" data-reveal>
          <h2>Preguntas frecuentes.</h2>
          <div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="final reveal" data-reveal>
          <div className="wrap">
            <h2>Sé de los primeros en conocer HelloPx.</h2>
            <p>Estamos construyendo el futuro con nuestros primeros consultorios y una mejor forma de atender llamadas, gestionar citas y dar seguimiento a tus px.</p>
            <button className="btn rounded-lg bg-zinc-900 text-sm font-medium text-white" data-demo type="button">Agenda tu demo ↗</button>
            <small>Sin compromiso de contratación.</small>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="footer-grid">
            <div><Link href="/" className="brand"><Image src="/logo.png?v=2" alt="" width={28} height={28} />HelloPx</Link><p>Asistente de voz con IA para consultorios. Contesta cuando lo necesites para que nunca dejes de atender las llamadas, incluso fuera de horario.</p></div>
            <div><h3>PRODUCTO</h3><a href="#como">Cómo funciona</a><a href="#calculadora">Calculadora</a><a href="#faq">FAQ</a></div>
            <div><h3>LEGAL</h3><Link href="/terms">Términos</Link><Link href="/privacy">Privacidad</Link><Link href="/data-deletion">Eliminación de datos</Link></div>
          </div>
          <div className="footer-bottom"><span>© HelloPx · <a href="https://x.com/soychriscampos">Christian Campos</a> · <span>{new Date().getFullYear()}</span></span><span>Hecho con <span className="heart">♥</span> en México</span></div>
        </div>
      </footer>
      <LandingEnhancements />
    </div >
  )
}
