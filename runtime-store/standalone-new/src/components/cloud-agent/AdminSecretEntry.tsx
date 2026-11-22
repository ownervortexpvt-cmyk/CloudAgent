'use client'

/**
 * v115 — SECRET ADMIN ENTRY (owner request)
 *
 * "Ekta secret admin panel rakho — click kore password diye shorashori admin
 * panel e dukte parbo." A discreet trigger: click the marked element 5 times
 * within 3 seconds (like Android's developer-mode tap), a bare password box
 * appears, the owner types the room PIN, hits Enter — and lands straight
 * inside /admin, control room unlocked. No menu, no visible link anywhere.
 *
 * Security notes:
 *  - The PIN never lives in this file — the unlock POST verifies it against
 *    the scrypt hash server-side (same endpoint the /admin page uses).
 *  - Non-admin sessions get the generic "wrong password" — no info leak.
 *  - Rapid-tap counting resets after 3s of silence, so normal users clicking
 *    the logo never see anything.
 *
 * v117 — OWNER DISCOVERY: the owner reported "Admin dashboard/panel kothay"
 * — the 5-tap trigger was TOO secret for its own boss. Signed-in ADMIN-role
 * accounts now see a small shield button in the header that opens the same
 * PIN box (still PIN-gated, still invisible to every non-admin user). The
 * 5-tap secret trigger stays for the login page and anonymous use.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, ShieldCheck } from 'lucide-react'

export function AdminSecretEntry({ targetId, isAdmin }: { targetId: string; isAdmin?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const taps = useRef<number[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = document.getElementById(targetId)
    if (!el) return
    const onTap = () => {
      const now = Date.now()
      taps.current = taps.current.filter((t) => now - t < 3000)
      taps.current.push(now)
      if (taps.current.length >= 5) {
        taps.current = []
        setOpen(true)
      }
    }
    el.addEventListener('click', onTap)
    return () => el.removeEventListener('click', onTap)
  }, [targetId])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/panel/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        setOpen(false)
        setPin('')
        router.push('/admin') // control room unlocked — straight in
        return
      }
      if (res.status === 401 && /sign|log/i.test(String(d.error || ''))) {
        setError('Sign in with the owner account first.')
      } else {
        setError('Wrong password.')
      }
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  // v117 — admin-role accounts get a REAL, visible entry point (PIN still
  // required). Non-admins get nothing rendered — the panel stays secret.
  const trigger = isAdmin ? (
    <button
      type="button"
      title="Admin Control Room"
      aria-label="Admin Control Room"
      onClick={(e) => { e.stopPropagation(); setOpen(true) }}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition"
    >
      <ShieldCheck className="w-4 h-4" />
    </button>
  ) : null

  if (!open && !trigger) return null
  if (!open && trigger) return trigger
  return (
    <>
      {trigger}
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[320px] rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2 text-zinc-300 mb-4">
          <Lock className="w-4 h-4" />
          <span className="text-sm font-medium">Restricted</span>
        </div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg bg-black border border-zinc-800 px-3 py-2.5 text-sm font-mono tracking-widest outline-none focus:border-zinc-600 text-zinc-100"
        />
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pin}
          className="mt-4 w-full rounded-lg bg-zinc-100 text-zinc-900 text-sm font-semibold py-2.5 hover:bg-white transition disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
    </>
  )
}
