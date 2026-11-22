'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Loader2, Download, CheckCircle2, XCircle, Rocket, History, RefreshCw, Play, Link2, Unlink, CloudUpload, Globe, Trash2, ExternalLink, Database,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { PUBLISH_TARGETS } from '@/lib/publish-targets'

interface PublishDialogProps {
  projectId: string
}

/** v80: a down/restarting server makes the gateway return an HTML error page;
 *  res.json() then explodes with the cryptic "Unexpected token '<'". Parse
 *  defensively and say what actually happened instead. */
async function safeJson(res: Response): Promise<any | null> {
  try { return await res.json() } catch { return null }
}
function friendly(e: unknown): string {
  const m = (e as any)?.message || String(e)
  if (m.includes("Unexpected token")) return 'Server unreachable (bad gateway) — it is likely recovering from a heavy build. Wait ~1 minute and retry.'
  return m
}

interface BuildRow {
  id: string
  target: string
  status: string
  artifactPath?: string | null
  createdAt: string
}

interface DeployTarget {
  id: string
  label: string
  hint: string
}

interface DomainRow {
  id: string
  domain: string
  projectId: string
  projectName: string
  verified: boolean
  status: string
  verifyToken: string
  dns: Array<{ type: string; name: string; value: string; purpose: string }>
}

