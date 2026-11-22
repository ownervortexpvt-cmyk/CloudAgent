'use client'

/**
 * v129 — UPI-direct pay box (owner request).
 * Shows the owner's UPI id as QR + copyable text, collects the UTR and an
 * optional screenshot, and submits to /api/billing/upi/submit. The AI verdict
 * is shown immediately; the plan activates when the admin approves.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { UPI_ID, upiDeepLink } from '@/lib/upi'

type AiVerdict = { score: number; verdict: string; reasons: string[] }

export function UpiPayBox({
  planId,
  planName,
  amountINR,
  signedIn,
  highlight,
}: {
  planId: string
  planName: string
  amountINR: number
  signedIn: boolean
  highlight?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [utr, setUtr] = useState('')
  const [shot, setShot] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ai, setAi] = useState<AiVerdict | null>(null)
  const [done, setDone] = useState(false)
  const link = upiDeepLink(amountINR, `CloudAgent ${planName}`)

  if (!open) {
    return (
      <button
        onClick={() => (signedIn ? setOpen(true) : router.push(`/register?plan=${planId}&kind=monthly&via=upi`))}
        className={`mt-6 inline-flex w-full justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
          highlight
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-emerald-600 text-white hover:bg-emerald-500'
        }`}
      >
        📲 Pay ₹{amountINR} via UPI — {planName}
      </button>
    )
  }

  const pickFile = (f: File | null) => {
    if (!f) {
      setShot('')
      return
    }
    if (f.size > 1_200_000) {
      setMsg('❌ Screenshot must be under 1.2 MB — you can also submit without it.')
      return
    }
    const r = new FileReader()
    r.onload = () => setShot(String(r.result || ''))
    r.readAsDataURL(f)
  }

  const submit = async () => {
    setBusy(true)
    setMsg('')
    setAi(null)
    try {
      const res = await fetch('/api/billing/upi/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, utr: utr.trim(), screenshot: shot || undefined }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'submission failed')
      setAi(j.ai || null)
      setDone(true)
      setMsg(j.message || 'Submitted for review!')
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-left space-y-3">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-white p-1.5 shrink-0">
          <QRCodeSVG value={link} size={96} />
        </div>
        <div className="text-xs space-y-1">
          <div className="text-muted-foreground">Scan with GPay / PhonePe / Paytm</div>
          <div className="font-mono text-sm font-semibold select-all break-all">{UPI_ID}</div>
          <div>
            Amount: <b>₹{amountINR}</b> · {planName}/month
          </div>
          <a href={link} className="text-emerald-400 underline">
            Open UPI app on this phone →
          </a>
        </div>
      </div>

      {done ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm space-y-1">
          <div>✅ {msg}</div>
          {ai && (
            <div className="text-xs">
              🤖 AI pre-check: <b>{ai.score}/100 — {ai.verdict}</b>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Your plan activates automatically the moment the admin approves. You can close this page.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Paid already? Enter the 12-digit UTR / reference number from your UPI app:
          </div>
          <input
            value={utr}
            onChange={(e) => setUtr(e.target.value.toUpperCase())}
            placeholder="e.g. 402512345678"
            maxLength={12}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono tracking-wider outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <label className="block text-xs text-muted-foreground">
            Payment screenshot (optional, max 1.2 MB — makes AI verification stronger):
            <input
              type="file"
              accept="image/*"
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs"
            />
          </label>
          {shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="preview" className="max-h-28 rounded-lg border" />
          )}
          <button
            onClick={submit}
            disabled={busy || utr.trim().length !== 12}
            className="inline-flex w-full justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Submitting…' : '✅ I have paid — submit for verification'}
          </button>
          {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
        </div>
      )}
      <button className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  )
}
