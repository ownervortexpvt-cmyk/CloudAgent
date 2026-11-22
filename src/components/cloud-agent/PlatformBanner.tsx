'use client'

/**
 * v116 — PLATFORM ANNOUNCEMENT BANNER (control-room driven).
 * One cheap fetch of /api/auth/me (the same endpoint the shell already
 * hits); renders the owner's announcement banner at the top of the app
 * until dismissed for this session. Colors by severity level.
 */
import { useEffect, useState } from 'react'
import { X, Info, AlertTriangle, OctagonAlert } from 'lucide-react'

const LEVEL_STYLE = {
  info: 'bg-sky-950/70 border-sky-800 text-sky-200',
  warning: 'bg-amber-950/70 border-amber-800 text-amber-200',
  critical: 'bg-red-950/70 border-red-800 text-red-200',
} as const

const LEVEL_ICON = {
  info: Info,
  warning: AlertTriangle,
  critical: OctagonAlert,
} as const

export function PlatformBanner() {
  const [banner, setBanner] = useState<{ text: string; level: 'info' | 'warning' | 'critical' } | null>(null)
  const [dismissed, setDismissed] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.platform?.announcement) return
        setBanner({ text: String(j.platform.announcement), level: j.platform.announcementLevel || 'info' })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!banner || banner.text === dismissed) return null
  const Icon = LEVEL_ICON[banner.level] || Info

  return (
    <div className={`w-full flex items-start justify-between gap-3 border-b px-4 py-2 text-sm ${LEVEL_STYLE[banner.level]}`}>
      <div className="flex items-start gap-2 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{banner.text}</span>
      </div>
      <button
        aria-label="Dismiss announcement"
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        onClick={() => setDismissed(banner.text)}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
