'use client'

/**
 * Control-room tab panels (v113). Each panel talks to its existing API —
 * all double-gated server-side (admin session + room unlock PIN).
 * v116 — Control (app switches), Data (backup/restore/cleanup), Projects
 * (every project, delete abuse) — the owner controls the WHOLE app here.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { afetch } from './admin-client'
import { bigBillionDayState } from '@/lib/bbd'

/* ─────────────────────────── shared bits ─────────────────────────── */

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border border-zinc-800/80 rounded-xl bg-zinc-950/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
        <h2 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'emerald' | 'amber' | 'red' | 'plain' }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : tone === 'red' ? 'text-red-400' : 'text-zinc-100'
  return (
    <div className="border border-zinc-800/80 rounded-xl bg-zinc-950/60 p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold font-mono ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

const fmtINR = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`

/** v115 — live Big Billion Day badge (pure client clock, same lib the server guards use). */
function BbdBadge() {
  const [state, setState] = useState<ReturnType<typeof bigBillionDayState> | null>(null)
  useEffect(() => {
    const tick = () => setState(bigBillionDayState())
    tick()
    const t = setInterval(tick, 30_000)
    return () => clearInterval(t)
  }, [])
  if (!state) return <span className="font-mono text-xs text-zinc-500">…</span>
  if (state.active && state.endsAt) {
    const mins = Math.max(1, Math.round((new Date(state.endsAt).getTime() - Date.now()) / 60000))
    return <span className="font-mono text-xs text-emerald-400">LIVE · {mins} min left (free)</span>
  }
  const when = state.nextAt ? new Date(state.nextAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—'
  return <span className="font-mono text-xs text-zinc-500">closed · next {when} IST</span>
}

/* ─────────────────────────── OVERVIEW ─────────────────────────── */

interface Stats {
  users: { total: number; active: number; suspended: number }
  planBreakdown: { plan: string; name: string; priceINR: number; count: number }[]
  projects: number
  runs: { month: number; today: number }
  tokens: { month: number }
  revenue: { paidTotalINR: number }
  recentPayments: { id: string; plan: string; amountINR: number; method?: string; paidAt?: string; email?: string }[]
  providers: { count: number; rows: { id: string; name: string; kind: string; isDefault: boolean; role: string; category?: string }[] }
  localAi: { up: boolean; server?: string; models?: string[] }
  toolchains: { name: string; label: string; installed: boolean }[]
  storage: { dbMb: number; sdkMb: number; projectsMb: number; disk: { totalGb: number; usedGb: number; availGb: number } | null }
}

export function OverviewPanel({ onGoto }: { onGoto: (t: any) => void }) {
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setS(await afetch('/api/admin/panel/stats')) } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="text-sm text-red-400">{err}</div>
  if (!s) return <div className="font-mono text-sm text-zinc-600 animate-pulse">loading control-room stats…</div>

  const missingTc = s.toolchains.filter((t) => !t.installed)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Revenue (paid)" value={`₹${s.revenue.paidTotalINR.toLocaleString('en-IN')}`} tone="emerald" sub="all time" />
        <Stat label="Users" value={s.users.total} sub={`${s.users.active} active · ${s.users.suspended} suspended`} />
        <Stat label="Projects" value={s.projects} />
        <Stat label="AI runs" value={s.runs.month} sub={`${s.runs.today} today`} />
        <Stat label="Tokens / mo" value={s.tokens.month >= 1e6 ? `${(s.tokens.month / 1e6).toFixed(1)}M` : `${(s.tokens.month / 1e3).toFixed(0)}K`} />
        <Stat label="AI providers" value={s.providers.count} tone={s.providers.count > 0 ? 'emerald' : 'amber'} sub="unlimited keys" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Plan breakdown">
          <div className="space-y-2">
            {s.planBreakdown.map((p) => (
              <div key={p.plan} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">
                  {p.name} <span className="text-zinc-600 font-mono text-xs">{p.priceINR > 0 ? `₹${p.priceINR}/mo` : 'free'}</span>
                </span>
                <span className={`font-mono ${p.count > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>{p.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="System health">
          <div className="space-y-2 text-sm">
            {/* v115 — Big Billion Day clock: the owner sees the free window state at a glance */}
            <div className="flex justify-between"><span className="text-zinc-400">Big Billion Day</span>
              <BbdBadge /></div>
            <div className="flex justify-between"><span className="text-zinc-400">Local model server</span>
              <span className={s.localAi.up ? 'text-emerald-400 font-mono text-xs' : 'text-red-400 font-mono text-xs'}>
                {s.localAi.up ? `ONLINE · ${s.localAi.models?.length ?? 0} models` : 'OFFLINE'}
              </span></div>
            <div className="flex justify-between"><span className="text-zinc-400">Toolchains</span>
              <span className="font-mono text-xs text-zinc-300">
                {s.toolchains.filter((t) => t.installed).length}/{s.toolchains.length} installed
                {missingTc.length > 0 && (
                  <button className="ml-2 text-amber-400 underline underline-offset-2" onClick={() => onGoto('toolchains')}>install →</button>
                )}
              </span></div>
            {s.storage.disk && (
              <div className="flex justify-between"><span className="text-zinc-400">Disk</span>
                <span className="font-mono text-xs text-zinc-300">{s.storage.disk.usedGb} / {s.storage.disk.totalGb} GB used · {s.storage.disk.availGb} GB free</span></div>
            )}
            <div className="flex justify-between"><span className="text-zinc-400">Storage</span>
              <span className="font-mono text-xs text-zinc-300">db {s.storage.dbMb}MB · sdk {s.storage.sdkMb}MB · projects {s.storage.projectsMb}MB</span></div>
          </div>
        </Card>
      </div>

      <Card title="Recent payments">
        {s.recentPayments.length === 0 ? (
          <p className="text-sm text-zinc-600">No paid orders yet — paste your Razorpay keys in the Razorpay tab to start collecting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-mono uppercase text-zinc-500 border-b border-zinc-800">
                <th className="py-1.5 pr-3">When</th><th className="py-1.5 pr-3">User</th><th className="py-1.5 pr-3">Plan</th><th className="py-1.5 pr-3">Amount</th><th className="py-1.5">Method</th>
              </tr></thead>
              <tbody>
                {s.recentPayments.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-900 last:border-0">
                    <td className="py-1.5 pr-3 text-zinc-400 font-mono text-xs">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}</td>
                    <td className="py-1.5 pr-3 text-zinc-300">{p.email || '—'}</td>
                    <td className="py-1.5 pr-3">{p.plan}</td>
                    <td className="py-1.5 pr-3 text-emerald-400 font-mono">₹{p.amountINR.toLocaleString('en-IN')}</td>
                    <td className="py-1.5 text-zinc-500 text-xs font-mono">{p.method || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ─────────────────────────── RAZORPAY ─────────────────────────── */

export function RazorpayPanel() {
  const [cfg, setCfg] = useState<any>(null)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // v115 — QUICK CONNECT (owner request): ONE box, paste the key pair from the
  // Razorpay dashboard in any format, press GET → connected instantly.
  const [paste, setPaste] = useState('')
  const [quickMsg, setQuickMsg] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  // v127 — ULTRA: real-time connection health + one-tap webhook copy
  const [testMsg, setTestMsg] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/billing/keys')
      setCfg(j)
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const j = await afetch('/api/billing/keys', { method: 'POST', body: JSON.stringify({ keyId, keySecret, webhookSecret: webhookSecret || undefined }) })
      setMsg(j.liveValidated ? '✅ Keys saved AND live-verified with Razorpay.' : '⚠️ Saved, but Razorpay did not accept the pair — check the dashboard copy.')
      setKeySecret(''); setKeyId('')
      load()
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy(false) }
  }

  /** v127 — ping Razorpay with the SAVED keys right now (catches revoked/regenerated keys). */
  const testConnection = async () => {
    setTestBusy(true); setTestMsg('')
    try {
      const j = await afetch('/api/billing/keys/test', { method: 'POST' })
      setTestMsg(`${j.ok ? '✅' : '❌'} ${j.detail || (j.ok ? 'Connection OK.' : 'Connection failed.')}`)
    } catch (e: any) { setTestMsg(`❌ ${e.message}`) } finally { setTestBusy(false) }
  }

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/billing/webhook`)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the URL is selectable text anyway */ }
  }

  /** v115 — smart paste → {keyId, keySecret}. Accepts:
   *  "rzp_live_xxx  secret" · "rzp_live_xxx:secret" · two lines · id only · secret only. */
  function parsePair(raw: string): { keyId?: string; keySecret?: string; error?: string } {
    const tokens = raw.trim().split(/[\s,:;|]+/).filter(Boolean)
    if (tokens.length === 0) return { error: 'Paste your Razorpay key first.' }
    const id = tokens.find((t) => /^rzp_(live|test)_/i.test(t))
    const secret = tokens.filter((t) => t !== id).sort((a, b) => b.length - a.length)[0]
    if (tokens.length === 1) {
      if (id) return { keyId: id, error: 'Key ID only — also paste the Key Secret from the same dashboard row.' }
      if (tokens[0].length >= 16) return { keySecret: tokens[0], error: cfg?.keyIdMasked ? undefined : 'Secret only — paste the Key ID (rzp_…) too.' }
      return { error: 'That does not look like a Razorpay key.' }
    }
    if (!id) return { error: 'No Key ID found — it starts with rzp_live_ or rzp_test_.' }
    if (!secret || secret.length < 16) return { error: 'Key Secret looks too short — copy the full secret.' }
    return { keyId: id, keySecret: secret }
  }

  const quickConnect = async () => {
    setQuickBusy(true); setQuickMsg('')
    try {
      const parsed = parsePair(paste)
      if (parsed.error && (!parsed.keyId || !parsed.keySecret)) {
        setQuickMsg(`⚠️ ${parsed.error}`)
        if (parsed.keyId) setKeyId(parsed.keyId)
        if (parsed.keySecret) setKeySecret(parsed.keySecret)
        return
      }
      const j = await afetch('/api/billing/keys', {
        method: 'POST',
        body: JSON.stringify({ keyId: parsed.keyId, keySecret: parsed.keySecret }),
      })
      if (j.liveValidated) {
        setQuickMsg('✅ CONNECTED — Razorpay accepted the keys. Checkout is live (UPI · cards · netbanking).')
        setPaste('')
        load()
      } else {
        setQuickMsg('❌ Razorpay REJECTED that pair — nothing was changed. Copy Key ID + Key Secret together from the dashboard.')
      }
    } catch (e: any) {
      setQuickMsg(`❌ ${e.message}`)
    } finally { setQuickBusy(false) }
  }

  const ModeBadge = ({ mode }: { mode?: 'live' | 'test' | 'none' }) => {
    if (mode === 'live') return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 tracking-wider">LIVE</span>
    if (mode === 'test') return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 tracking-wider">TEST</span>
    return null
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* v115 — QUICK CONNECT: the owner's requested one-box flow */}
      <Card title="Connect Razorpay — instant">
        <div className="space-y-3">
          <div className="text-sm text-zinc-400 flex items-center gap-2">
            Status: {cfg?.configured
              ? <>
                  <span className="text-emerald-400 font-mono text-xs">CONNECTED · key {cfg.keyIdMasked}{cfg.source ? ` · from ${cfg.source}` : ''}</span>
                  <ModeBadge mode={cfg.mode} />
                </>
              : <span className="text-amber-400 font-mono text-xs">NOT CONNECTED</span>}
          </div>
          <Input
            placeholder="[Enter your razorpay key]"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); quickConnect() } }}
            className="bg-black border-zinc-800 font-mono text-sm"
          />
          <div className="flex items-center gap-3">
            <Button disabled={quickBusy || !paste.trim()} onClick={quickConnect} className="bg-emerald-600 hover:bg-emerald-500 font-semibold">
              {quickBusy ? 'Connecting…' : 'Get'}
            </Button>
            <span className="text-xs text-zinc-500">Paste Key ID + Key Secret together → GET connects instantly. Verified against Razorpay&apos;s live API before saving.</span>
          </div>
          {quickMsg && <div className="text-xs text-zinc-300">{quickMsg}</div>}
          {cfg?.configured && (
            <div className="border-t border-zinc-800 pt-3 space-y-2">
              <div className="flex items-center gap-3">
                <Button variant="outline" disabled={testBusy} onClick={testConnection} className="h-8 text-xs">
                  {testBusy ? 'Testing…' : '🔌 Test connection'}
                </Button>
                <span className="text-xs text-zinc-500">Pings Razorpay with the SAVED keys right now — catches revoked/regenerated keys.</span>
              </div>
              {testMsg && <div className="text-xs text-zinc-300">{testMsg}</div>}
            </div>
          )}
          <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-2">
            Keys kothay pabo: Razorpay Dashboard → <span className="text-zinc-400">Account &amp; Settings → API Keys → Generate Test/Live Key</span>. Test keys (<code className="text-amber-400">rzp_test_…</code>) checkout test mode-e chalay — taka kate na.
          </div>
        </div>
      </Card>

      <Card title="Manual entry (advanced)">
        <div className="space-y-3">
          <div className="text-sm text-zinc-400">
            Status: {cfg?.configured
              ? <span className="text-emerald-400 font-mono text-xs">CONFIGURED · key {cfg.keyIdMasked}{cfg.source ? ` · from ${cfg.source}` : ''}</span>
              : <span className="text-amber-400 font-mono text-xs">NOT CONFIGURED — checkout shows honest "being configured" copy</span>}
          </div>
          <Input placeholder="rzp_live_… / rzp_test_…" value={keyId} onChange={(e) => setKeyId(e.target.value)} className="bg-black border-zinc-800 font-mono text-sm" />
          <Input type="password" placeholder="Key secret" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} className="bg-black border-zinc-800 font-mono text-sm" />
          <Input placeholder="Webhook secret (optional, re-enters)" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="bg-black border-zinc-800 font-mono text-sm" />
          <div className="flex items-center gap-3">
            <Button disabled={busy || !keyId || !keySecret} onClick={save} className="bg-emerald-600 hover:bg-emerald-500">
              {busy ? 'Saving & verifying…' : 'Save & verify keys'}
            </Button>
            <span className="text-xs text-zinc-500">Secrets are AES-256-GCM encrypted at rest</span>
          </div>
          {msg && <div className="text-xs text-zinc-300">{msg}</div>}
        </div>
      </Card>

      <Card title="Webhook (server-to-server backup)">
        <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5">
          <li>Razorpay Dashboard → Settings → Webhooks → Add New Webhook</li>
          <li className="flex items-center gap-2 flex-wrap">
            <span>URL:</span>
            <code className="text-emerald-400 font-mono text-xs break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/api/billing/webhook</code>
            <button onClick={copyWebhookUrl} className="text-xs px-2 py-0.5 rounded border border-zinc-700 hover:border-emerald-600 hover:text-emerald-400 transition-colors shrink-0">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </li>
          <li>Events: <span className="font-mono text-xs">payment.captured, order.paid, payment.failed, refund.processed</span></li>
          <li>Secret: the same webhook secret above (HMAC-SHA256 verified, fail-closed, AES-256-GCM encrypted at rest)</li>
        </ol>
        {cfg?.webhookConfigured
          ? <div className="mt-2 text-xs text-emerald-400">✓ Webhook secret saved — Razorpay can push payment events even if the user closes the browser mid-checkout.</div>
          : <div className="mt-2 text-xs text-amber-400">⚠ No webhook secret yet — checkout still works (HMAC verified), but the webhook backup stays off until you save one.</div>}
      </Card>
    </div>
  )
}

/* ─────────────────────────── AI PROVIDERS ─────────────────────────── */

const KINDS = ['openai', 'gemini', 'claude', 'groq', 'openrouter', 'openai-compatible', 'custom']

export function ProvidersPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [form, setForm] = useState({ name: '', kind: 'openai-compatible', apiKey: '', model: '', endpoint: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/providers')
      setRows(j.providers || j.rows || [])
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setBusy(true); setMsg('')
    try {
      await afetch('/api/providers', { method: 'POST', body: JSON.stringify(form) })
      setMsg(`✅ "${form.name}" added — unlimited keys welcome.`)
      setForm({ name: '', kind: 'openai-compatible', apiKey: '', model: '', endpoint: '' })
      load()
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy(false) }
  }

  const del = async (id: string, name: string) => {
    if (!confirm(`Remove provider "${name}"?`)) return
    try { await afetch(`/api/providers?id=${id}`, { method: 'DELETE' }); load() } catch (e: any) { setMsg(e.message) }
  }

  return (
    <div className="space-y-5">
      <Card title={`Provider pool (${rows.length} — unlimited)`}>
        {rows.length === 0 ? <p className="text-sm text-zinc-600">No providers yet.</p> : (
          <div className="space-y-1.5">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm border border-zinc-900 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-zinc-200">{p.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-zinc-500">{p.kind}{p.model ? ` · ${p.model}` : ''}</span>
                  {p.isDefault && <span className="ml-2 text-[10px] font-mono px-1 rounded bg-emerald-950 text-emerald-400">DEFAULT</span>}
                  {p.category && <span className="ml-1 text-[10px] font-mono text-zinc-600">{p.category}</span>}
                </div>
                <button onClick={() => del(p.id, p.name)} className="text-xs text-red-400/70 hover:text-red-400 shrink-0">remove</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-zinc-600 mt-3">Full manager (health checks, roles, bulk import) lives in the builder: Settings → AI Providers.</p>
      </Card>

      <Card title="Add provider / key">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input placeholder="Display name (e.g. OpenRouter main)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-black border-zinc-800 text-sm" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-black border border-zinc-800 rounded-md px-3 text-sm text-zinc-300 h-9">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <Input placeholder="API key" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="bg-black border-zinc-800 font-mono text-sm" />
          <Input placeholder="Model (e.g. gpt-4o / gemini-2.0-flash)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="bg-black border-zinc-800 font-mono text-sm" />
          <Input placeholder="Base URL (openai-compatible / custom only)" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} className="bg-black border-zinc-800 font-mono text-sm sm:col-span-2" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={busy || !form.name} onClick={add} className="bg-emerald-600 hover:bg-emerald-500">{busy ? 'Adding…' : 'Add provider'}</Button>
          <span className="text-xs text-zinc-500">Duplicate keys are rejected (409). Users with no key ride the built-in GLM + local models.</span>
        </div>
        {msg && <div className="mt-2 text-xs text-zinc-300">{msg}</div>}
      </Card>
    </div>
  )
}

/* ─────────────────────────── LOCAL MODELS ─────────────────────────── */

export function LocalAiPanel() {
  const [st, setSt] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setSt(await afetch('/api/ai/local')) } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (action: string, tag?: string) => {
    setBusy(action + (tag || '')); setMsg('')
    try {
      await afetch('/api/ai/local', { method: 'POST', body: JSON.stringify({ action, tag }) })
      setMsg(action === 'install' ? `⏳ Pull started for ${tag} — check back in a few minutes (resumable).` : '✅ Done.')
      setTimeout(load, 1500)
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy('') }
  }

  if (!st && !msg) return <div className="font-mono text-sm text-zinc-600 animate-pulse">probing local runtime…</div>

  return (
    <div className="space-y-5">
      <Card title={`Local runtime — ${st?.up ? 'ONLINE' : 'OFFLINE'}`}
        right={<Button size="sm" variant="outline" className="border-zinc-800 text-xs" onClick={() => act('sync')}>Rescan</Button>}>
        <p className="text-sm text-zinc-400">
          {st?.up
            ? <>Serving at <span className="font-mono text-emerald-400 text-xs">{st.server}</span> · {st.installed?.length ?? 0} model(s) installed · users build with ZERO API keys.</>
            : <>Runtime down — the app watchdog restarts it automatically; large pulls need the owner's server (disk!).</>}
        </p>
        {msg && <div className="mt-2 text-xs text-zinc-300">{msg}</div>}
      </Card>

      <Card title="Model catalog — install / remove">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(st?.catalog || []).map((m: any) => {
            const installed = (st?.installed || []).some((t: string) => t === m.tag)
            return (
              <div key={m.tag} className="border border-zinc-900 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-200 font-medium">{m.name}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${installed ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-900 text-zinc-500'}`}>{installed ? 'INSTALLED' : '—'}</span>
                </div>
                <div className="text-[11px] text-zinc-500 font-mono">{m.tag} · {m.sizeGb ?? m.approxGb ?? '?'}GB{m.ram ? ` · ${m.ram} RAM` : ''}</div>
                <div className="text-[11px] text-zinc-600">{m.note || m.description || ''}</div>
                {installed
                  ? <Button size="sm" variant="outline" className="w-full border-zinc-800 text-xs text-red-400/80 hover:text-red-400" onClick={() => act('remove', m.tag)}>Remove</Button>
                  : <Button size="sm" variant="outline" className="w-full border-zinc-800 text-xs hover:border-emerald-800" disabled={!!busy} onClick={() => act('install', m.tag)}>{busy === 'install' + m.tag ? 'Starting…' : 'Install'}</Button>}
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-zinc-600 mt-3">GGUF models via Ollama/llama.cpp · every install auto-provisions a free zero-key provider row. Big models (gpt-oss:120b, GLM 5.3) belong on a real server, not a small sandbox.</p>
      </Card>
    </div>
  )
}

/* ─────────────────────────── USERS ─────────────────────────── */

export function UsersPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/admin/users')
      setRows(j.users || [])
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any, okMsg: string) => {
    try { await afetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }); setMsg(okMsg); load() } catch (e: any) { setMsg(`❌ ${e.message}`) }
  }

  const setPlan = async (u: any) => {
    const plan = prompt(`Plan for ${u.email}\n(${['free', 'pro', 'pro_plus', 'ultra', 'pro_max', 'ultra_pro_max'].join(' | ')})`, u.plan)
    if (!plan || plan === u.plan) return
    await post({ action: 'set_plan', userId: u.id, plan }, `✅ ${u.email} → ${plan} (30 days from now)`)
  }
  const resetPw = async (u: any) => {
    const pw = prompt(`New temporary password for ${u.email} (min 8 chars, all their sessions will be revoked)`)
    if (!pw || pw.length < 8) return
    await post({ action: 'reset_password', userId: u.id, newPassword: pw }, `✅ Password reset for ${u.email}`)
  }
  const toggleStatus = async (u: any) => {
    const to = u.status === 'active' ? 'suspended' : 'active'
    if (!confirm(`${to === 'suspended' ? 'SUSPEND (ban)' : 'Reactivate'} ${u.email}?`)) return
    await post({ action: 'set_status', userId: u.id, status: to }, `✅ ${u.email} → ${to}`)
  }

  const filtered = rows.filter((u) => !q || (u.email + u.name).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input placeholder="Search email / name…" value={q} onChange={(e) => setQ(e.target.value)} className="bg-black border-zinc-800 text-sm max-w-xs" />
        <span className="text-xs text-zinc-500">{filtered.length} / {rows.length} users</span>
      </div>
      {msg && <div className="text-xs text-zinc-300">{msg}</div>}
      <Card title="Accounts — full control">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] font-mono uppercase text-zinc-500 border-b border-zinc-800">
              <th className="py-1.5 pr-3">User</th><th className="py-1.5 pr-3">Plan</th><th className="py-1.5 pr-3">Usage / mo</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-zinc-900 last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <div className="text-zinc-200">{u.email}</div>
                    <div className="text-[11px] text-zinc-600">{u.name || '—'} · joined {new Date(u.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`font-mono text-xs ${u.plan !== 'free' ? 'text-emerald-400' : 'text-zinc-500'}`}>{u.planName || u.plan}</span>
                    {u.planExpiresAt && <div className="text-[10px] text-zinc-600">till {new Date(u.planExpiresAt).toLocaleDateString()}</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-400 font-mono">{u.usage?.projects || 0}p · {u.usage?.runs || 0}r · {((u.usage?.tokens || 0) / 1e3).toFixed(0)}k</td>
                  <td className="py-2 pr-3">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${u.status === 'active' ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>{u.status?.toUpperCase()}</span>
                  </td>
                  <td className="py-2 text-xs space-x-2 whitespace-nowrap">
                    <button className="text-emerald-400/80 hover:text-emerald-400" onClick={() => setPlan(u)}>plan</button>
                    <button className="text-amber-400/80 hover:text-amber-400" onClick={() => resetPw(u)}>reset pw</button>
                    {u.role !== 'admin' && <button className={u.status === 'active' ? 'text-red-400/70 hover:text-red-400' : 'text-zinc-400 hover:text-zinc-200'} onClick={() => toggleStatus(u)}>{u.status === 'active' ? 'suspend' : 'activate'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ─────────────────────────── TOOLCHAINS ─────────────────────────── */

export function ToolchainsPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [logs, setLogs] = useState<Record<string, any>>({})
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await afetch('/api/admin/panel/stats')
      setRows(s.toolchains || [])
      const l = await afetch('/api/admin/panel/toolchains')
      setLogs(l.logs || {})
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 8000) // poll install progress
    return () => clearInterval(t)
  }, [load])

  const install = async (name: string, approxMb: number) => {
    if (!confirm(`Install ${name}? ~${approxMb}MB download → disk usage grows accordingly. Continue?`)) return
    try {
      await afetch('/api/admin/panel/toolchains', { method: 'POST', body: JSON.stringify({ name }) })
      setMsg(`⏳ ${name} install started — resumable, log streams below.`)
      setTimeout(load, 2000)
    } catch (e: any) { setMsg(`❌ ${e.message}`) }
  }

  return (
    <div className="space-y-5">
      <Card title="Toolchains — Flutter / Android / JDK / more">
        <p className="text-xs text-zinc-500 mb-3">Flutter APK/AAB builds need: Flutter SDK + Android SDK (JDK 17 already installed). Installs are resumable — re-run any time.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((t) => {
            const log = logs[t.name]
            const running = log?.running
            return (
              <div key={t.name} className="border border-zinc-900 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-200">{t.label}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${t.installed ? 'bg-emerald-950 text-emerald-400' : running ? 'bg-amber-950 text-amber-400' : 'bg-zinc-900 text-zinc-500'}`}>
                    {t.installed ? 'READY' : running ? 'INSTALLING…' : 'MISSING'}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 font-mono">v{t.version} · ~{t.approxMb}MB</div>
                {!t.installed && <Button size="sm" variant="outline" className="w-full border-zinc-800 text-xs hover:border-emerald-800" onClick={() => install(t.name, t.approxMb)}>{running ? 'Running…' : 'Install'}</Button>}
              </div>
            )
          })}
        </div>
        {msg && <div className="mt-3 text-xs text-zinc-300">{msg}</div>}
      </Card>

      {Object.entries(logs).length > 0 && (
        <Card title="Install logs">
          <div className="space-y-3">
            {Object.entries(logs).map(([name, l]: any) => (
              <details key={name} open={l.running}>
                <summary className="text-xs font-mono text-zinc-400 cursor-pointer">{name} {l.running ? '· RUNNING' : `· idle · ${(l.bytes / 1024).toFixed(0)}KB`}</summary>
                <pre className="mt-2 max-h-64 overflow-auto text-[10px] leading-relaxed bg-black rounded-lg p-3 text-zinc-500 font-mono whitespace-pre-wrap">{l.tail}</pre>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/* ─────────────────────────── SECURITY ─────────────────────────── */

export function SecurityPanel({ onLocked }: { onLocked: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // v115: the owner asked for a password-change option INSIDE the admin panel
  // — this card changes the ADMIN LOGIN password (the /login credential),
  // separate from the room PIN card below.
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const changePin = async () => {
    setBusy(true); setMsg('')
    try {
      await afetch('/api/admin/panel/session', { method: 'POST', body: JSON.stringify({ action: 'change_pin', currentPin: current, nextPin: next }) })
      setMsg('✅ PIN changed — every previous unlock token was revoked (all devices re-lock instantly).')
      setCurrent(''); setNext('')
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy(false) }
  }

  const changePassword = async () => {
    if (pwNext !== pwConfirm) { setPwMsg('❌ New password and confirmation do not match.'); return }
    if (pwNext.length < 8) { setPwMsg('❌ New password must be at least 8 characters.'); return }
    setPwBusy(true); setPwMsg('')
    try {
      await afetch('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNext }) })
      setPwMsg('✅ Admin login password changed — all other devices were signed out; THIS device stays signed in.')
      setPwCurrent(''); setPwNext(''); setPwConfirm('')
    } catch (e: any) { setPwMsg(`❌ ${e.message}`) } finally { setPwBusy(false) }
  }

  const lockEverywhere = async () => {
    try { await afetch('/api/admin/panel/session', { method: 'DELETE' }) } catch {}
    onLocked()
  }

  return (
    <div className="space-y-5 max-w-xl">
      <Card title="Change admin login password">
        <div className="space-y-3">
          <Input type="password" placeholder="Current password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} className="bg-black border-zinc-800 font-mono" />
          <Input type="password" placeholder="New password (min 8 chars)" value={pwNext} onChange={(e) => setPwNext(e.target.value)} className="bg-black border-zinc-800 font-mono" />
          <Input type="password" placeholder="Confirm new password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} className="bg-black border-zinc-800 font-mono" />
          <Button disabled={pwBusy || !pwCurrent || pwNext.length < 8 || !pwConfirm} onClick={changePassword} className="bg-emerald-600 hover:bg-emerald-500">{pwBusy ? 'Saving…' : 'Change password'}</Button>
          {pwMsg && <div className="text-xs text-zinc-300">{pwMsg}</div>}
          <p className="text-[11px] text-zinc-600">This is the password you type at /login. Every other device is signed out; the device you change it from stays signed in.</p>
        </div>
      </Card>

      <Card title="Change control-room PIN">
        <div className="space-y-3">
          <Input type="password" placeholder="Current PIN" value={current} onChange={(e) => setCurrent(e.target.value)} className="bg-black border-zinc-800 font-mono" />
          <Input type="password" placeholder="New PIN (min 6 chars)" value={next} onChange={(e) => setNext(e.target.value)} className="bg-black border-zinc-800 font-mono" />
          <Button disabled={busy || !current || next.length < 6} onClick={changePin} className="bg-emerald-600 hover:bg-emerald-500">{busy ? 'Saving…' : 'Change PIN'}</Button>
          {msg && <div className="text-xs text-zinc-300">{msg}</div>}
        </div>
      </Card>

      <Card title="Session policy">
        <ul className="text-sm text-zinc-400 space-y-1.5 list-disc list-inside">
          <li>Unlock tokens expire after <span className="font-mono text-zinc-200">12 hours</span> — the room re-locks itself twice a day.</li>
          <li>Token is HMAC-SHA256 signed with a 32-byte secret stored in the DB (regenerated if wiped).</li>
          <li>Dual channel (httpOnly cookie + <span className="font-mono text-xs">x-ca-admin</span> header) — works inside embeds/iframe previews.</li>
          <li>"Lock now" rotates the signing secret — ALL devices re-lock instantly, nothing stays valid.</li>
          <li>All control-room APIs are double-gated: admin session <span className="font-mono text-xs">AND</span> this PIN.</li>
        </ul>
        <Button variant="outline" className="mt-3 border-red-900 text-red-400 hover:bg-red-950/40" onClick={lockEverywhere}>Lock everywhere now</Button>
      </Card>
    </div>
  )
}

/* ─────────────────────────── CONTROL (v116) ─────────────────────────── */

interface ControlFlags {
  maintenance: boolean
  maintenanceMessage: string
  signupsEnabled: boolean
  aiRunsEnabled: boolean
  bbdOverride: '' | 'on' | 'off'
  announcement: string
  announcementLevel: 'info' | 'warning' | 'critical'
  siteOpen: boolean
}

function Toggle({ on, onChange, label, desc, tone }: { on: boolean; onChange: (v: boolean) => void; label: string; desc: string; tone: 'emerald' | 'red' | 'amber' }) {
  const dot = on ? (tone === 'red' ? 'bg-red-400' : 'bg-emerald-400') : 'bg-zinc-600'
  return (
    <div className="flex items-start justify-between gap-4 border border-zinc-900 rounded-xl p-3">
      <div className="min-w-0">
        <div className="text-sm text-zinc-200 font-medium flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />{label}
        </div>
        <div className="text-[11px] text-zinc-500 mt-0.5">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${on ? 'bg-emerald-600' : 'bg-zinc-800'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-zinc-100 transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

export function ControlPanel() {
  const [flags, setFlags] = useState<ControlFlags | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // editable copies (saved on demand — switches apply instantly, texts via Save)
  const [maintMsg, setMaintMsg] = useState('')
  const [announce, setAnnounce] = useState('')
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('info')

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/admin/panel/control')
      setFlags(j.flags)
      setMaintMsg(j.flags.maintenanceMessage)
      setAnnounce(j.flags.announcement)
      setLevel(j.flags.announcementLevel)
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const patch = async (p: Partial<ControlFlags>, okMsg: string) => {
    setBusy(true); setMsg('')
    try {
      const j = await afetch('/api/admin/panel/control', { method: 'POST', body: JSON.stringify({ patch: p }) })
      setFlags(j.flags)
      setMsg(`✅ ${okMsg}`)
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy(false) }
  }

  if (!flags && !msg) return <div className="font-mono text-sm text-zinc-600 animate-pulse">loading switches…</div>
  if (!flags) return <div className="text-sm text-red-400">{msg}</div>

  const bbdNow = bigBillionDayState(new Date(), flags.bbdOverride)

  return (
    <div className="space-y-5 max-w-2xl">
      <Card title="Site switches — instant, server-enforced">
        <div className="space-y-3">
          <Toggle
            on={flags.siteOpen}
            tone="emerald"
            label="Site open — users enter WITHOUT access code"
            desc="ON: anyone can open the site and sign in (pay → dashboard; Big Billion Day = free). OFF: the private access-code wall returns for every visitor."
            onChange={(v) => patch({ siteOpen: v }, v ? 'Site OPEN — no access code needed, users sign in directly.' : 'Access-code wall ON — visitors must enter the private key again.')}
          />
          <Toggle
            on={flags.maintenance}
            tone="red"
            label="Maintenance mode"
            desc="The WHOLE site shows a maintenance page for everyone except you. Razorpay webhooks keep working — payments still activate."
            onChange={(v) => patch({ maintenance: v }, v ? 'MAINTENANCE ON — the site is now closed for everyone but you.' : 'Maintenance OFF — site is open again.')}
          />
          {flags.maintenance && (
            <div className="space-y-2 pl-1">
              <Input value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} placeholder="Message shown on the maintenance screen" className="bg-black border-zinc-800 text-sm" />
              <Button size="sm" variant="outline" disabled={busy} className="border-zinc-800 text-xs" onClick={() => patch({ maintenanceMessage: maintMsg }, 'Maintenance message saved.')}>Save message</Button>
            </div>
          )}
          <Toggle
            on={flags.signupsEnabled}
            tone="emerald"
            label="New registrations open"
            desc="When OFF, signup returns “registrations temporarily closed”. Your first-account bootstrap is always exempt."
            onChange={(v) => patch({ signupsEnabled: v }, v ? 'Registrations OPEN.' : 'Registrations CLOSED — new signups refused.')}
          />
          <Toggle
            on={flags.aiRunsEnabled}
            tone="amber"
            label="AI builder runs"
            desc="When OFF, every non-admin AI run politely refuses (cost spike, incident, abuse). Admins are never blocked."
            onChange={(v) => patch({ aiRunsEnabled: v }, v ? 'AI runs ENABLED.' : 'AI runs PAUSED for all users.')}
          />
          <div className="border border-zinc-900 rounded-xl p-3">
            <div className="text-sm text-zinc-200 font-medium">Big Billion Day override</div>
            <div className="text-[11px] text-zinc-500 mt-0.5 mb-2">
              Clock right now: {bbdNow.active ? 'OPEN (free)' : 'closed'} · next window 1st of month, 8:00 IST
            </div>
            <div className="flex gap-2">
              {([
                { v: '', label: 'Clock decides' },
                { v: 'on', label: 'Force OPEN' },
                { v: 'off', label: 'Force SHUT' },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  disabled={busy}
                  onClick={() => patch({ bbdOverride: o.v }, o.v === '' ? 'BBD follows the monthly clock.' : o.v === 'on' ? 'BBD FORCED OPEN — everyone builds free.' : 'BBD FORCED SHUT — free window closed even if the clock says open.')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    flags.bbdOverride === o.v ? 'bg-emerald-950/50 text-emerald-300 border-emerald-900' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >{o.label}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Announcement banner — every user sees this">
        <div className="space-y-3">
          <Input
            value={announce}
            onChange={(e) => setAnnounce(e.target.value)}
            placeholder="e.g. Diwali sale — 20% off annual plans this week!"
            className="bg-black border-zinc-800 text-sm"
            maxLength={300}
          />
          <div className="flex items-center gap-2">
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as any)}
              className="bg-black border border-zinc-800 rounded-md px-2 text-xs text-zinc-300 h-9"
            >
              <option value="info">info (blue)</option>
              <option value="warning">warning (amber)</option>
              <option value="critical">critical (red)</option>
            </select>
            <Button size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-500" onClick={() => patch({ announcement: announce, announcementLevel: level }, announce.trim() ? 'Announcement is LIVE for all users.' : 'Announcement cleared.')}>
              {announce.trim() ? 'Publish banner' : 'Clear banner'}
            </Button>
            <span className="text-[11px] text-zinc-600">Rides the existing /api/auth/me call — users see it on their next screen load.</span>
          </div>
        </div>
      </Card>

      {msg && <div className="text-xs text-zinc-300">{msg}</div>}
    </div>
  )
}

/* ─────────────────────────── DATA (v116) ─────────────────────────── */

export function DataPanel() {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const downloadJson = async () => {
    setBusy('json'); setMsg('')
    try {
      const res = await fetch('/api/backup', { credentials: 'include' })
      if (!res.ok) { setMsg(`❌ Backup failed (${res.status})`); return }
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      a.href = url
      a.download = `cloud-agent-backup-${stamp}.json`
      a.click()
      URL.revokeObjectURL(url)
      const c = data.backup.counts
      setMsg(`✅ JSON backup — ${c.projects} project(s) · ${c.files} file(s) · ${c.providers} provider config(s) · ${c.runs} run(s). Keys never travel.`)
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy('') }
  }

  const downloadZip = async () => {
    setBusy('zip'); setMsg('')
    try {
      const res = await fetch('/api/backup-download?mint=1', { credentials: 'include' })
      if (!res.ok) { setMsg(`❌ Could not start ZIP (${res.status})`); return }
      const data = await res.json()
      if (!data?.token) { setMsg('❌ Token mint failed'); return }
      const a = document.createElement('a')
      a.href = `/api/backup-download?token=${data.token}`
      a.download = 'cloud-agent-full-backup.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setMsg('✅ ZIP download started — the whole platform (source, db, apps). First build can take ~1 min.')
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setTimeout(() => setBusy(''), 3000) }
  }

  const restore = async (file: File) => {
    setBusy('restore'); setMsg('')
    try {
      const json = JSON.parse(await file.text())
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(json),
        credentials: 'include',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setMsg(`❌ ${data?.error || 'Restore failed'}`); return }
      const s = data.stats
      setMsg(`✅ Restored: ${s.projectsCreated} created · ${s.projectsUpdated} updated · ${s.filesUpserted} files · ${s.runsImported} runs. Nothing deleted.`)
    } catch { setMsg('❌ Could not read that file as a CloudAgent backup') } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }

  const cleanup = async (target: string) => {
    if (target === 'all' && !confirm('Run the full safe cleanup? (old zips, orphan project dirs, next cache, tmp scratch — nothing live is touched)')) return
    setBusy(target); setMsg('')
    try {
      const j = await afetch('/api/admin/panel/cleanup', { method: 'POST', body: JSON.stringify({ target }) })
      const parts = Object.entries(j.freed || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}: ${v}MB`)
      setMsg(`✅ Freed ${j.totalMb}MB${parts.length ? ` — ${parts.join(' · ')}` : ' (already clean)'}`)
    } catch (e: any) { setMsg(`❌ ${e.message}`) } finally { setBusy('') }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <Card title="Backup & restore — the whole platform, owner-only">
        <p className="text-xs text-zinc-500 mb-3">
          v116: moved OUT of user Settings — this used to let ANY signed-in user download the entire business.
          Only you can reach it now.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!busy} onClick={downloadZip}>{busy === 'zip' ? 'Preparing…' : 'Download platform ZIP'}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={downloadJson}>{busy === 'json' ? 'Building…' : 'Download JSON snapshot'}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={() => fileRef.current?.click()}>{busy === 'restore' ? 'Restoring…' : 'Restore from JSON'}</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f) }} />
        </div>
      </Card>

      <Card title="Disk cleanup — one click, safe list only">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={() => cleanup('old-zips')}>{busy === 'old-zips' ? '…' : 'Old backup ZIPs'}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={() => cleanup('orphans')}>{busy === 'orphans' ? '…' : 'Orphan project dirs'}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={() => cleanup('next-cache')}>{busy === 'next-cache' ? '…' : 'Next build cache'}</Button>
          <Button size="sm" variant="outline" disabled={!!busy} className="border-zinc-800 text-xs" onClick={() => cleanup('tmp')}>{busy === 'tmp' ? '…' : 'Temp scratch'}</Button>
          <Button size="sm" disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-500" onClick={() => cleanup('all')}>{busy === 'all' ? 'Cleaning…' : 'Clean everything safe'}</Button>
        </div>
        <p className="text-[11px] text-zinc-600 mt-3">Never touches: the database, live projects, node_modules of running apps, AI models, SDKs.</p>
      </Card>

      {msg && <div className="text-xs text-zinc-300">{msg}</div>}
    </div>
  )
}

