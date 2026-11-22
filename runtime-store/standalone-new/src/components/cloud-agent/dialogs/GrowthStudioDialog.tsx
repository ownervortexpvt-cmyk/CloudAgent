'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import {
  Rocket, BarChart3, Palette, ShieldCheck, Clock, CreditCard, Bell, Database,
  Loader2, Globe, Sparkles, RefreshCw, RotateCcw, Trash2, CheckCircle2, AlertTriangle, X, Copy,
} from 'lucide-react'

interface Props { projectId: string; projectName: string }
type Tab = 'monetize' | 'analytics' | 'assets' | 'growth' | 'security' | 'versions'

interface AnalyticsData { totalViews: number; series: Array<{ day: string; views: number }>; topPages: Array<{ name: string; views: number }>; referrers: Array<{ name: string; views: number }> }
interface Finding { severity: string; title: string; file: string; line: number; snippet: string; fix: string }
interface VersionRow { id: string; label: string; fileCount: number; bytes: number; createdAt: string }

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-500 border-red-500/40 bg-red-500/10',
  high: 'text-orange-500 border-orange-500/40 bg-orange-500/10',
  medium: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  low: 'text-sky-400 border-sky-400/40 bg-sky-400/10',
}

export function GrowthStudioDialog({ projectId, projectName }: Props) {
  const setGrowthStudioOpen = useAppStore(s => s.setGrowthStudioOpen)
  const [tab, setTab] = useState<Tab>('monetize')
  const [busy, setBusy] = useState<string>('')
  const [result, setResult] = useState<Record<string, string>>({})

  // monetize form state
  const [product, setProduct] = useState('Pro Plan')
  const [amount, setAmount] = useState('9.99')
  const [payKey, setPayKey] = useState('')
  const [table, setTable] = useState('orders')
  const [fields, setFields] = useState('name, email, plan')

  // analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)

  // assets state
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState('logo')

  // security state
  const [scan, setScan] = useState<{ score: number; scanned: number; findings: Finding[] } | null>(null)

  // versions state
  const [versions, setVersions] = useState<VersionRow[]>([])

  const setOut = (k: string, v: string) => setResult(r => ({ ...r, [k]: v }))

  const runTool = async (tool: string, args: any, key: string) => {
    setBusy(key)
    try {
      const res = await fetch('/api/growth-tools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, tool, args }),
      })
      const d = await res.json()
      setOut(key, d.output || d.error || 'done')
      if (d.ok) { toast.success(d.output?.split('\n')[0]?.slice(0, 80) || 'Done') } else { toast.error(d.error || 'Failed') }
      return d
    } catch { setOut(key, 'Network error'); toast.error('Network error') } finally { setBusy('') }
  }

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`/api/analytics?projectId=${projectId}&days=14`)
      const d = await res.json()
      if (d.ok) setAnalytics(d)
    } catch { /* ignore */ }
  }, [projectId])

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/versions?projectId=${projectId}`)
      const d = await res.json()
      if (d.ok) setVersions(d.versions || [])
    } catch { /* ignore */ }
  }, [projectId])

  useEffect(() => {
    loadAnalytics()
    loadVersions()
  }, [loadAnalytics, loadVersions])

  async function securityScanNow() {
    setBusy('scan')
    try {
      const res = await fetch('/api/security-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }),
      })
      const d = await res.json()
      if (d.ok) { setScan(d); toast.success(`Scan complete — score ${d.score}/100`) } else toast.error(d.error || 'Scan failed')
    } catch { toast.error('Network error') } finally { setBusy('') }
  }

  async function pwaNow() {
    setBusy('pwa')
    try {
      const res = await fetch('/api/pwa-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }),
      })
      const d = await res.json()
      setOut('pwa', d.ok ? `PWA + SEO ready (${(d.files || []).length} files): ${(d.files || []).join(', ')}` : (d.error || 'failed'))
      if (d.ok) { toast.success('PWA + SEO setup complete') } else { toast.error(d.error || 'Failed') }
    } catch { setOut('pwa', 'Network error') } finally { setBusy('') }
  }

  async function asoNow() {
    setBusy('aso')
    try {
      const res = await fetch('/api/aso-listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }),
      })
      const d = await res.json()
      setOut('aso', d.output || d.error || 'done')
      if (d.ok) { toast.success('Store listing generated (STORE_LISTING.md)') } else { toast.error(d.error || 'Failed') }
    } catch { setOut('aso', 'Network error') } finally { setBusy('') }
  }

  async function generateAsset() {
    if (!prompt.trim()) return toast.error('Describe the image first')
    setBusy('asset')
    try {
      const res = await fetch('/api/assets/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt, kind }),
      })
      const d = await res.json()
      setOut('asset', d.output || d.error || 'done')
      if (d.ok) { toast.success('Asset generated') } else { toast.error(d.error || 'Failed') }
    } catch { setOut('asset', 'Network error') } finally { setBusy('') }
  }

  async function snapshotNow() {
    const d = await runTool('version_snapshot', { label: `Studio snapshot ${new Date().toLocaleString('en-US')}` }, 'snap')
    if (d?.ok) loadVersions()
  }

  async function restore(id: string) {
    setBusy('restore')
    try {
      const res = await fetch('/api/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, action: 'restore', id }),
      })
      const d = await res.json()
      if (d.ok) { toast.success(`Restored ${d.restored} files`) } else { toast.error(d.error || 'Restore failed') }
    } catch { toast.error('Network error') } finally { setBusy('') }
  }

  async function delVersion(id: string) {
    setBusy('delver')
    try {
      await fetch('/api/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, action: 'delete', id }) })
      loadVersions()
    } catch { /* ignore */ } finally { setBusy('') }
  }

  const maxViews = Math.max(1, ...(analytics?.series || []).map(s => s.views))

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'monetize', label: 'Monetize', icon: CreditCard },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'assets', label: 'Assets', icon: Palette },
    { id: 'growth', label: 'Growth', icon: Globe },
    { id: 'security', label: 'Security', icon: ShieldCheck },
    { id: 'versions', label: 'Versions', icon: Clock },
  ]

  return (
    <Dialog open onOpenChange={(o) => { if (!o) setGrowthStudioOpen(false) }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Rocket className="w-4 h-4 text-accent" /> Growth Studio — {projectName}
          </DialogTitle>
          <DialogDescription>
            Monetization, analytics, assets, PWA, security and version history — everything to grow your app business.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 flex-wrap pb-2 border-b">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border ${tab === t.id ? 'bg-accent/15 border-accent/40 text-accent' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto pr-1 space-y-3 text-sm">
          {tab === 'monetize' && (
            <>
              <Section icon={CreditCard} title="Payments — Stripe-style checkout">
                <div className="grid grid-cols-2 gap-2">
                  <div><LabelSm>Product</LabelSm><Input className="h-8 text-xs mt-1" value={product} onChange={e => setProduct(e.target.value)} /></div>
                  <div><LabelSm>Price (USD)</LabelSm><Input className="h-8 text-xs mt-1" value={amount} onChange={e => setAmount(e.target.value)} /></div>
                  <div className="col-span-2"><LabelSm>Stripe publishable key (optional — demo mode without it)</LabelSm><Input className="h-8 text-xs mt-1" placeholder="pk_live_… (leave empty for demo mode)" value={payKey} onChange={e => setPayKey(e.target.value)} /></div>
                </div>
                <RunBtn busy={busy === 'pay'} onClick={() => runTool('payment_setup', { product, amount: parseFloat(amount) || 0, publishableKey: payKey || undefined }, 'pay')} label="Generate checkout pages" />
                <Out text={result['pay']} />
              </Section>

              <Section icon={Bell} title="Push notifications">
                <RunBtn busy={busy === 'push'} onClick={() => runTool('push_notification_setup', { appTitle: projectName }, 'push')} label="Add push notification scaffolding" />
                <Out text={result['push']} />
              </Section>

              <Section icon={Database} title="Instant database (data layer + admin panel)">
                <div className="grid grid-cols-3 gap-2">
                  <div><LabelSm>Table</LabelSm><Input className="h-8 text-xs mt-1" value={table} onChange={e => setTable(e.target.value)} /></div>
                  <div className="col-span-2"><LabelSm>Fields (comma separated)</LabelSm><Input className="h-8 text-xs mt-1" value={fields} onChange={e => setFields(e.target.value)} /></div>
                </div>
                <RunBtn busy={busy === 'db'} onClick={() => runTool('database_builder', { table, fields: fields.split(',').map(s => s.trim()).filter(Boolean) }, 'db')} label="Create data layer" />
                <Out text={result['db']} />
              </Section>
            </>
          )}

          {tab === 'analytics' && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">{analytics?.totalViews ?? 0} views · 14 days</Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadAnalytics}><RefreshCw className="w-3 h-3 mr-1" /> Refresh</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === 'ana'} onClick={() => runTool('analytics_setup', {}, 'ana').then(() => undefined)}>Enable tracking</Button>
                </div>
              </div>
              <div className="card p-3 rounded-lg border bg-card">
                <div className="text-xs font-semibold mb-2">Views per day</div>
                <div className="flex items-end gap-1 h-24">
                  {(analytics?.series || []).map(s => (
                    <div key={s.day} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="w-full rounded-t bg-accent/70 group-hover:bg-accent transition-all" style={{ height: `${(s.views / maxViews) * 84}px`, minHeight: s.views ? '3px' : '1px' }} />
                      <span className="text-[8px] text-muted-foreground rotate-45 origin-top-left hidden sm:block">{s.day.slice(5)}</span>
                      <span className="absolute -top-4 text-[9px] opacity-0 group-hover:opacity-100 bg-popover border rounded px-1">{s.views}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ListCard title="Top pages" rows={analytics?.topPages || []} />
                <ListCard title="Referrers" rows={analytics?.referrers || []} />
              </div>
            </>
          )}

          {tab === 'assets' && (
            <Section icon={Palette} title="AI Asset Studio — generate real images">
              <div><LabelSm>Describe the image</LabelSm>
                <Input className="h-8 text-xs mt-1" placeholder="e.g. minimal fox logo, flat design, orange on dark" value={prompt} onChange={e => setPrompt(e.target.value)} /></div>
              <div className="flex gap-2">
                {['logo', 'icon', 'hero', 'banner'].map(k => (
                  <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${kind === k ? 'bg-accent/15 border-accent/40 text-accent' : 'text-muted-foreground'}`}>{k}</button>
                ))}
              </div>
              <RunBtn busy={busy === 'asset'} onClick={generateAsset} label={`Generate ${kind}`} />
              <Out text={result['asset']} />
              <p className="text-[10px] text-muted-foreground">Icon/logo kinds also write 192px & 512px PWA icons into assets/icons/.</p>
            </Section>
          )}

          {tab === 'growth' && (
            <>
              <Section icon={Globe} title="PWA + SEO — installable & searchable">
                <RunBtn busy={busy === 'pwa'} onClick={pwaNow} label="Set up PWA + SEO (manifest, icons, offline, sitemap)" />
                <Out text={result['pwa']} />
              </Section>
              <Section icon={Sparkles} title="App Store listing (ASO) — AI copywriting">
                <RunBtn busy={busy === 'aso'} onClick={asoNow} label="Generate store listing (STORE_LISTING.md)" />
                <Out text={result['aso']} />
              </Section>
            </>
          )}

          {tab === 'security' && (
            <>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={securityScanNow} disabled={busy === 'scan'}>
                  {busy === 'scan' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
                  Scan project
                </Button>
                {scan && (
                  <Badge variant="outline" className={scan.score >= 90 ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10' : scan.score >= 70 ? 'border-amber-500/40 text-amber-500 bg-amber-500/10' : 'border-red-500/40 text-red-500 bg-red-500/10'}>
                    Score: {scan.score}/100 · {scan.scanned} files · {scan.findings.length} findings
                  </Badge>
                )}
              </div>
              {(scan?.findings || []).map((f, i) => (
                <div key={i} className={`rounded-lg border p-2.5 text-xs ${SEV_COLOR[f.severity] || SEV_COLOR.low}`}>
                  <div className="font-semibold flex items-center gap-1.5">
                    {f.severity === 'critical' ? <AlertTriangle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {f.title}
                  </div>
                  <div className="opacity-80 mt-0.5 font-mono">{f.file}:{f.line}</div>
                  <div className="opacity-60 mt-0.5 truncate font-mono">{f.snippet}</div>
                  <div className="opacity-90 mt-1">Fix: {f.fix}</div>
                </div>
              ))}
              {scan && !scan.findings.length && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-500 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Clean — no security issues found.
                </div>
              )}
              {!scan && <p className="text-xs text-muted-foreground">Run a scan to check for hardcoded secrets, XSS sinks, insecure resources, committed .env files and more.</p>}
            </>
          )}

          {tab === 'versions' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Snapshots are restore points — roll back any time.</p>
                <Button size="sm" onClick={snapshotNow} disabled={busy === 'snap'}>
                  {busy === 'snap' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Clock className="w-3.5 h-3.5 mr-1" />}
                  Snapshot now
                </Button>
              </div>
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs">
                  <div>
                    <div className="font-semibold">{v.label}</div>
                    <div className="text-muted-foreground">{new Date(v.createdAt).toLocaleString('en-US')} · {v.fileCount} files · {(v.bytes / 1024).toFixed(1)} KB</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === 'restore'} onClick={() => restore(v.id)}>
                      <RotateCcw className="w-3 h-3 mr-1" /> Restore
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" disabled={busy === 'delver'} onClick={() => delVersion(v.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {!versions.length && <div className="empty text-xs text-muted-foreground text-center py-6">No snapshots yet — create the first one.</div>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="text-xs font-semibold flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-accent" /> {title}</div>
      {children}
    </div>
  )
}

function LabelSm({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] text-muted-foreground">{children}</span>
}

function RunBtn({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <Button size="sm" className="h-8 text-xs w-full sm:w-auto" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Rocket className="w-3.5 h-3.5 mr-1.5" />}
      {label}
    </Button>
  )
}

function Out({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div className="relative rounded-md bg-muted/50 border text-[11px] leading-relaxed p-2 pr-6 whitespace-pre-wrap max-h-28 overflow-y-auto">
      {text}
      {/* v63: this button showed an X (close) icon but actually COPIES the
          output — the icon now says what it does. */}
      <button className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground" title="Copy output" onClick={() => { navigator.clipboard?.writeText(text); toast.success('Copied to clipboard') }}><Copy className="w-3 h-3" /></button>
    </div>
  )
}

function ListCard({ title, rows }: { title: string; rows: Array<{ name: string; views: number }> }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs font-semibold mb-2">{title}</div>
      {rows.length ? rows.map(r => (
        <div key={r.name} className="flex justify-between text-[11px] py-0.5">
          <span className="truncate text-muted-foreground">{r.name}</span><span className="font-semibold">{r.views}</span>
        </div>
      )) : <div className="text-[11px] text-muted-foreground">No data yet</div>}
    </div>
  )
}