export function PublishDialog({ projectId }: PublishDialogProps) {
  const { publishDialogOpen, setPublishDialogOpen } = useAppStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; downloadUrl?: string; logs?: string; workflow?: string; error?: string; liveUrl?: string; selfHost?: { siteId?: string; url?: string; version?: number; files?: number; sizeBytes?: number }; vortex?: { siteId?: string; url?: string; version?: number; files?: number; sizeBytes?: number }; appverse?: { appId?: string; version?: string; status?: string; sha256?: string; sizeBytes?: number }; vault?: { uploaded: boolean; object?: string; sizeKb?: number; removedLocal?: boolean; note?: string } } | null>(null)
  // v63: two previously-dead endpoints now have faces —
  //   GET /api/builds?projectId  → every past artifact, downloadable
  //   GET/POST /api/deploy       → one-click LIVE publish INSIDE the platform (self-host; no third-party hosting)
  const [builds, setBuilds] = useState<BuildRow[] | null>(null)
  const [deployTargets, setDeployTargets] = useState<DeployTarget[]>([])
  const [deployBusy, setDeployBusy] = useState<string | null>(null)
  // v141 — VORTEX VaaS backend state for this project
  const [vaasStatus, setVaasStatus] = useState<{ provisioned: boolean; vaasProjectId?: string; clientKey?: string; collections?: string[]; snippet?: string } | null>(null)
  const [vaasBusy, setVaasBusy] = useState(false)
  // v81 — Google Play direct upload (service account)
  const [playStatus, setPlayStatus] = useState<{ configured: boolean; clientEmail: string | null } | null>(null)
  // v123 — custom domains (nijer domain e app chalano)
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [domainBusy, setDomainBusy] = useState<string | null>(null)
  const [playJson, setPlayJson] = useState('')
  const [playConnectBusy, setPlayConnectBusy] = useState(false)
  const [playPackage, setPlayPackage] = useState('')
  const [playTrack, setPlayTrack] = useState('internal')
  const [playBusy, setPlayBusy] = useState(false)
  const [playResult, setPlayResult] = useState<{ ok: boolean; message?: string; error?: string; hint?: string } | null>(null)
  const [showPlaySetup, setShowPlaySetup] = useState(false)

  const loadBuilds = useCallback(async () => {
    try {
      const res = await fetch(`/api/builds?projectId=${projectId}`, { cache: 'no-store' })
      const data = await safeJson(res)
      setBuilds(data && Array.isArray(data.builds) ? data.builds : [])
    } catch { setBuilds([]) }
  }, [projectId])

  useEffect(() => {
    if (!publishDialogOpen) return
    void loadBuilds()
    fetch('/api/deploy')
      .then(r => r.json())
      .then(d => setDeployTargets(Array.isArray(d.targets) ? d.targets : []))
      .catch(() => {})
    // v81: Google Play connection status
    fetch('/api/play', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setPlayStatus({ configured: !!d.configured, clientEmail: d.clientEmail || null }))
      .catch(() => setPlayStatus({ configured: false, clientEmail: null }))
    // v123: my custom domains
    fetch('/api/custom-domains')
      .then(r => r.json())
      .then(d => setDomains(d?.domains || []))
      .catch(() => setDomains([]))
    // v141: VORTEX VaaS backend status
    fetch(`/api/projects/${projectId}/vaas`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setVaasStatus(d?.provisioned ? d : { provisioned: false }))
      .catch(() => setVaasStatus({ provisioned: false }))
  }, [publishDialogOpen, loadBuilds, projectId])

  // v141 — provision the Firebase-style backend on the VORTEX SERVER
  async function provisionBackend() {
    setVaasBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/vaas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['users', 'posts', 'settings'] }),
      })
      const data = await safeJson(res)
      if (!data) { toast.error('Server unreachable — retry in ~1 minute.'); return }
      if (data.ok) {
        setVaasStatus(data)
        toast.success('VORTEX Backend provisioned — keys + snippet ready')
      } else {
        toast.error(data.error || 'Backend provisioning failed')
      }
    } catch (e: any) {
      toast.error(friendly(e))
    } finally {
      setVaasBusy(false)
    }
  }

  // v123 — custom domain actions
  async function addDomain() {
    const domain = domainInput.trim().toLowerCase()
    if (!domain || domainBusy) return
    setDomainBusy('add')
    try {
      const res = await fetch('/api/custom-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, projectId }),
      })
      const d = await safeJson(res)
      if (d?.ok) {
        toast.success(`${domain} claimed — DNS record boshiye Verify chapan`)
        setDomainInput('')
        const r2 = await fetch('/api/custom-domains')
        const d2 = await safeJson(r2)
        setDomains(d2?.domains || [])
      } else toast.error(d?.error || 'domain claim failed')
    } catch { toast.error('domain claim failed') }
    setDomainBusy(null)
  }

  async function verifyDomain(id: string) {
    if (domainBusy) return
    setDomainBusy(id)
    try {
      const res = await fetch('/api/custom-domains/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const d = await safeJson(res)
      if (d?.verified) toast.success('Domain verified — 1 min er moddhe live!')
      else toast.error(d?.detail || d?.error || 'verification failed — DNS propagate hole abar try korun')
      const r2 = await fetch('/api/custom-domains')
      const d2 = await safeJson(r2)
      setDomains(d2?.domains || [])
    } catch { toast.error('verification failed') }
    setDomainBusy(null)
  }

  async function removeDomain(id: string) {
    try {
      await fetch(`/api/custom-domains?id=${id}`, { method: 'DELETE' })
      setDomains((prev) => (prev || []).filter((x) => x.id !== id))
      toast.success('Domain removed')
    } catch { toast.error('remove failed') }
  }

  /* ---------- v81 Google Play connect + direct upload ---------- */
  const playConnect = async () => {
    if (!playJson.trim()) { toast.error('Paste the service-account JSON key first'); return }
    setPlayConnectBusy(true)
    try {
      const res = await fetch('/api/play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', json: playJson }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Could not save the service account'); return }
      toast.success(`Play Console connected — ${data.clientEmail}`)
      setPlayJson(''); setShowPlaySetup(false)
      setPlayStatus({ configured: true, clientEmail: data.clientEmail })
    } catch { toast.error('Request failed') } finally { setPlayConnectBusy(false) }
  }

  const playDisconnect = async () => {
    setPlayConnectBusy(true)
    try {
      await fetch('/api/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) })
      setPlayStatus({ configured: false, clientEmail: null })
      toast.success('Play Console disconnected')
    } catch { toast.error('Request failed') } finally { setPlayConnectBusy(false) }
  }

  const playUpload = async () => {
    if (!playPackage.trim()) { toast.error('Package name required (com.example.app)'); return }
    setPlayBusy(true)
    setPlayResult(null)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, target: 'google-play', packageName: playPackage.trim(), track: playTrack }),
      })
      const data = await safeJson(res)
      if (!data) { toast.error('Server unreachable — retry in ~1 minute.'); return }
      setPlayResult({ ok: !!data.ok, message: data.message, error: data.error, hint: data.hint })
      if (data.ok) toast.success(data.message || 'AAB uploaded to Google Play')
      else toast.error(data.error || 'Play upload failed')
      void loadBuilds()
    } catch (e: any) {
      toast.error(friendly(e))
    } finally { setPlayBusy(false) }
  }

  async function publish(target: string) {
    setBusy(target)
    setResult(null)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, target }),
      })
      const data = await safeJson(res)
      if (!data) { toast.error('Server unreachable (bad gateway) — it is likely recovering from a heavy build. Wait ~1 minute and retry.'); return }
      setResult(data)
      if (data.ok) toast.success(data.vault?.uploaded ? `Published: ${target} (saved to Firebase Storage too)` : `Published: ${target}`)
      else toast.error(data.error || 'Publish failed')
      void loadBuilds()
    } catch (e: any) {
      toast.error(friendly(e))
    } finally {
      setBusy(null)
    }
  }

  /** v157: POST /api/deploy — publishes LIVE INSIDE the platform (self-host).
   *  No tokens, no third-party hosts; legacy target ids are auto-redirected
   *  by the API to the same in-platform publish. */
  async function deploy(target: string) {
    setDeployBusy(target)
    setResult(null)
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, target }),
      })
      const data = await safeJson(res)
      if (!data) { toast.error('Server unreachable (bad gateway) — retry in ~1 minute.'); return }
      setResult({
        ok: !!data.ok,
        logs: typeof data.logs === 'string' ? data.logs : undefined,
        error: data.error || undefined,
        liveUrl: data.liveUrl || undefined,
        selfHost: data.siteId ? { siteId: data.siteId, url: `/sites/${data.siteId}/`, version: data.version, files: data.files } : undefined,
      })
      if (data.ok) toast.success(data.liveUrl ? `LIVE inside Vortex: ${data.liveUrl}` : `Published LIVE inside Vortex`)
      else toast.error(data.error || `Publish failed`)
      void loadBuilds()
    } catch (e: any) {
      toast.error(friendly(e))
    } finally {
      setDeployBusy(null)
    }
  }

  return (
    <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
      <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish Project</DialogTitle>
            <DialogDescription>
            Everything publishes LIVE INSIDE Vortex — this platform is the hosting, the builder, the server. No third-party platform is used.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            {result.ok ? (
              <Card className="p-4 bg-emerald-500/5 border-emerald-500/30">
                <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span className="font-medium">Build complete</span>
                </div>
                {result.downloadUrl && (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <a href={result.downloadUrl} download>
                        <Download className="w-4 h-4 mr-1.5" />Download artifact
                      </a>
                    </Button>
                    {result.vault?.uploaded && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 border border-emerald-500/40 rounded px-2 py-1">
                        <CloudUpload className="w-3 h-3" /> copy in Firebase Storage{result.vault.sizeKb ? ` (${(result.vault.sizeKb / 1024).toFixed(1)} MB)` : ''}
                      </span>
                    )}
                  </div>
                )}
                {/* v141 — VORTEX ecosystem results */}
                {result.liveUrl && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Button asChild>
                      <a href={result.liveUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-4 h-4 mr-1.5" />Open live site
                      </a>
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {result.selfHost
                        ? `🏠 Live INSIDE Vortex · /sites/${result.selfHost.siteId}/ · v${result.selfHost.version} · ${result.selfHost.files} files`
                        : `🌀 VORTEX Website · v${result.vortex?.version} · ${result.vortex?.files} files · ${result.liveUrl}`}
                    </span>
                  </div>
                )}
                {result.appverse?.status && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    🛰️ APPVERSE · v{result.appverse.version} · sha256 {String(result.appverse.sha256 || '').slice(0, 12)}… —
                    {result.appverse.status === 'PENDING'
                      ? ' pending review. Approve it from the VORTEX SERVER dashboard (APPVERSE → review) to make it downloadable.'
                      : ` status: ${result.appverse.status}`}
                  </div>
                )}
                {result.vault?.note && (
                  <p className="text-[11px] text-muted-foreground mt-2">{result.vault.note}</p>
                )}
                {!result.downloadUrl && result.logs && (
                  <pre className="text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{result.logs}</pre>
                )}
              </Card>
            ) : (
              <Card className="p-4 bg-red-500/5 border-red-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-5 h-5 text-red-500" />
                      <span className="font-medium">Build failed</span>
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">{result.error || result.logs}</pre>
              </Card>
            )}
            {result.workflow && (
              <Card className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap">{result.workflow}</pre>
              </Card>
            )}
            {result.logs && result.ok && (
              <Card className="p-3 bg-muted/30">
                <div className="text-xs font-medium mb-1 text-muted-foreground">Build logs</div>
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{result.logs}</pre>
              </Card>
            )}
            <Button variant="outline" onClick={() => setResult(null)}>← Back to targets</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* v157: the one-click LIVE publish — inside the platform, no tokens, no third party */}
            {deployTargets.length > 0 && (
              <Card className="p-3 space-y-2 border-primary/40 bg-primary/5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Rocket className="w-4 h-4 text-primary" /> Live INSIDE Vortex — one click, no tokens, no third-party hosting
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {deployTargets.map(t => (
                    <Button
                      key={t.id}
                      size="sm"
                      className="h-auto py-1.5 flex-col items-start gap-0.5"
                      disabled={deployBusy === t.id}
                      onClick={() => deploy(t.id)}
                      title={t.hint}
                    >
                      {deployBusy === t.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <span className="text-[11px] font-medium">{t.label}</span>}
                      <span className="text-[9px] text-muted-foreground normal-case">{deployBusy === t.id ? 'publishing…' : t.id}</span>
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {PUBLISH_TARGETS.map(t => (
                <Card key={t.id} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/30 grid place-items-center shrink-0">
                      <span className="text-lg">{t.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">{t.label}</span>
                        {t.free && <Badge className="text-[9px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Free</Badge>}
                        {t.mode === 'workflow' && <Badge className="text-[9px] px-1 py-0 bg-accent/20 text-accent border-accent/30">Guide</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{t.platform}</p>
                      <p className="text-[10px] text-muted-foreground">{t.format}</p>
                      <Button
                        size="sm"
                        className="mt-2 w-full h-7 text-[10px]"
                        disabled={busy === t.id}
                        onClick={() => publish(t.id)}
                      >
                        {busy === t.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        {busy === t.id ? '...' : t.mode === 'workflow' ? 'Steps' : 'Publish'}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* v141 — VORTEX VaaS backend provisioning (Firebase-alternative):
                auth + OTP, collections (data), file storage, realtime, functions. */}
            <Card className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Database className="w-4 h-4 text-primary" /> VORTEX Backend (storage · database · OTP auth)
                </div>
                {vaasStatus?.provisioned
                  ? <Badge className="text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>
                  : <Badge variant="outline" className="text-[9px]">Not provisioned</Badge>}
              </div>
              {vaasStatus?.provisioned ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    Project <code className="text-[10px]">{vaasStatus.vaasProjectId}</code> · collections: {(vaasStatus.collections || []).join(', ')}
                  </p>
                  {vaasStatus.clientKey && (
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] bg-muted px-2 py-1 rounded flex-1 truncate">{vaasStatus.clientKey}</code>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { navigator.clipboard?.writeText(vaasStatus.clientKey || ''); toast.success('CLIENT key copied') }}>Copy</Button>
                    </div>
                  )}
                  {vaasStatus.snippet && (
                    <pre className="text-[10px] font-mono bg-muted/40 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">{vaasStatus.snippet}</pre>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground flex-1">
                    One tap provisions a Firebase-style backend for this app on the VORTEX SERVER: auth + OTP verification, document database, file storage — more than Firebase, your own platform.
                  </p>
                  <Button size="sm" className="h-7 text-[10px] shrink-0" disabled={vaasBusy} onClick={provisionBackend}>
                    {vaasBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    Provision
                  </Button>
                </div>
              )}
            </Card>

            {/* v81 — Google Play: connect + direct AAB upload */}
            <Card className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Play className="w-4 h-4 text-primary" /> Google Play — direct upload
                </div>
                {playStatus === null ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : playStatus.configured ? (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">connected</Badge>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={playDisconnect} disabled={playConnectBusy}>
                      <Unlink className="w-3 h-3 mr-0.5" /> Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => setShowPlaySetup(s => !s)}>
                    <Link2 className="w-3 h-3 mr-1" /> Connect service account
                  </Button>
                )}
              </div>
              {playStatus?.configured && <p className="text-[10px] text-muted-foreground">{playStatus.clientEmail}</p>}
              {showPlaySetup && !playStatus?.configured && (
                <div className="space-y-1.5">
                  <textarea
                    className="w-full rounded-md border border-border bg-card/40 p-2 text-[11px] font-mono min-h-[70px]"
                    placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }'
                    value={playJson}
                    onChange={e => setPlayJson(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-[10px]" onClick={playConnect} disabled={playConnectBusy}>
                      {playConnectBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null} Save &amp; connect
                    </Button>
                    <span className="text-[10px] text-muted-foreground">Google Cloud → enable “Google Play Android Developer API” → create service account + JSON key → invite its email in Play Console → Users &amp; permissions.</span>
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Input placeholder="com.example.app (applicationId)" value={playPackage} onChange={e => setPlayPackage(e.target.value)} className="h-8 text-xs flex-1" />
                <Select value={playTrack} onValueChange={setPlayTrack}>
                  <SelectTrigger className="h-8 text-xs w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal" className="text-xs">internal testing</SelectItem>
                    <SelectItem value="closed" className="text-xs">closed testing</SelectItem>
                    <SelectItem value="production" className="text-xs">production</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-8 shrink-0" onClick={playUpload} disabled={playBusy || !playStatus?.configured}>
                  {playBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                  Upload AAB
                </Button>
              </div>
              {!playStatus?.configured && (
                <p className="text-[10px] text-muted-foreground">Connect your own service account to upload straight to a track — the Android AAB target builds the bundle first if none exists yet.</p>
              )}
              {playResult && (
                <div className={`rounded-md border px-2.5 py-2 text-[11px] ${playResult.ok ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600' : 'border-red-500/40 bg-red-500/5 text-red-500'}`}>
                  <div className="font-medium">{playResult.ok ? (playResult.message || 'Uploaded') : (playResult.error || 'Upload failed')}</div>
                  {playResult.hint && <div className="mt-1 text-muted-foreground">hint: {playResult.hint}</div>}
                </div>
              )}
            </Card>

            {/* v123 — CUSTOM DOMAIN: run this app on your own domain */}
            <Card className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Globe className="w-4 h-4 text-primary" /> Custom domain — nijer domain e app chalan
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="shop.mybrand.in"
                  value={domainInput}
                  onChange={e => setDomainInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addDomain() }}
                  className="h-8 text-xs flex-1"
                />
                <Button size="sm" className="h-8 shrink-0" onClick={addDomain} disabled={domainBusy === 'add' || !domainInput.trim()}>
                  {domainBusy === 'add' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
                  Claim domain
                </Button>
              </div>
              {domains === null ? (
                <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
              ) : domains.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">Domain claim korle 2 ta DNS record dite hobe: ekta TXT (ownership proof) + ekta A record (server er IP). Verify hole ei app apnar domain e live jabe.</p>
              ) : (
                <div className="space-y-1.5">
                  {domains.filter(d => d.projectId === projectId).concat(domains.filter(d => d.projectId !== projectId)).map(d => (
                    <div key={d.id} className="rounded-md border px-2.5 py-2 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{d.domain}</span>
                        {d.verified
                          ? <Badge className="text-[9px] bg-emerald-500/15 text-emerald-700 border-0"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> live</Badge>
                          : <Badge className="text-[9px] bg-amber-500/15 text-amber-700 border-0">pending</Badge>}
                        <span className="text-[10px] text-muted-foreground">→ {d.projectName}</span>
                        <span className="ml-auto flex items-center gap-1">
                          {!d.verified && (
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => verifyDomain(d.id)} disabled={domainBusy === d.id}>
                              {domainBusy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-0.5" />} Verify
                            </Button>
                          )}
                          <button onClick={() => removeDomain(d.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      </div>
                      {!d.verified && (
                        <div className="text-[10px] text-muted-foreground font-mono space-y-0.5">
                          {d.dns.map((rec, i) => (
                            <div key={i}>{rec.type} · {rec.name} → <span className="text-foreground">{rec.value === 'THIS_SERVER_IP' ? '<server IP>' : rec.value}</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* v63: build history — every artifact this project ever produced,
                downloadable again. The Build table existed with zero readers. */}
            <Card className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <History className="w-4 h-4 text-primary" /> Build history
                </div>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void loadBuilds()} title="Refresh">
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
              {builds === null ? (
                <div className="flex items-center justify-center py-3"><Loader2 className="w-4 h-4 animate-spin" /></div>
              ) : builds.length === 0 ? (
                <p className="text-xs text-muted-foreground">No builds yet — publish above and every artifact will be listed here with a re-download link.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {builds.map(b => (
                    <div key={b.id} className="flex items-center gap-2 text-[11px] border border-border rounded px-2 py-1.5">
                      <Badge variant="outline" className="text-[9px] shrink-0">{b.target}</Badge>
                      <span className={b.status === 'success' ? 'text-emerald-500' : 'text-amber-500'}>{b.status}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">{new Date(b.createdAt).toLocaleString()}</span>
                      {b.status === 'success' && (
                        <a href={`/api/publish?id=${b.id}`} download className="shrink-0 text-primary hover:underline inline-flex items-center gap-1">
                          <Download className="w-3 h-3" />artifact
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