/* ─────────────────────────── PROJECTS (v116) ─────────────────────────── */

export function ProjectsPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const j = await afetch(`/api/admin/panel/projects?limit=200${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
      setRows(j.projects || [])
      setMsg('')
    } catch (e: any) { setMsg(e.message) } finally { setLoading(false) }
  }, [q])
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 250) // debounce search
    return () => clearTimeout(t)
  }, [load])

  const del = async (p: any) => {
    const owner = p.owner?.role === 'admin'
    if (!confirm(`DELETE "${p.name}" (${p.owner?.email || 'no owner'})? Files + runs gone for good.`)) return
    if (owner && !confirm('This belongs to the OWNER account. Type-2 confirm: really delete?')) return
    try {
      await afetch(`/api/admin/panel/projects?id=${p.id}${owner ? '&force=1' : ''}`, { method: 'DELETE' })
      setMsg(`✅ Deleted "${p.name}"`)
      load()
    } catch (e: any) { setMsg(`❌ ${e.message}`) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input placeholder="Search project name / owner email…" value={q} onChange={(e) => setQ(e.target.value)} className="bg-black border-zinc-800 text-sm max-w-xs" />
        <span className="text-xs text-zinc-500">{loading ? 'loading…' : `${rows.length} project(s)`}</span>
      </div>
      {msg && <div className="text-xs text-zinc-300">{msg}</div>}
      <Card title="Every project on the platform — full visibility">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] font-mono uppercase text-zinc-500 border-b border-zinc-800">
              <th className="py-1.5 pr-3">Project</th><th className="py-1.5 pr-3">Owner</th><th className="py-1.5 pr-3">Plan</th>
              <th className="py-1.5 pr-3">Files</th><th className="py-1.5 pr-3">Runs</th><th className="py-1.5 pr-3">Size</th><th className="py-1.5 pr-3">Updated</th><th className="py-1.5">Action</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`border-b border-zinc-900 last:border-0 ${p.deleted ? 'opacity-40' : ''}`}>
                  <td className="py-2 pr-3 text-zinc-200 max-w-40 truncate" title={p.name}>{p.name}</td>
                  <td className="py-2 pr-3 text-zinc-400 text-xs">{p.owner?.email || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{p.owner?.plan || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.files}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.runs}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.sizeMb == null ? '—' : `${p.sizeMb}MB`}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">{new Date(p.updatedAt).toLocaleDateString()}</td>
                  <td className="py-2">
                    <button onClick={() => del(p)} className="text-xs text-red-400/70 hover:text-red-400">delete</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-zinc-600 text-sm">No projects match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   v129 — UPI VERIFY QUEUE (owner request: AI-assisted payment verification)
   Users pay the owner's UPI ID directly, submit UTR + optional screenshot
   on the pricing page; this queue shows the AI verdict and one-tap
   approve/reject. Approve reuses the SAME activation path as Razorpay.
   ═══════════════════════════════════════════════════════════════════════ */

const UPI_VERDICT_STYLE: Record<string, string> = {
  'likely-valid': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  'needs-review': 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'likely-fraud': 'bg-red-500/15 text-red-300 border-red-500/40',
}

const UPI_STATUS_STYLE: Record<string, string> = {
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  failed: 'bg-red-500/15 text-red-300 border-red-500/40',
  created: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
}

export function UpiPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [busyId, setBusyId] = useState('')
  const [shot, setShot] = useState<{ id: string; url: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/admin/panel/upi')
      setRows(j.rows || [])
      setStats(j.stats || null)
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const act = async (id: string, action: 'approve' | 'reject' | 'ai') => {
    setBusyId(id + action)
    setMsg('')
    try {
      const j = await afetch('/api/admin/panel/upi', { method: 'POST', body: JSON.stringify({ id, action }) })
      setMsg(
        action === 'ai' && j.ai
          ? `🤖 AI re-check: ${j.ai.score}/100 — ${j.ai.verdict}`
          : `✅ ${j.message || 'Done.'}`
      )
      load()
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusyId('')
    }
  }

  const openShot = async (id: string) => {
    try {
      const j = await afetch(`/api/admin/panel/upi?screenshot=${id}`)
      if (j.screenshot) setShot({ id, url: j.screenshot })
      else setMsg('No screenshot stored for this row.')
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="UPI payments — AI-assisted verification"
        right={
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        }
      >
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Pending review" value={stats.pending} tone={stats.pending ? 'amber' : 'plain'} />
            <Stat label="Approved (24h)" value={stats.approvedToday} tone="emerald" />
            <Stat label="Rejected (24h)" value={stats.rejectedToday} tone={stats.rejectedToday ? 'red' : 'plain'} />
            <Stat label="Total approved" value={`₹${stats.totalApprovedINR ?? 0}`} />
          </div>
        )}
        {msg && <div className="text-xs mb-3 text-zinc-400">{msg}</div>}
        {!rows.length && (
          <div className="text-sm text-zinc-500">
            No UPI-direct submissions yet. They appear the moment a user pays your UPI id and submits the UTR.
          </div>
        )}
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-zinc-800/80 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b className="text-zinc-100">{r.email}</b>
                <span className="text-zinc-500">· {r.plan} · ₹{r.amountINR}</span>
                <span className="text-zinc-500 font-mono text-xs">· UTR {r.utr || '—'}</span>
                <span
                  className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
                    UPI_STATUS_STYLE[r.status] || 'border-zinc-700 text-zinc-400'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              {r.aiVerdict && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 ${UPI_VERDICT_STYLE[r.aiVerdict] || ''}`}>
                    🤖 AI {r.aiScore}/100 · {r.aiVerdict}
                  </span>
                  <span className="text-zinc-500">
                    {(r.aiReason || '').split(' | ').slice(0, 4).join(' · ')}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <Button size="sm" variant="outline" disabled={busyId === r.id + 'ai'} onClick={() => act(r.id, 'ai')}>
                  🤖 AI check
                </Button>
                {r.hasScreenshot && (
                  <Button size="sm" variant="outline" onClick={() => openShot(r.id)}>
                    🖼 Screenshot
                  </Button>
                )}
                {r.status === 'created' && (
                  <>
                    <Button size="sm" disabled={busyId === r.id + 'approve'} onClick={() => act(r.id, 'approve')}>
                      ✅ Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === r.id + 'reject'}
                      onClick={() => act(r.id, 'reject')}
                    >
                      ❌ Reject
                    </Button>
                  </>
                )}
                <span className="text-xs text-zinc-600">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
      {shot && (
        <Card
          title="Payment screenshot"
          right={
            <Button size="sm" variant="outline" onClick={() => setShot(null)}>
              Close
            </Button>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.url} alt="payment screenshot" className="max-h-[420px] rounded-lg border border-zinc-800" />
        </Card>
      )}
    </div>
  )
}

