'use client'

import { useEffect, useRef } from 'react'
import styles from '@/app/landing.module.css'

export default function LandingEnhancements() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const root = document.getElementById('hellopx-landing')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let observer: IntersectionObserver | undefined

    if (root && !reducedMotion && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('visible')
          observer?.unobserve(entry.target)
        })
      }, { threshold: 0.06, rootMargin: '0px 0px -25px 0px' })

      root.querySelectorAll('[data-reveal]').forEach((element) => observer?.observe(element))
      root.classList.add(styles.motionReady)
    }

    const handleDemoClick = (event: MouseEvent) => {
      const trigger = event.target instanceof Element ? event.target.closest('[data-demo]') : null
      if (!trigger) return
      event.preventDefault()
      if (!dialogRef.current?.open) dialogRef.current?.showModal()
    }

    document.addEventListener('click', handleDemoClick)
    return () => {
      observer?.disconnect()
      root?.classList.remove(styles.motionReady)
      document.removeEventListener('click', handleDemoClick)
    }
  }, [])

  return (
    <dialog ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
      <div className="dialog-inner">
        <form method="dialog"><button className="close" aria-label="Cerrar">×</button></form>
        <h2>Agenda tu demo</h2>
        <p>El proceso de agenda de demostraciones aún está por definir. Esta referencia no registra solicitudes.</p>
        <form method="dialog"><button className="btn rounded-lg bg-zinc-900 text-sm font-medium text-white">Cerrar</button></form>
      </div>
    </dialog>
  )
}
