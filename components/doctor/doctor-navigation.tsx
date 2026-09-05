'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navigationItems = [
  { href: '/app/agenda', label: 'Agenda' },
  { href: '/app/assistant', label: 'Mi asistente' },
  { href: '/app/requests', label: 'Solicitudes' },
  { href: '/app/settings', label: 'Configuración' },
]

export function DoctorNavigation() {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegación principal" className="mt-8">
      <ul className="grid grid-cols-2 gap-1.5 md:block md:space-y-1">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                  isActive
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