/* ─────────────────────────── EMAIL (v134) ─────────────────────────── */

const EMAIL_KIND_STYLE: Record<string, string> = {
  welcome: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  payment_submitted: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  payment_approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  payment_rejected: 'bg-red-500/15 text-red-300 border-red-500/40',
  broadcast: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  test: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
}

export function EmailPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [smtp, setSmtp] = useState<any>(null)
  const [msg, setMsg] = useState('')
  // smtp form
  const [fHost, setFHost] = useState('smtp.gmail.com')
  const [fPort, setFPort] = useState('465')
  const [fUser, setFUser] = useState('')
  const [fPass, setFPass] = useState('')
  const [fFrom, setFFrom] = useState('')
  // compose form
  const [cTo, setCTo] = useState('')
  const [cAll, setCAll] = useState(false)
  const [cSubject, setCSubject] = useState('')
  const [cBody, setCBody] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await afetch('/api/admin/panel/email')
      setRows(j.rows || [])
      setStats(j.stats || null)
      setSmtp(j.smtp || null)
      if (j.smtp) {
        setFHost(j.smtp.host || 'smtp.gmail.com')
        setFPort(String(j.smtp.port || 465))
        setFUser(j.smtp.user || '')
        setFFrom(j.smtp.from || '')
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const act = async (payload: Record<string, unknown>, busyKey: string) => {
    setBusy(busyKey)
    setMsg('')
    try {
      const j = await afetch('/api/admin/panel/email', { method: 'POST', body: JSON.stringify(payload) })
      setMsg(j.warning ? `⚠️ ${j.warning}` : j.error ? `❌ ${j.error}` : `✅ ${j.message || 'Done.'}`)
      load()
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  const send = () => {
    if (!cSubject.trim() || !cBody.trim()) {
      setMsg('❌ Subject and body are both required.')
      return
    }
    act(
      { action: 'send', to: cAll ? undefined : cTo.trim() || undefined, all: cAll || !cTo.trim() ? true : undefined, subject: cSubject, body: cBody },
      'send'
    )
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Queued (no SMTP)" value={stats.queued} tone={stats.queued ? 'amber' : 'plain'} />
          <Stat label="Sent" value={stats.sent} tone="emerald" />
          <Stat label="Failed" value={stats.failed} tone={stats.failed ? 'red' : 'plain'} />
          <Stat label="Active users" value={stats.users} />
        </div>
      )}
      {msg && <div className="text-xs text-zinc-400">{msg}</div>}

      <Card
        title="SMTP — where emails send from"
        right={
          smtp ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-xs">connected · {smtp.host}</span>
          ) : (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300 px-2 py-0.5 text-xs">not configured — emails queue</span>
          )
        }
      >
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          Gmail recommended: enable 2-step verification → create an <b>App Password</b> (myaccount.google.com/apppasswords) → use it below.
          Host <code className="text-zinc-400">smtp.gmail.com</code>, port <code className="text-zinc-400">465</code>. Every welcome / payment email sends from your address.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Input placeholder="smtp host" value={fHost} onChange={(e) => setFHost(e.target.value)} />
          <Input placeholder="port" value={fPort} onChange={(e) => setFPort(e.target.value)} />
          <Input placeholder="email (gmail)" value={fUser} onChange={(e) => setFUser(e.target.value)} />
          <Input type="password" placeholder={smtp ? 'app password (saved)' : 'app password'} value={fPass} onChange={(e) => setFPass(e.target.value)} />
          <Input placeholder={'from name (CloudAgent <you>)'} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => act({ action: 'save-smtp', host: fHost, port: Number(fPort) || 465, secure: Number(fPort) !== 587, user: fUser, pass: fPass || undefined, from: fFrom }, 'save')}
          >
            {busy === 'save' ? 'Verifying…' : smtp ? 'Update SMTP' : 'Save & verify'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !smtp} onClick={() => act({ action: 'test', to: fUser || smtp?.user }, 'test')}>
            {busy === 'test' ? 'Sending…' : 'Send test email'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !smtp} onClick={() => act({ action: 'clear-smtp' }, 'clear')}>
            Clear
          </Button>
        </div>
      </Card>

      <Card title="Compose — broadcast or single user">
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Input placeholder="to (leave empty + tick all = everyone)" value={cTo} onChange={(e) => setCTo(e.target.value)} disabled={cAll} />
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={cAll} onChange={(e) => setCAll(e.target.checked)} /> all users
            </label>
          </div>
          <Input placeholder="subject" value={cSubject} onChange={(e) => setCSubject(e.target.value)} />
          <textarea
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 min-h-28"
            placeholder={'email body — blank line = new paragraph'}
            value={cBody}
            onChange={(e) => setCBody(e.target.value)}
          />
          <Button size="sm" disabled={!!busy} onClick={send}>
            {busy === 'send' ? 'Sending…' : cAll || !cTo.trim() ? '📣 Send to all users' : '✉️ Send'}
          </Button>
        </div>
      </Card>

      <Card
        title="Outbox — every email (last 100)"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
            <Button size="sm" variant="outline" disabled={!!busy || !smtp} onClick={() => act({ action: 'flush' }, 'flush')}>
              {busy === 'flush' ? 'Flushing…' : 'Flush queue'}
            </Button>
          </div>
        }
      >
        {!rows.length && <div className="text-sm text-zinc-500">No emails yet. Welcome emails appear the moment users register.</div>}
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-zinc-800/80 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${EMAIL_KIND_STYLE[r.kind] || 'border-zinc-700 text-zinc-400'}`}>{r.kind}</span>
                <b className="text-zinc-200">{r.to}</b>
                <span className="text-zinc-400 text-xs">{r.subject}</span>
                <span
                  className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
                    r.status === 'sent'
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : r.status === 'failed'
                        ? 'border-red-500/40 bg-red-500/15 text-red-300'
                        : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{new Date(r.createdAt).toLocaleString('en-IN')}</span>
                {r.attempts > 0 && <span>· {r.attempts} attempt(s)</span>}
                {r.error && <span className="text-red-400/80">· {r.error}</span>}
                {r.status !== 'sent' && (
                  <button className="ml-auto text-zinc-400 hover:text-zinc-200 underline" disabled={!!busy} onClick={() => act({ action: 'retry', id: r.id }, 'r' + r.id)}>
                    retry now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ─────────────────── v149 — VORTEX & SELF-UPDATE panel ─────────────────── */

export function EcosystemPanel() {
  const [vx, setVx] = useState<any>(null)
  const [su, setSu] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const a = await afetch('/api/admin/vortex')
      setVx(a)
      setMsg('')
    } catch (e: any) { setMsg(`status load failed: ${e.message}`) }
    try {
      const b = await afetch('/api/admin/self-update')
      setSu(b)
    } catch (e: any) { /* keep the old snapshot on transient failure */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000) // live job progress (phase polling)
    return () => clearInterval(t)
  }, [load])

  const vortexAction = async (action: string, label: string) => {
    setBusy(action); setMsg('')
    try {
      const j = await afetch('/api/admin/vortex', { method: 'POST', body: JSON.stringify({ action }) })
      setMsg(`${label}: ${j.note || (j.ok ? 'done' : j.error || 'failed')}${j.mirror ? ` — mirror v${j.mirror.version} (${j.mirror.files} files)` : ''}${j.vortexHosting?.url ? ` — vortex URL: ${j.vortexHosting.url}` : ''}`)
    } catch (e: any) { setMsg(`${label} failed: ${e.message}`) }
    finally { setBusy(''); load() }
  }

  const startSelfUpdate = async () => {
    setBusy('selfupdate'); setMsg('')
    try {
      const j = await afetch('/api/admin/self-update', { method: 'POST', body: JSON.stringify({ action: 'start' }) })
      setMsg(j.note || j.error || 'started')
    } catch (e: any) { setMsg(`self-update failed to start: ${e.message}`) }
    finally { setBusy(''); load() }
  }

  const sites = (vx?.selfHostSites || []) as any[]
  const mirror = vx?.vortexWebsite?.mirror

  return (
    <div className="space-y-4">
      {/* ── SELF-UPDATE ── */}
      <Card title="Self-Update — CloudAgent's own build" right={
        <Button onClick={startSelfUpdate} disabled={busy === 'selfupdate' || su?.job?.running}
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950">
          {su?.job?.running ? 'Update running…' : 'Update self build'}
        </Button>
      }>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Current build" value={su?.current?.buildId?.slice(0, 10) || '—'} sub={su?.current?.mode === 'production' ? 'production' : 'dev mode'} tone={su?.current?.mode === 'production' ? 'emerald' : 'plain'} />
          <Stat label="Job phase" value={su?.job?.running ? String(su?.job?.phase || 'running') : String(su?.job?.phase || 'idle')} sub={su?.job?.running ? 'polling every 10s' : (su?.job?.updatedAt ? new Date(su.job.updatedAt).toLocaleTimeString('en-IN') : 'never run')} tone={su?.job?.phase === 'failed' ? 'red' : su?.job?.running ? 'amber' : 'emerald'} />
          <Stat label="Old → new" value={su?.job?.oldBuildId ? `${String(su?.job?.oldBuildId).slice(0, 6)} → ${String(su?.job?.buildId || '?').slice(0, 6)}` : '—'} sub="build ids" />
          <Stat label="Last update" value={su?.job?.finished ? (su?.job?.phase === 'done' ? 'SUCCESS' : 'FAILED') : '—'} sub={su?.job?.error || su?.job?.note || ''} tone={su?.job?.phase === 'failed' ? 'red' : 'emerald'} />
        </div>
        {su?.logTail ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-zinc-900 p-2 text-[10px] leading-4 text-zinc-400 whitespace-pre-wrap">{su.logTail}</pre>
        ) : null}
        <p className="mt-2 text-xs text-zinc-500">Rebuilds the agent with webpack (the 4GB-safe path) and swaps :3000 to the fresh production build. The site is briefly offline during the build; any failure falls back to the dev server automatically.</p>
      </Card>

      {/* ── VORTEX SERVER ── */}
      <Card title="VORTEX Server (:3200 — runs inside this agent)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Status" value={vx?.vortexServer?.online ? 'ONLINE' : 'DOWN'} sub={`port ${vx?.vortexServer?.port || 3200}`} tone={vx?.vortexServer?.online ? 'emerald' : 'red'} />
          <Stat label="Version" value={vx?.vortexServer?.version || '—'} sub="server payload version" />
          <Stat label="Registry" value={vx?.vortexServer?.registryOnline ?? '—'} sub="online components" />
          <Stat label="CloudAgent build" value={vx?.cloudAgent?.buildId?.slice(0, 10) || '—'} sub="this agent" />
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => vortexAction('restart-server', 'Restart')} disabled={busy === 'restart-server'} className="border-zinc-700 text-zinc-300">
            {busy === 'restart-server' ? 'Restarting…' : 'Restart server'}
          </Button>
          <a href="http://127.0.0.1:3200/api/gw/status" target="_blank" className="text-xs text-sky-400 underline self-center">gateway status</a>
        </div>
      </Card>

      {/* ── VORTEX WEBSITE ── */}
      <Card title="VORTEX Website — mirrored inside CloudAgent" right={
        <Button onClick={() => vortexAction('update-website', 'Update website')} disabled={busy === 'update-website'} className="bg-violet-600 hover:bg-violet-500 text-white">
          {busy === 'update-website' ? 'Syncing…' : 'Update VORTEX website'}
        </Button>
      }>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Mirror" value={mirror?.live ? `v${mirror.version}` : 'missing'} sub="served at /sites/vortex-website/" tone={mirror?.live ? 'emerald' : 'red'} />
          <Stat label="Files" value={mirror?.files ?? '—'} sub={`${((mirror?.bytes || 0) / 1024).toFixed(0)} KB`} />
          <Stat label="Synced" value={mirror?.updatedAt ? new Date(mirror.updatedAt).toLocaleTimeString('en-IN') : '—'} sub={mirror?.updatedAt ? new Date(mirror.updatedAt).toLocaleDateString('en-IN') : ''} />
          <Stat label="VORTEX hosting" value={vx?.vortexWebsite?.reserved ? ':3200 too' : '—'} sub="same payload on the vortex server" />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <a href="/sites/vortex-website/" target="_blank" className="text-emerald-400 underline">open inside CloudAgent ↗</a>
        </div>
      </Card>

      {/* ── SELF-HOSTED SITES ── */}
      <Card title={`Self-hosted sites (${sites.length}) — published INSIDE this agent`}>
        {sites.length === 0 ? (
          <p className="text-sm text-zinc-500">No sites yet — publish any project with the 🏠 Self-Host (CloudAgent) target.</p>
        ) : (
          <div className="divide-y divide-zinc-800">
            {sites.map((s) => (
              <div key={s.siteId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="text-zinc-200">{s.system ? '🌀 ' : ''}{s.name || s.siteId}</span>
                  <span className="ml-2 text-xs text-zinc-500">v{s.version} · {s.files} files · {((s.bytes || 0) / 1024).toFixed(0)} KB</span>
                </div>
                <a href={s.url} target="_blank" className="text-xs text-sky-400 underline">open ↗</a>
              </div>
            ))}
          </div>
        )}
      </Card>

      {msg ? <p className="rounded border border-sky-800 bg-sky-950/40 p-2 text-xs text-sky-300">{msg}</p> : null}
    </div>
  )
}

/* ─────────────────────────── SERVER SYSTEM (v161) ─────────────────────────── */

interface ServerInfo {
  ok: boolean
  host: { hostname: string; platform: string; arch: string; nodeVersion: string; uptimeSec: number; nextUptimeSec: number }
  cpu: { model: string; cores: number; loadAvg: number[] }
  mem: { totalMb: number; freeMb: number; usedPct: number }
  disk: { totalGb: number; freeGb: number; usedPct: number }
  toolchains: { name: string; label: string; version: string; present: boolean }[]
  flutter: { installed: boolean; version: string }
  tunnel: { url: string | null; pid: number | null; since: string | null }
  deploy: { backend: string | null }
  vault: { provider: string | null; connected: boolean; endpoint: string | null; bucket: string | null; enabled: boolean; lastBackupAt: string | null }
  db: { sizeMb: number; path: string }
  serverTime: string
}

const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function ServerPanel() {
  const [s, setS] = useState<ServerInfo | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    afetch('/api/admin/panel/server').then(setS).catch((e) => setErr(e.message))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 15000) // live — the owner watches the machine breathe
    return () => clearInterval(t)
  }, [load])

  if (err) return <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">Server info failed: {err}</p>
  if (!s) return <p className="font-mono text-sm text-zinc-500 animate-pulse">reading machine…</p>

  const memTone = s.mem.usedPct > 90 ? 'red' : s.mem.usedPct > 75 ? 'amber' : 'emerald'
  const diskTone = s.disk.usedPct > 90 ? 'red' : s.disk.usedPct > 75 ? 'amber' : 'emerald'
  const presentCount = s.toolchains.filter(t => t.present).length

  return (
    <div className="space-y-5">
      <Card title="This machine = Vortex Cloud Agent server" right={
        <span className="font-mono text-[11px] text-zinc-500">refreshed {new Date(s.serverTime).toLocaleTimeString('en-IN')}</span>
      }>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="CPU" value={`${s.cpu.cores} cores`} sub={s.cpu.model.slice(0, 34) || s.host.arch} />
          <Stat label="Memory" value={`${s.mem.usedPct}%`} sub={`${Math.round(s.mem.freeMb)} MB free of ${Math.round(s.mem.totalMb / 1024)} GB`} tone={memTone as any} />
          <Stat label="Disk" value={`${s.disk.usedPct}%`} sub={`${s.disk.freeGb} GB free of ${s.disk.totalGb} GB`} tone={diskTone as any} />
          <Stat label="Load avg" value={String(s.cpu.loadAvg[0])} sub={`1m · ${s.cpu.loadAvg[1]} 5m · ${s.cpu.loadAvg[2]} 15m`} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-500 sm:grid-cols-4">
          <div><span className="text-zinc-400 font-mono">OS</span> {s.host.platform} ({s.host.arch})</div>
          <div><span className="text-zinc-400 font-mono">Node</span> {s.host.nodeVersion}</div>
          <div><span className="text-zinc-400 font-mono">Machine up</span> {fmtUptime(s.host.uptimeSec)}</div>
          <div><span className="text-zinc-400 font-mono">App up</span> {fmtUptime(s.host.nextUptimeSec)}</div>
        </div>
      </Card>

      <Card title="Live serving chain">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Public site" value="pages.dev" sub="Cloudflare Pages (Workers proxy)" tone="emerald" />
          <Stat label="Tunnel" value={s.tunnel.url ? 'UP' : 'DOWN'} tone={s.tunnel.url ? 'emerald' : 'red'} sub={s.tunnel.since ? `since ${new Date(s.tunnel.since).toLocaleTimeString('en-IN')}` : 'no tunnel yet'} />
          <Stat label="Backend" value=":3000" sub={`SQLite ${s.db.sizeMb} MB · auto-boot on visit`} />
        </div>
        {s.tunnel.url && (
          <div className="mt-3 font-mono text-[11px] text-zinc-500 break-all">tunnel: {s.tunnel.url}</div>
        )}
        {s.deploy.backend && (
          <div className="mt-1 font-mono text-[11px] text-zinc-500 break-all">pages backend: {s.deploy.backend}</div>
        )}
      </Card>

      <Card title={`Toolchains — ${presentCount}/${s.toolchains.length} installed`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {s.toolchains.map((t) => (
            <div key={t.name} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${t.present ? 'border-emerald-900/60 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-950/60'}`}>
              <div className="min-w-0">
                <div className={`text-xs truncate ${t.present ? 'text-emerald-300' : 'text-zinc-500'}`}>{t.label}</div>
                <div className="text-[10px] font-mono text-zinc-600">v{t.version}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${t.present ? 'text-emerald-400 border-emerald-900' : 'text-zinc-600 border-zinc-800'}`}>
                {t.present ? 'READY' : '—'}
              </span>
            </div>
          ))}
        </div>
        {s.flutter.installed && (
          <p className="mt-3 text-xs text-emerald-400">Flutter {s.flutter.version} ready — Dart, web builds (flutter build web) and flutter run all work. Projects can run instantly.</p>
        )}
      </Card>

      <Card title="Storage vault">
        {s.vault.connected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Provider" value={s.vault.provider || 'S3'} tone="emerald" />
              <Stat label="Bucket" value={s.vault.bucket || '—'} sub="path-style S3" />
              <Stat label="Auto backup" value={s.vault.enabled ? 'ON' : 'OFF'} tone={s.vault.enabled ? 'emerald' : 'amber'} />
              <Stat label="Last backup" value={s.vault.lastBackupAt ? new Date(s.vault.lastBackupAt).toLocaleDateString('en-IN') : 'never'} />
            </div>
            <div className="font-mono text-[11px] text-zinc-500 break-all">endpoint: {s.vault.endpoint}</div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No cloud vault connected — backups stay local (SQLite {s.db.sizeMb} MB).</p>
        )}
      </Card>
    </div>
  )
}
