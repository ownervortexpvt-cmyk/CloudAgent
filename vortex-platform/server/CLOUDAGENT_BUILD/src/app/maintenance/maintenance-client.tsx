'use client'

/**
 * v117.2 — admin-only self-heal for the maintenance screen.
 * Probes the session quietly; only an admin-role account sees the
 * "Turn maintenance off" button (normal users see nothing at all).
 * Pressing it flips platform_control_v1.maintenance=false and reloads.
 */
import { useEffect, useState } from 'react'

export default function MaintenanceClient() {
  const [admin, setAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let dead = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((d) => { if (!dead && d?.ok && d?.user?.role === 'admin') setAdmin(true) })
      .catch(() => {})
    return () => { dead = true }
  }, [])

  if (!admin) return null

  async function turnOff() {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/api/admin/panel/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { maintenance: false } }),
      })
      if (res.ok) {
        location.reload()
        return
      }
      setErr(`Failed (${res.status})`)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-2 space-y-2">
      <button
        type="button"
        onClick={turnOff}
        disabled={busy}
        className="rounded-lg bg-zinc-100 text-zinc-900 text-sm font-semibold px-5 py-2.5 hover:bg-white transition disabled:opacity-50"
      >
        {busy ? 'Turning off…' : 'Turn maintenance off (owner)'}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  )
}
