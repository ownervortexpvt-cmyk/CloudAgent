'use client'

/**
 * v79 — SDK Manager dialog.
 *
 * Shows everything the operator asked for in one place:
 *   1. STORAGE   — real sandbox disk usage with an honest note: the volume
 *                  size is platform-fixed (9.9 GB here); a 25→70 GB cloud
 *                  storage upgrade is a platform-side setting, not reachable
 *                  from inside the sandbox.
 *   2. TOOLCHAINS— the 13 managed SDKs (auto-installed + auto-healed on every
 *                  server boot by sdk-doctor) with live present/missing state.
 *   3. CUSTOM    — install ANY SDK binary by URL (tar.gz/zip/raw binary) into
 *                  the persistent sdk/custom/<name>/ — auto-discovered on the
 *                  PATH of every project run (runtime.ts sdkPaths()).
 * Permanence model: everything lives under /home/z/my-project/sdk/; after a
 * snapshot wipe the doctor reinstalls the managed 13 automatically, and custom
 * SDKs re-install in one click from the saved history below.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { HardDrive, RefreshCw, Plus, Trash2, CheckCircle2, XCircle, Loader2, PackageOpen, Info, Cloud, CloudUpload, ChevronDown, ChevronUp, FolderPlus, Zap, Upload, DatabaseBackup, RotateCcw, KeyRound, Code2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface Toolchain { name: string; label: string; version: string; setup: string; present: boolean }
interface CustomSdk { name: string; status: string; log: string; installedAt?: string; sizeMb?: number }
interface Storage { totalGb: number; usedGb: number; freeGb: number; usedPct: number; limit: string }
interface Doctor { running: boolean; lastLines: string }
interface SdkState { toolchains: Toolchain[]; custom: CustomSdk[]; storage: Storage; doctor: Doctor }

/* v81 — Add-Storage automatic provisioning */
interface ProvisionItem { name: string; needed: boolean; present: boolean; action: string; detail?: string }
interface ProvisionJob { projectId: string; projectName: string; language: string; source: string; startedAt: string; updatedAt: string; items: ProvisionItem[] }

/* v89 — Cloud Vault: Firebase Storage restore points */
interface FbBackup { name: string; sizeKb: number; updated: string; exportedAt: string | null }
interface FbState {
  bucket: string
  projectId: string
  enabled: boolean
  auto: boolean
  connected: boolean
  serviceAccountEmail: string | null
  lastBackupAt: string | null
  lastBackupNote: string | null
  backups: FbBackup[]
  vaultUsedKb: number
  error: string | null
  localDiskFreeMb: number
}

/* v95 — Cloud Vault on Cloudflare R2 (owner's budget choice) */
interface R2State {
  accountId: string
  bucket: string
  enabled: boolean
  auto: boolean
  connected: boolean
  lastBackupAt: string | null
  lastBackupNote: string | null
  backups: FbBackup[]
  vaultUsedKb: number
  error: string | null
  localDiskFreeMb: number
}

const FORMATS = ['tar.gz', 'tgz', 'tar.bz2', 'tar.xz', 'zip', 'binary']

/** One-click re-install sources for custom SDKs after a snapshot wipe. */
const CUSTOM_HISTORY_KEY = 'ca:custom-sdk-history'
function loadCustomHistory(): { name: string; url: string; format: string }[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CUSTOM_HISTORY_KEY) || '[]')
    return Array.isArray(arr) ? arr.slice(0, 20) : []
  } catch { return [] }
}
function saveCustomHistory(list: { name: string; url: string; format: string }[]) {
  try { localStorage.setItem(CUSTOM_HISTORY_KEY, JSON.stringify(list.slice(0, 20))) } catch {}
}

