'use client'

/**
 * v127 — PlanExpiryBanner — proactive renewal nudge.
 *
 * Fetches /api/billing/me once per shell mount: when the user is on a PAID
 * monthly plan that expires within 7 days, a slim amber banner appears above
 * the app: "Plan expires in N days — Renew now". The Renew button deep-links
 * to Settings → Plan & Billing via the existing settingsTabRequest store
 * flag. Dismissible for the session. Free/admin/lifetime plans and healthy
 * expiries (>7 days) render nothing.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'

interface Me {
  plan: string
  planKind: string
  planExpiresAt?: string | null
  expired?: boolean
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export default function PlanExpiryBanner() {
  const setSettingsTabRequest = useAppStore((s) => s.setSettingsTabRequest)
  const [me, setMe] = useState<Me | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/billing/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setMe(j) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!me || dismissed) return null
  if (me.planKind !== 'monthly' || me.expired || !me.planExpiresAt) return null

  const msLeft = new Date(me.planExpiresAt).getTime() - Date.now()
  if (!(msLeft > 0 && msLeft <= WINDOW_MS)) return null

  const days = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
  const openPlan = () => {
    setSettingsTabRequest('plan')
    useAppStore.setState({ settingsOpen: true })
  }

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-1.5 text-xs bg-amber-500/10 border-b border-amber-500/30 text-amber-300">
      <span>
        ⏰ Your <b className="capitalize">{me.plan.replace(/_/g, ' ')}</b> plan expires in{' '}
        <b>{days === 0 ? 'less than a day' : `${days} day${days > 1 ? 's' : ''}`}</b> — renew to keep your higher limits.
      </span>
      <button
        onClick={openPlan}
        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 transition-colors font-semibold"
      >
        Renew now
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-amber-400/70 hover:text-amber-300 ml-1">
        ✕
      </button>
    </div>
  )
}
