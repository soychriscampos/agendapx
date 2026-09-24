'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const navigationItems = [
  { href: '/app/agenda', label: 'Agenda' },
  { href: '/app/assistant', label: 'Mi asistente' },
  { href: '/app/requests', label: 'Solicitudes' },
  { href: '/app/settings', label: 'Configuración' },
]

export function DoctorNavigation() {
  const pathname = usePathname()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [pendingFromPath, setPendingFromPath] = useState<string | null>(null)

  return (
    <nav aria-label="Navegación principal" className="mt-8">
      <ul className="grid grid-cols-2 gap-1.5 md:block md:space-y-1">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const isPending = pendingHref === item.href && pendingFromPath === pathname

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isPending ? true : undefined}
                onClick={(event) => {
                  if (isPending) {
                    event.preventDefault()
                    return
                  }
                  if (!isActive) {
                    setPendingHref(item.href)
                    setPendingFromPath(pathname)
                  }
                }}
                className={`group flex min-h-11 items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                  isActive
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                } ${isPending ? 'nav-link-pending' : ''}`}
              >
                <span>{item.label}</span>
                <span aria-hidden="true" className="nav-link-indicator ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
