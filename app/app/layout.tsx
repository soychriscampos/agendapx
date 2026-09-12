import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { logout } from '@/app/actions'
import { DoctorNavigation } from '@/components/doctor/doctor-navigation'
import { requireRole } from '@/lib/auth'

export const metadata: Metadata = {
  title: {
    default: 'HelloPx',
    template: '%s · HelloPx',
  },
  description: 'Espacio de trabajo del doctor en HelloPx',
}

export default async function DoctorLayout({ children }: { children: ReactNode }) {
  const user = await requireRole('DOCTOR')
  if (!user.onboarding_completed) redirect('/onboarding')

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 md:flex md:h-screen md:overflow-hidden">
      <aside className="border-b border-zinc-200 bg-white md:flex md:h-full md:w-64 md:shrink-0 md:flex-col md:overflow-hidden md:border-b-0 md:border-r">
        <div className="px-5 py-5 md:px-6 md:py-7">
          <p className="text-base font-semibold tracking-tight text-zinc-950">HelloPx</p>
          <p className="mt-1 text-xs text-zinc-500">Espacio del doctor</p>
          <DoctorNavigation />
        </div>

        <div className="hidden border-t border-zinc-200 px-6 py-5 md:mt-auto md:block">
          <p className="truncate text-sm font-medium text-zinc-800">{user.full_name}</p>
          <p className="mt-1 text-xs text-zinc-500">Doctor</p>
          <form action={logout} className="mt-4">
            <button
              type="submit"
              className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 md:h-full md:overflow-y-auto">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-4 md:hidden">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-800">{user.full_name}</p>
            <p className="text-xs text-zinc-500">Doctor</p>
          </div>
          <form action={logout} className="ml-4 shrink-0">
            <button
              type="submit"
              className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Salir
            </button>
          </form>
        </header>

        <main className="px-5 py-8 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  )
}
