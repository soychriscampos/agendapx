'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const REFRESH_INTERVAL_MS = 15_000

export function RequestLiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const refreshingRef = useRef(false)

  const refresh = useCallback(() => {
    if (!enabled || document.visibilityState !== 'visible' || refreshingRef.current || isPending) return
    refreshingRef.current = true
    startTransition(() => router.refresh())
  }, [enabled, isPending, router, startTransition])

  useEffect(() => {
    if (!isPending) refreshingRef.current = false
  }, [isPending])

  useEffect(() => {
    if (!enabled) return

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, refresh])

  return null
}
