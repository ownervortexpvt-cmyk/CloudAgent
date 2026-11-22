'use client'

/**
 * v147 — chunk auto-recovery flag lifecycle root-fix.
 *
 * error.tsx / global-error.tsx set sessionStorage flags when they auto-reload
 * once after a stale-chunk failure. Previously that flag lived until the NEXT
 * error rendered (and was then cleared WITHOUT reloading), so a user whose tab
 * survived two server restarts got stuck on the manual "Try again" screen.
 *
 * This guard runs in the root layout: once the app has been alive for 12s the
 * session is considered healthy, so both auto-reload guards are cleared. Every
 * future restart error therefore gets a fresh free auto-recovery.
 */
import { useEffect } from 'react'

export default function ChunkGuard() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem('ca_err_autoreload')
        sessionStorage.removeItem('ca_gerr_autoreload')
      } catch {}
    }, 12_000)
    return () => clearTimeout(t)
  }, [])
  return null
}
