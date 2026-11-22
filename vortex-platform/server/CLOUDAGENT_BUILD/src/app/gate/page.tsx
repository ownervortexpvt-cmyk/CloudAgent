/**
 * v123 — /gate — the private-site key screen.
 * EVERY visitor without the gate cookie lands here first. One field, one
 * button, zero brand leakage. Correct key → cookie → straight to /login.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Lock, Loader2, ShieldCheck } from 'lucide-react'

export default function GatePage() {
  const router = useRouter()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // already open? skip the form
  useEffect(() => {
    fetch('/api/gate')
      .then((r) => r.json())
      .then((d) => { if (d?.open) router.replace('/login') })
      .catch(() => {})
  }, [router])

  const submit = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.ok) {
        router.replace('/login')
        router.refresh()
      } else {
        setErr(d?.error || 'Wrong key.')
        setBusy(false)
      }
    } catch {
      setErr('Network error — try again.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/15 text-amber-600 mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-semibold text-center">Private Access</h1>
        <p className="text-sm text-muted-foreground text-center mt-1 mb-5">
          Ei site shudhu invite-der jonno. Access key din.
        </p>
        <Input
          type="password"
          placeholder="Access key"
          value={key}
          onChange={(e) => { setKey(e.target.value); setErr('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          autoFocus
          className="mb-3"
        />
        {err && <p className="text-xs text-destructive mb-3">{err}</p>}
        <Button className="w-full" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          Enter
        </Button>
      </div>
    </div>
  )
}