export function SdkManagerDialog() {
  const { sdkManagerOpen, setSdkManagerOpen } = useAppStore()
  const [state, setState] = useState<SdkState | null>(null)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('tar.gz')
  const [history, setHistory] = useState<{ name: string; url: string; format: string }[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // v81: Add-Storage provisioning state
  const [provisionJobs, setProvisionJobs] = useState<ProvisionJob[] | null>(null)
  const [healBusy, setHealBusy] = useState(false)
  // v86: Added-storage archives (the platform upload mount) — one-tap install
  const [uploads, setUploads] = useState<Array<{ name: string; path: string; size: number; format: string; installable: boolean }>>([])
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  // v89: Cloud Vault (Firebase Storage) state
  const [fb, setFb] = useState<FbState | null>(null)
  const [fbBusy, setFbBusy] = useState(false)
  const [fbConfigText, setFbConfigText] = useState('')
  const [fbSaText, setFbSaText] = useState('')
  const [fbShowSteps, setFbShowSteps] = useState(false)
  const fbSaFileRef = useRef<HTMLInputElement | null>(null)
  // v95: Cloud Vault (Cloudflare R2) state — the owner's primary vault
  const [r2, setR2] = useState<R2State | null>(null)
  const [r2Busy, setR2Busy] = useState(false)
  const [r2ConfigText, setR2ConfigText] = useState('')
  const [r2KeysText, setR2KeysText] = useState('')
  const [r2ShowSteps, setR2ShowSteps] = useState(false)
  // v89: source export
  const [exportBusy, setExportBusy] = useState(false)

  const refreshProvision = useCallback(async () => {
    try {
      const res = await fetch('/api/sdks/provision', { cache: 'no-store' })
      const data = await res.json()
      setProvisionJobs(Array.isArray(data.jobs) ? data.jobs : [])
      return Array.isArray(data.jobs) && data.jobs.some((j: ProvisionJob) => j.items?.some((i: ProvisionItem) => i.action === 'installing'))
    } catch { return false }
  }, [])

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/sdks', { cache: 'no-store' })
      const data = await res.json()
      setState(data)
      // auto-poll while anything is in flight
      const busy = (data.custom || []).some((c: CustomSdk) => c.status === 'installing') || data.doctor?.running
      if (busy && !pollRef.current) {
        pollRef.current = setInterval(() => refresh(true), 5000)
      } else if (!busy && pollRef.current) {
        clearInterval(pollRef.current); pollRef.current = null
      }
    } catch {
      if (!silent) toast.error('Could not load SDK status')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  /* ---------- v89 Cloud Vault (Firebase Storage) ---------- */
  const refreshFb = useCallback(async () => {
    try {
      const res = await fetch('/api/firebase', { cache: 'no-store' })
      const data = await res.json()
      setFb(data)
    } catch { /* card shows unknown state */ }
  }, [])

  /* ---------- v95 Cloud Vault (Cloudflare R2) ---------- */
  const refreshR2 = useCallback(async () => {
    try {
      const res = await fetch('/api/r2vault', { cache: 'no-store' })
      const data = await res.json()
      setR2(data)
    } catch { /* card shows unknown state */ }
  }, [])

  /* ---------- v88 device upload ---------- */
  const uploadFromDevice = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sdks/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || `Upload failed (HTTP ${res.status})`); return }
      toast.success(data.message || 'Stored in added storage')
      const list = await fetch('/api/sdks?list=uploads', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
      if (list?.ok) setUploads(list.uploads || [])
    } catch { toast.error('Upload failed — check your connection') } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  useEffect(() => {
    if (sdkManagerOpen) {
      setHistory(loadCustomHistory())
      refresh()
      refreshProvision()
      refreshFb()
      refreshR2()
    } else if (pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [sdkManagerOpen, refresh, refreshProvision, refreshFb, refreshR2])

  // v81: poll provisioning while anything is installing (4s)
  useEffect(() => {
    if (!sdkManagerOpen) return
    const t = setInterval(async () => {
      const busy = await refreshProvision()
      if (busy) refresh(true)
    }, 4000)
    return () => clearInterval(t)
  }, [sdkManagerOpen, refreshProvision, refresh])

  const install = async () => {
    if (!name.trim() || !url.trim()) { toast.error('Name and URL are both required'); return }
    setInstalling(true)
    try {
      const res = await fetch('/api/sdks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), format }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Install failed to start'); return }
      toast.success(`Installing '${name.trim()}' in the background — progress shown below`)
      const next = [{ name: name.trim(), url: url.trim(), format }, ...history.filter(h => h.name !== name.trim())]
      setHistory(next); saveCustomHistory(next)
      setName(''); setUrl('')
      setTimeout(() => refresh(true), 800)
    } catch { toast.error('Install request failed') } finally { setInstalling(false) }
  }

  // v86: one-tap install of an archive already stored in the platform's
  // added storage (upload mount) — no download needed, direct local copy.
  const loadUploads = useCallback(async () => {
    try {
      const res = await fetch('/api/sdks?list=uploads')
      const data = await res.json()
      if (res.ok) setUploads(data.uploads || [])
    } catch {}
  }, [])
  useEffect(() => { if (sdkManagerOpen) loadUploads() }, [sdkManagerOpen, loadUploads])

  const installFromUpload = async (u: { name: string; path: string; format: string }) => {
    const sdkName = (u.name.replace(/\.(tar\.gz|tgz|tar\.bz2|tar\.xz|zip)$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '').slice(0, 40) || 'sdk')
    if (!/^[a-zA-Z0-9]/.test(sdkName)) return toast.error('Could not derive a valid name from ' + u.name)
    setInstalling(true)
    try {
      const res = await fetch('/api/sdks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sdkName, path: u.path, format: u.format }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Install failed to start'); return }
      toast.success(`Installing '${sdkName}' from added storage — progress below`)
      setTimeout(() => { refresh(true); loadUploads() }, 800)
    } catch { toast.error('Install request failed') } finally { setInstalling(false) }
  }

  const removeCustom = async (n: string) => {
    try {
      const res = await fetch(`/api/sdks?name=${encodeURIComponent(n)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Delete failed'); return }
      toast.success(`'${n}' removed`)
      refresh(true)
    } catch { toast.error('Delete failed') }
  }

  const reinstallFromHistory = async (h: { name: string; url: string; format: string }) => {
    setInstalling(true)
    try {
      const res = await fetch('/api/sdks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(h),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Install failed to start'); return }
      toast.success(`Re-installing '${h.name}'`)
      setTimeout(() => refresh(true), 800)
    } catch { toast.error('Install request failed') } finally { setInstalling(false) }
  }

  const presentCount = state?.toolchains.filter(t => t.present).length ?? 0
  const total = state?.toolchains.length ?? 13
  const st = state?.storage
  const fbAction = async (payload: object, okMsg?: string) => {
    setFbBusy(true)
    try {
      const res = await fetch('/api/firebase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.ok === false || data?.error) { toast.error(data?.error || data?.warning || `HTTP ${res.status}`); return null }
      if (okMsg) toast.success(okMsg)
      refreshFb()
      return data
    } catch (e: any) { toast.error(e?.message || 'Request failed'); return null } finally { setFbBusy(false) }
  }

  const saveFbConfig = () => {
    if (!fbConfigText.trim()) { toast.error('Paste the firebaseConfig block first'); return }
    fbAction({ action: 'save-config', config: fbConfigText }, 'Firebase project saved — now add the service account key')
  }

  const readFbSaFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setFbSaText(String(reader.result || ''))
    reader.onerror = () => toast.error('Could not read the file')
    reader.readAsText(file)
  }

  const connectFbSa = async () => {
    if (!fbSaText.trim()) { toast.error('Paste the service-account JSON (or pick the downloaded file)'); return }
    const data = await fbAction({ action: 'save-service-account', json: fbSaText })
    if (data?.verified) { toast.success('Cloud Vault connected and verified — your Firebase bucket answers'); setFbSaText('') }
    else if (data?.saved) toast.warning(`Key saved, but the bucket check failed: ${data.warning}`)
  }

  const fbBackupNow = () => fbAction({ action: 'backup-now' }, 'Backup saved to your Firebase vault')

  const fbRestore = async (b: FbBackup) => {
    if (!window.confirm(`Restore this backup?\n\n${b.name}\n\nIt ADDS/updates data (projects, files, runs, settings) — nothing is deleted. Continue?`)) return
    const data = await fbAction({ action: 'restore', object: b.name })
    if (data) toast.success(`Restored — projects created: ${data.stats?.projectsCreated ?? 0}, updated: ${data.stats?.projectsUpdated ?? 0}, files: ${data.stats?.filesUpserted ?? 0}`)
  }

  const fbDelete = async (b: FbBackup) => {
    if (!window.confirm(`Delete this restore point from your Firebase?\n\n${b.name}`)) return
    await fbAction({ action: 'delete-backup', object: b.name }, 'Restore point deleted')
  }

  const fbDisconnect = () => {
    if (!window.confirm('Disconnect the Cloud Vault? Backups already in Firebase stay there.')) return
    fbAction({ action: 'disconnect' }, 'Cloud Vault disconnected')
  }

  /* ---------- v95 Cloud Vault (Cloudflare R2) actions ---------- */
  const r2Action = async (payload: object, okMsg?: string) => {
    setR2Busy(true)
    try {
      const res = await fetch('/api/r2vault', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.ok === false || data?.error) { toast.error(data?.error || data?.warning || `HTTP ${res.status}`); return null }
      if (okMsg) toast.success(okMsg)
      refreshR2()
      return data
    } catch (e: any) { toast.error(e?.message || 'Request failed'); return null } finally { setR2Busy(false) }
  }

  const saveR2ConfigUi = () => {
    if (!r2ConfigText.trim()) { toast.error('Paste the Account ID + bucket name first'); return }
    r2Action({ action: 'save-config', config: r2ConfigText }, 'R2 bucket saved — now add the API token keys')
  }

  const connectR2Keys = async () => {
    if (!r2KeysText.trim()) { toast.error('Paste the Access Key ID + Secret Access Key'); return }
    const data = await r2Action({ action: 'save-keys', keys: r2KeysText })
    if (data?.verified) { toast.success('R2 vault connected and verified — your bucket answers'); setR2KeysText('') }
    else if (data?.saved) toast.warning(`Keys saved, but the bucket check failed: ${data.warning}`)
  }

  const r2BackupNow = () => r2Action({ action: 'backup-now' }, 'Backup saved to your R2 vault')

  const r2Restore = async (b: FbBackup) => {
    if (!window.confirm(`Restore this backup?\n\n${b.name}\n\nIt ADDS/updates data (projects, files, runs, settings) — nothing is deleted. Continue?`)) return
    const data = await r2Action({ action: 'restore', object: b.name })
    if (data) toast.success(`Restored — projects created: ${data.stats?.projectsCreated ?? 0}, updated: ${data.stats?.projectsUpdated ?? 0}, files: ${data.stats?.filesUpserted ?? 0}`)
  }

  const r2Delete = async (b: FbBackup) => {
    if (!window.confirm(`Delete this restore point from your R2 bucket?\n\n${b.name}`)) return
    await r2Action({ action: 'delete-backup', object: b.name }, 'Restore point deleted')
  }

  const r2Disconnect = () => {
    if (!window.confirm('Disconnect the R2 vault? Backups already in your bucket stay there.')) return
    r2Action({ action: 'disconnect' }, 'R2 vault disconnected')
  }

  /* ---------- v89 source export (the honest editor bridge) ---------- */
  const exportSourceDownload = () => {
    try {
      const a = document.createElement('a')
      a.href = '/api/source-export'
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast.success('Preparing source archive — your download starts in a moment')
    } catch { toast.error('Download failed') }
  }

  const exportSourceToFirebase = async () => {
    setExportBusy(true)
    try {
      const res = await fetch('/api/source-export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'to-firebase' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Export failed'); return }
      const where = data.vault === 'r2' ? 'Cloudflare R2' : 'Firebase Storage'
      toast.success(`Source archive sent to ${where} (${Math.round((data.sizeKb || 0) / 1024 * 10) / 10} MB) — open your vault on any device`)
    } catch { toast.error('Export request failed') } finally { setExportBusy(false) }
  }

  /* ---------- v81 Add-Storage actions ---------- */
  const healAll = async () => {
    setHealBusy(true)
    try {
      const res = await fetch('/api/sdks/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healAll: true }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Heal failed to start'); return }
      toast.success(data.message || 'Heal run started')
      refreshProvision(); refresh(true)
    } catch { toast.error('Request failed') } finally { setHealBusy(false) }
  }

  /* ---------- v94 per-toolchain one-click install ---------- */
  const [installingTc, setInstallingTc] = useState<string | null>(null)
  const installToolchain = async (name: string) => {
    setInstallingTc(name)
    try {
      const res = await fetch('/api/sdks/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: name }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Install failed to start'); setInstallingTc(null); return }
      if (data.started) {
        toast.success(data.message || `installing ${name}...`)
        // poll until the probe appears or 15 min ceiling (big SDKs are slow)
        const started = Date.now()
        const poll = async () => {
          try {
            const st = await fetch('/api/sdks').then(r => r.json())
            const tc = (st?.toolchains || []).find((x: Toolchain) => x.name === name)
            if (tc?.present) { toast.success(`${name} installed ✓`); refresh(true); setInstallingTc(null); return }
            if (Date.now() - started > 15 * 60 * 1000) { toast.error(`${name} install still pending — check again in a minute`); setInstallingTc(null); return }
            setTimeout(poll, 8000)
          } catch { setTimeout(poll, 8000) }
        }
        setTimeout(poll, 8000)
      } else {
        // honest blocked/already-ready detail from the API
        toast.info(data.message || 'not started — see detail')
        setInstallingTc(null)
      }
    } catch { toast.error('Request failed'); setInstallingTc(null) }
  }

  const retryJob = async (j: ProvisionJob) => {
    try {
      const res = await fetch('/api/sdks/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: j.projectId, language: j.language }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Retry failed'); return }
      toast.success(`Re-running setup for '${j.projectName}' (${j.language})`)
      refreshProvision()
    } catch { toast.error('Request failed') }
  }

  return (
    <Dialog open={sdkManagerOpen} onOpenChange={setSdkManagerOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="w-4 h-4" /> SDK Manager
            {state?.doctor?.running && (
              <Badge variant="outline" className="text-[10px] text-accent border-accent/40">
                <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" /> healing
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Toolchains are installed permanently and auto-healed on every server boot. Custom binaries are added by URL.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- Storage ---------- */}
        {st && st.totalGb > 0 && (
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-medium flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> Storage</span>
              <span className="text-muted-foreground text-xs">{st.usedGb} / {st.totalGb} GB used · {st.freeGb} GB free</span>
            </div>
            <Progress value={st.usedPct} className="h-2" />
            <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              {st.limit}. Bigger cloud storage (e.g. 25→70 GB) is a platform-side plan upgrade — this panel always shows the real, live numbers.
            </p>
          </div>
        )}

        {/* ---------- v81 Add Storage — automatic SDK provisioning ---------- */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <FolderPlus className="w-3.5 h-3.5 text-primary" /> Add Storage — automatic SDK setup
            </span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={healAll} disabled={healBusy}>
              {healBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
              Install missing now
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            ON by default: create a project or import a ZIP and this engine installs every SDK/tool the selected language needs into the persistent sdk/ storage — run, build and publish become ready without touching this panel.
          </p>
          {provisionJobs === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> checking…</div>
          ) : provisionJobs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No auto-setup runs yet — create/import a project and it will appear here with live progress.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {provisionJobs.map(j => (
                <div key={j.projectId} className="rounded-md border border-border bg-card/40 px-2.5 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium truncate max-w-[180px]">{j.projectName}</span>
                    <Badge variant="outline" className="text-[9px] py-0 h-4">{j.language}</Badge>
                    <Badge variant="outline" className="text-[9px] py-0 h-4 text-muted-foreground">{j.source}</Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(j.updatedAt).toLocaleString()}</span>
                    {j.items.some(i => i.action === 'blocked-disk' || i.action === 'failed') && (
                      <Button variant="outline" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => retryJob(j)}>Retry</Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {j.items.map(i => (
                      <span key={i.name} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                        i.action === 'installed' || i.action === 'already-ready'
                          ? 'border-emerald-500/40 text-emerald-600'
                          : i.action === 'installing'
                            ? 'border-accent/40 text-accent'
                            : i.action === 'blocked-disk' || i.action === 'failed'
                              ? 'border-red-500/40 text-red-500'
                              : 'border-border text-muted-foreground'
                      }`} title={i.detail || ''}>
                        {i.action === 'installing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {(i.action === 'installed' || i.action === 'already-ready') && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {(i.action === 'blocked-disk' || i.action === 'failed') && <XCircle className="w-2.5 h-2.5" />}
                        {i.name}
                      </span>
                    ))}
                  </div>
                  {j.items.some(i => i.action === 'blocked-disk') && (
                    <p className="text-[10px] text-muted-foreground mt-1.5 flex items-start gap-1">
                      <Info className="w-3 h-3 mt-0.5 shrink-0" />
                      {j.items.find(i => i.action === 'blocked-disk')?.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------- v95: CLOUD VAULT — Cloudflare R2 (PRIMARY, owner's budget choice) ----------
            Owner: "Amarto budget nei R2 te storage er price kom ase" + "firebase R2 bad diye".
            Free tier: 10 GB storage + ZERO egress fees. Restore points + publish artifacts
            land here; local disk stays untouched. */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <DatabaseBackup className="w-3.5 h-3.5 text-primary" /> Cloud Vault — Cloudflare R2
            </span>
            {r2?.connected && (
              r2.enabled ? (
                r2.error ? (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-amber-600 border-amber-500/40">check bucket</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">vault ready</Badge>
                )
              ) : (
                <Badge variant="outline" className="text-[9px] py-0 h-4 text-amber-600 border-amber-500/40">OFF</Badge>
              )
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Keeps RESTORE POINTS of everything you built (projects, files, chats/runs, settings) + every published APK/EXE inside <span className="font-medium text-foreground">your own Cloudflare R2 bucket</span>. Phone lost, account changed, sandbox wiped — tap Restore and continue. <span className="text-foreground">Free tier: 10 GB, zero download fees — cheaper than Firebase.</span>
          </p>

          {!r2 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> checking…</div>
          ) : r2.connected ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2 bg-card/40">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-medium">Use R2 vault</div>
                  <div className="text-[10px] text-muted-foreground">OFF = no backups/artifact uploads, auto-backup paused</div>
                </div>
                <Switch checked={r2.enabled} onCheckedChange={(on) => r2Action({ action: 'set-enabled', enabled: on }, on ? 'R2 vault ON' : 'R2 vault OFF')} disabled={r2Busy} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono text-[10px] truncate max-w-[240px]">{r2.bucket}</span>
                <span className="text-muted-foreground font-mono text-[10px] truncate max-w-[180px]">…{r2.accountId.slice(-8)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2 bg-card/40">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-medium">Daily auto-backup</div>
                  <div className="text-[10px] text-muted-foreground">
                    Last: {r2.lastBackupAt ? new Date(r2.lastBackupAt).toLocaleString() : 'never'}{r2.lastBackupNote ? ` · ${r2.lastBackupNote}` : ''}
                  </div>
                </div>
                <Switch checked={r2.auto} onCheckedChange={(on) => r2Action({ action: 'set-auto', auto: on }, on ? 'Auto-backup ON — a restore point is kept fresh every day' : 'Auto-backup OFF')} disabled={r2Busy} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={r2BackupNow} disabled={r2Busy || !r2.enabled} className="h-8">
                  {r2Busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5 mr-1" />}
                  Back up now
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px] text-destructive hover:text-destructive" onClick={r2Disconnect} disabled={r2Busy}>
                  Disconnect
                </Button>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  vault used: {(r2.vaultUsedKb / 1024).toFixed(2)} MB · free tier 10 GB
                </span>
              </div>
              {r2.error && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" /> {r2.error}
                </p>
              )}
              {r2.enabled && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Restore points in your R2 bucket</div>
                  {r2.backups.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-3 text-[11px] text-muted-foreground">
                      No restore points yet — tap <span className="font-medium text-foreground">Back up now</span> once; after that the daily auto-backup keeps them fresh.
                    </div>
                  ) : (
                    r2.backups.slice(0, 12).map(b => (
                      <div key={b.name} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
                        <DatabaseBackup className="w-3.5 h-3.5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{b.exportedAt ? new Date(b.exportedAt).toLocaleString() : b.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{b.sizeKb} KB · {b.name}</div>
                        </div>
                        <Button variant="outline" size="sm" className="h-7 text-[11px] shrink-0" disabled={r2Busy} onClick={() => r2Restore(b)}>
                          {r2Busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          <span className="ml-1">Restore</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => r2Delete(b)} title="Delete restore point">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* step 1 — account id + bucket */}
              <div className="text-[11px] font-medium text-foreground">1 · Account ID + bucket name</div>
              <Textarea
                placeholder={`Account ID: e.g. a1b2c3d4…32-character hex (Cloudflare dashboard → R2 → Overview → Account details)\nBucket: e.g. cloud-agent (R2 → Create bucket)`}
                value={r2ConfigText}
                onChange={e => setR2ConfigText(e.target.value)}
                className="min-h-[54px] font-mono text-[10px]"
              />
              <Button size="sm" variant="outline" onClick={saveR2ConfigUi} disabled={r2Busy} className="h-8">
                {r2Busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                Save R2 bucket
              </Button>
              {/* step 2 — API token keys */}
              <div className="text-[11px] font-medium text-foreground pt-1">2 · API token keys (the actual connect)</div>
              <Textarea
                placeholder={'Access Key ID: e.g. 1a2b3c4d…\nSecret Access Key: e.g. long-secret-value (shows ONLY once when the token is created)'}
                value={r2KeysText}
                onChange={e => setR2KeysText(e.target.value)}
                className="min-h-[54px] font-mono text-[10px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={connectR2Keys} disabled={r2Busy} className="h-8">
                  {r2Busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1" />}
                  Connect R2 vault
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setR2ShowSteps(s => !s)}>
                  {r2ShowSteps ? <><ChevronUp className="w-3 h-3 mr-0.5" /> Hide steps</> : <><ChevronDown className="w-3 h-3 mr-0.5" /> How to get these? (phone, ~3 min)</>}
                </Button>
              </div>
              {r2ShowSteps && (
                <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside bg-muted/30 rounded-md p-2.5">
                  <li>Open <span className="text-foreground font-medium">dash.cloudflare.com</span> → left menu <span className="text-foreground">R2 Object Storage</span> (first use asks to activate R2 — free, may need a card/PayPal on file).</li>
                  <li><span className="text-foreground">Overview</span> page → copy the <span className="text-foreground">Account ID</span> (32 hex characters) → paste above.</li>
                  <li><span className="text-foreground">Create bucket</span> → name it e.g. <span className="font-mono">cloud-agent</span> → Create → put the name above.</li>
                  <li><span className="text-foreground">Manage API tokens</span> → <span className="text-foreground">Create API token</span> → permission <span className="text-foreground">Object Read &amp; Write</span> → scope: this bucket → copy BOTH the Access Key ID and Secret Access Key → paste above → <span className="text-foreground">Connect R2 vault</span>.</li>
                  <li>Done — keys are AES-encrypted and stored only inside this builder.</li>
                </ol>
              )}
              <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                The Secret key never leaves this sandbox (AES-encrypted). API keys and lock codes NEVER enter a backup — projects/files/runs/settings only. R2 free tier: 10 GB with zero egress (download) fees.
              </p>
            </div>
          )}
        </div>

        {/* ---------- v89: CLOUD VAULT — Firebase Storage (backup & restore) ----------
            The owner's own words: "firebase er shathe conect thakle … jodi amar ei
            mobile ta hariyeu jay amr kisui hobena" + account changes and
            snapshot rollbacks. Honest scope: restore points in HIS Firebase —
            not a build-disk upgrade, not an editor bridge. */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <DatabaseBackup className="w-3.5 h-3.5 text-primary" /> Cloud Vault — Firebase Storage (fallback)
            </span>
            {fb?.connected && (
              fb.enabled ? (
                fb.error ? (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-amber-600 border-amber-500/40">activate Storage</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">vault ready</Badge>
                )
              ) : (
                <Badge variant="outline" className="text-[9px] py-0 h-4 text-amber-600 border-amber-500/40">OFF</Badge>
              )
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Keeps RESTORE POINTS of everything you built (projects, files, chats/runs, settings) inside <span className="font-medium text-foreground">your own Firebase</span>. Phone lost, account changed, sandbox wiped — tap Restore and continue. Builds already run in the cloud sandbox (your phone is only the screen) — the vault protects your <span className="font-medium text-foreground">data</span>, it does not add build disk.
          </p>

          {!fb ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> checking…</div>
          ) : fb.connected ? (
            <div className="space-y-2.5">
              {/* master on/off switch (the owner explicitly asked for on/off) */}
              <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2 bg-card/40">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-medium">Use Cloud Vault (Firebase)</div>
                  <div className="text-[10px] text-muted-foreground">OFF = no backups upload, restore list hidden, auto-backup paused</div>
                </div>
                <Switch checked={fb.enabled} onCheckedChange={(on) => fbAction({ action: 'set-enabled', enabled: on }, on ? 'Cloud Vault ON' : 'Cloud Vault OFF')} disabled={fbBusy} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono text-[10px] truncate max-w-[240px]">{fb.bucket}</span>
                <span className="text-muted-foreground truncate max-w-[220px]">{fb.serviceAccountEmail}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2 bg-card/40">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-medium">Daily auto-backup</div>
                  <div className="text-[10px] text-muted-foreground">
                    Last: {fb.lastBackupAt ? new Date(fb.lastBackupAt).toLocaleString() : 'never'}{fb.lastBackupNote ? ` · ${fb.lastBackupNote}` : ''}
                  </div>
                </div>
                <Switch checked={fb.auto} onCheckedChange={(on) => fbAction({ action: 'set-auto', auto: on }, on ? 'Auto-backup ON — a restore point is kept fresh every day' : 'Auto-backup OFF')} disabled={fbBusy} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={fbBackupNow} disabled={fbBusy || !fb.enabled} className="h-8">
                  {fbBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5 mr-1" />}
                  Back up now
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px] text-destructive hover:text-destructive" onClick={fbDisconnect} disabled={fbBusy}>
                  Disconnect
                </Button>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  vault used: {(fb.vaultUsedKb / 1024).toFixed(2)} MB · free tier gives 5 GB
                </span>
              </div>
              {fb.error && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" /> {fb.error}
                </p>
              )}
              {/* restore-point list */}
              {fb.enabled && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Restore points in your Firebase</div>
                  {fb.backups.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-3 text-[11px] text-muted-foreground">
                      No restore points yet — tap <span className="font-medium text-foreground">Back up now</span> once; after that the daily auto-backup keeps them fresh.
                    </div>
                  ) : (
                    fb.backups.slice(0, 12).map(b => (
                      <div key={b.name} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
                        <DatabaseBackup className="w-3.5 h-3.5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{b.exportedAt ? new Date(b.exportedAt).toLocaleString() : b.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{b.sizeKb} KB · {b.name}</div>
                        </div>
                        <Button variant="outline" size="sm" className="h-7 text-[11px] shrink-0" disabled={fbBusy} onClick={() => fbRestore(b)}>
                          {fbBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          <span className="ml-1">Restore</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => fbDelete(b)} title="Delete restore point">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* step 1 — firebaseConfig */}
              <div className="text-[11px] font-medium text-foreground">1 · Your Firebase project</div>
              <Textarea
                placeholder={`// Paste the whole firebaseConfig block from Firebase Console →\n// Project settings → General → Your apps (SDK setup and configuration)\nconst firebaseConfig = {\n  apiKey: "…",\n  authDomain: "cloud-agent-19b5f.firebaseapp.com",\n  projectId: "cloud-agent-19b5f",\n  storageBucket: "cloud-agent-19b5f.firebasestorage.app",\n  appId: "…"\n}`}
                value={fbConfigText}
                onChange={e => setFbConfigText(e.target.value)}
                className="min-h-[70px] font-mono text-[10px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={saveFbConfig} disabled={fbBusy} className="h-8">
                  {fbBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                  Save Firebase project
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setFbConfigText('const firebaseConfig = {\n  apiKey: "AIzaSyAhQoFj6WCacnd0u3JQwGyBb1-vcRS_p2o",\n  authDomain: "cloud-agent-19b5f.firebaseapp.com",\n  projectId: "cloud-agent-19b5f",\n  storageBucket: "cloud-agent-19b5f.firebasestorage.app",\n  messagingSenderId: "196934245112",\n  appId: "1:196934245112:web:4d6980fee1a782b3a3f90d",\n  measurementId: "G-6NWPHZC1GW"\n}')}>
                  Fill my config (cloud-agent-19b5f)
                </Button>
              </div>
              {/* step 2 — service account */}
              <div className="text-[11px] font-medium text-foreground pt-1">2 · Service-account key (the actual connect)</div>
              <input
                ref={fbSaFileRef}
                type="file"
                className="hidden"
                accept=".json,application/json,text/plain"
                onChange={e => { const f = e.target.files?.[0]; if (f) readFbSaFile(f) }}
              />
              <Textarea
                placeholder={'// Pick the downloaded private-key JSON file (easiest on phone) or paste its contents here:\n{\n  "type": "service_account",\n  "project_id": "cloud-agent-19b5f",\n  "private_key": "(the long PEM text from the file)",\n  "client_email": "firebase-adminsdk-...@cloud-agent-19b5f.iam.gserviceaccount.com"\n}'}
                value={fbSaText}
                onChange={e => setFbSaText(e.target.value)}
                className="min-h-[70px] font-mono text-[10px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={connectFbSa} disabled={fbBusy} className="h-8">
                  {fbBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1" />}
                  Connect Cloud Vault
                </Button>
                <Button size="sm" variant="outline" onClick={() => fbSaFileRef.current?.click()} disabled={fbBusy} className="h-8">
                  <Upload className="w-3.5 h-3.5 mr-1" /> Pick key file
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setFbShowSteps(s => !s)}>
                  {fbShowSteps ? <><ChevronUp className="w-3 h-3 mr-0.5" /> Hide steps</> : <><ChevronDown className="w-3 h-3 mr-0.5" /> How to get the key? (phone, ~2 min)</>}
                </Button>
              </div>
              {fbShowSteps && (
                <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside bg-muted/30 rounded-md p-2.5">
                  <li>Open <span className="text-foreground font-medium">console.firebase.google.com</span> → your project <span className="font-mono">cloud-agent-19b5f</span>.</li>
                  <li>⚙️ <span className="text-foreground">Project settings</span> → <span className="text-foreground">Service accounts</span> tab.</li>
                  <li>Tap <span className="text-foreground">Generate new private key</span> → Create → a <span className="font-mono">.json</span> file downloads.</li>
                  <li>Come back here → <span className="text-foreground">Pick key file</span> → choose that .json → <span className="text-foreground">Connect Cloud Vault</span>. Done — the key is encrypted and stored only inside this builder.</li>
                </ol>
              )}
              <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                The key never leaves this sandbox (AES-encrypted). API keys and lock codes NEVER enter a backup — projects/files/runs/settings only. Firebase free tier: 5 GB of restore points — years of daily backups.
              </p>
            </div>
          )}
        </div>

        {/* ---------- v89: TAKE THE SOURCE ANYWHERE (honest editor bridge) ---------- */}
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-primary" /> Take the source anywhere (VS Code / Android Studio / Cursor)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Honest note: no cloud service (R2 or Firebase included) can live-edit a running sandbox app from a PC editor — but the COMPLETE source can travel to you. Download it here or push it straight to your cloud vault (R2 first, Firebase fallback), open it on any computer, edit/upgrade in any editor. Your projects&apos; DATA travels with the Cloud Vault backup above, not with this archive.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportSourceDownload} className="h-8">
              <Download className="w-3.5 h-3.5 mr-1" /> Download source (.tar.gz)
            </Button>
            <Button size="sm" variant="outline" onClick={exportSourceToFirebase} disabled={exportBusy || !(r2?.connected && r2.enabled === true || fb?.connected && fb.enabled === true)} className="h-8">
              {exportBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5 mr-1" />}
              Send to my vault
            </Button>
            {!(r2?.connected && r2.enabled === true || fb?.connected && fb.enabled === true) && (
              <span className="text-[10px] text-muted-foreground">Needs a cloud vault connected + ON (R2 recommended, Firebase works too)</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            Includes the .env secrets (lock recovery key) — keep the archive private. Excludes node_modules, SDK toolchains and the live database.
          </p>
        </div>

        {/* ---------- Managed toolchains ---------- */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Managed toolchains — {presentCount}/{total} installed
            </span>
            <Button variant="ghost" size="sm" onClick={() => refresh()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {(state?.toolchains || []).map(t => (
              <div key={t.name} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 bg-card/30">
                {t.present
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  : <XCircle className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.version}</div>
                </div>
                {t.present ? (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">ready</Badge>
                ) : installingTc === t.name ? (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 text-accent border-accent/40">
                    <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" /> installing
                  </Badge>
                ) : (
                  <Button variant="outline" size="sm" className="h-5 px-1.5 text-[9px] py-0" onClick={() => installToolchain(t.name)}>
                    <Download className="w-2.5 h-2.5 mr-0.5" /> Install
                  </Button>
                )}
              </div>
            ))}
          </div>
          {state && presentCount < total && (
            <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Press Install beside any missing toolchain (background download, button flips to “installing”). Everything also auto-heals on every server boot (sdk-doctor).
            </p>
          )}
        </div>

        {/* ---------- v86/v87: Added storage archives — direct install.
            Always visible (v87): the old `uploads.length > 0 &&` guard made
            the WHOLE card vanish when the mount was empty — the owner opened
            the dialog hunting for "Add Storage" and found nothing. Now the
            empty state explains exactly how files get here. */}
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Added storage — install a stored SDK directly
            </div>
            {/* v88: upload straight from the phone's file manager */}
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept=".zip,.tar.gz,.tgz,.tar.bz2,.tar.xz,.bin,.jar,.aar,application/zip,application/gzip,application/x-tar,application/octet-stream"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFromDevice(f) }}
            />
            <Button variant="outline" size="sm" className="h-7 text-[11px] shrink-0" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              <span className="ml-1">{uploading ? 'Uploading…' : 'Upload from device'}</span>
            </Button>
          </div>
          {uploads.length > 0 ? (
            <div className="space-y-1.5">
              {uploads.map(u => (
                <div key={u.path} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
                  <HardDrive className="w-3.5 h-3.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{u.name}</div>
                    <div className="text-[10px] text-muted-foreground">{(u.size / (1024 * 1024)).toFixed(1)} MB · {u.format}</div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] shrink-0" disabled={installing || !u.installable} onClick={() => installFromUpload(u)}>
                    {installing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    <span className="ml-1">Install</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-3 text-[11px] text-muted-foreground leading-relaxed">
              Tap <span className="font-medium text-foreground">Upload from device</span> to pick an SDK archive (.zip / .tar.gz) from your phone's file manager — it is stored here permanently and shows up with a one-tap Install.
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            These files live in the platform's added storage — they survive restarts. Installing copies (no download) into <code className="text-[10px]">sdk/custom/&lt;name&gt;</code> and puts it on PATH for runs and the Terminal.
          </p>
        </div>

        {/* ---------- Custom install ---------- */}
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Custom SDK binary — install by URL
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="name (e.g. protobuf)" value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm flex-1 min-w-0" />
            <Input placeholder="https://… (direct download URL)" value={url} onChange={e => setUrl(e.target.value)} className="h-9 text-sm flex-[2] min-w-0" />
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="h-9 text-sm w-full sm:w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMATS.map(f => <SelectItem key={f} value={f} className="text-sm">{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={install} disabled={installing} className="h-9 shrink-0">
              {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span className="ml-1">Install</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Lands in <code className="text-[10px]">sdk/custom/&lt;name&gt;</code> — every project run picks it up on PATH automatically (no restart needed).
          </p>

          {/* active/failed custom installs */}
          {(state?.custom || []).length > 0 && (
            <div className="mt-3 space-y-1.5">
              {state!.custom.map(c => (
                <div key={c.name} className="rounded-md border border-border bg-card/40 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    {c.status === 'installing'
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                      : c.status === 'ok'
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                    <span className="text-xs font-medium flex-1 truncate">{c.name}</span>
                    {c.sizeMb != null && c.sizeMb > 0 && <span className="text-[10px] text-muted-foreground">{c.sizeMb} MB</span>}
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCustom(c.name)} title="Remove">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  {c.status !== 'ok' && c.log && (
                    <pre className="text-[10px] text-muted-foreground mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap">{c.log}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* one-click re-install history (survives snapshot wipes) */}
          {history.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Re-install after a server reset (saved history)</div>
              <div className="flex flex-wrap gap-1.5">
                {history.map(h => (
                  <Button key={h.name} variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => reinstallFromHistory(h)} disabled={installing}>
                    <PackageOpen className="w-3 h-3 mr-1" /> {h.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
