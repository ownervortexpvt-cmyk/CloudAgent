'use client'

/**
 * v94 — Export & Download dialog.
 *
 * The owner asked: "protita project er ekta button ase download korar
 * jonno — apk, ipa, exe ittadi". This dialog shows the HONEST capability
 * matrix per project:
 *   - Source ZIP: every project, immediate.
 *   - Android APK: flutter projects → real background build with live
 *     step progress; web projects get the honest reason instead.
 *   - Windows EXE: C#/.NET projects → real dotnet publish win-x64.
 *   - iOS IPA: never buildable on this Linux sandbox — honest note.
 * Buttons flip between Build / progress / Download driven by the status API.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, Smartphone, Monitor, Apple, FileArchive, Loader2, Info, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface TargetStatus {
  capable: boolean
  toolchainsOk?: boolean
  csproj?: string | null
  state: 'idle' | 'building' | 'done' | 'failed'
  step?: string
  note?: string | null
  file?: string | null
  reason?: string | null
}
interface ExportStatus {
  project: { id: string; name: string }
  zip: string
  diskFreeMb: number
  ramAvailableMb: number | null
  platformBusy: boolean
  targets: { apk: TargetStatus; exe: TargetStatus; ipa: TargetStatus }
}

const STEP_LABEL: Record<string, string> = {
  starting: 'starting…',
  scaffold: 'scaffolding android/',
  'memory-guard': 'memory guard (gradle heap cap)',
  'pub-get': 'resolving dart packages',
  'gradle-build': 'gradle build (first build 5-20 min)',
  restore: 'restoring nuget packages',
  publish: 'publishing win-x64',
}

export function ExportDialog({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { exportDialogOpen, setExportDialogOpen } = useAppStore()
  const [status, setStatus] = useState<ExportStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}/export?kind=status`)
      const data = await res.json().catch(() => null)
      if (res.ok && data) setStatus(data)
    } catch { /* transient */ }
  }, [projectId])

  useEffect(() => {
    if (!exportDialogOpen || !projectId) return
    setLoading(true)
    fetchStatus().finally(() => setLoading(false))
  }, [exportDialogOpen, projectId, fetchStatus])

  // poll while anything is building
  useEffect(() => {
    const anyBuilding = status && (status.targets?.apk?.state === 'building' || status.targets?.exe?.state === 'building')
    if (anyBuilding && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 3000)
    } else if (!anyBuilding && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current && !anyBuilding) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [status, fetchStatus])

  const startBuild = async (target: 'apk' | 'exe') => {
    setBusy(target)
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { toast.error(data?.error || 'Build failed to start'); return }
      toast.success(data.message || 'Build started')
      fetchStatus()
    } catch { toast.error('Request failed') } finally { setBusy(null) }
  }

  const downloadArtifact = (target: 'apk' | 'exe') => {
    const a = document.createElement('a')
    a.href = `/api/projects/${projectId}/export?kind=artifact&target=${target}`
    a.download = `${projectName.replace(/[^a-z0-9]+/gi, '-')}-${target}.${target}`
    a.click()
  }

  const renderTarget = (key: 'apk' | 'exe', icon: React.ReactNode, title: string, subtitle: string) => {
    if (!status) return null
    const t = status.targets?.[key]
    if (!t) return null
    const tState = t.state
    return (
      <div className="rounded-lg border border-border p-3 bg-card/30">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-sm font-medium flex-1">{title}</span>
          {tState === 'done' && <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">ready</Badge>}
          {tState === 'building' && (
            <Badge variant="outline" className="text-[9px] py-0 h-4 text-accent border-accent/40">
              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" /> building
            </Badge>
          )}
          {tState === 'failed' && <Badge variant="outline" className="text-[9px] py-0 h-4 text-red-600 border-red-500/40">failed</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">{subtitle}</p>
        {tState === 'building' && t.step && (
          <p className="text-[11px] text-accent mb-2 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {STEP_LABEL[t.step] || t.step}…
          </p>
        )}
        {t.note && tState !== 'building' && (
          <p className="text-[11px] text-muted-foreground mb-2">{t.note}</p>
        )}
        {!t.capable && t.reason && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" /> {t.reason}
          </p>
        )}
        <div className="flex items-center gap-2">
          {tState === 'done' ? (
            <Button size="sm" className="h-7 text-xs" onClick={() => downloadArtifact(key)}>
              <Download className="w-3.5 h-3.5 mr-1" /> Download {key.toUpperCase()}
            </Button>
          ) : t.capable && tState !== 'building' ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startBuild(key)} disabled={!!busy || !!status.platformBusy || (key === 'apk' && t.toolchainsOk === false)}>
              {busy === key ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
              Build {key.toUpperCase()}
            </Button>
          ) : tState === 'building' ? (
            <span className="text-[11px] text-muted-foreground">background build running — this dialog updates itself</span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" /> Export & Download
          </DialogTitle>
          <DialogDescription>
            {projectName} — download the project as ZIP, or build an installable app file.
          </DialogDescription>
        </DialogHeader>

        {loading && !status ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> checking what this project can build…
          </div>
        ) : status ? (
          <div className="space-y-2.5">
            {/* Source ZIP — always */}
            <div className="rounded-lg border border-border p-3 bg-card/30">
              <div className="flex items-center gap-2 mb-1">
                <FileArchive className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium flex-1">Source ZIP</span>
                <Badge variant="outline" className="text-[9px] py-0 h-4 text-emerald-600 border-emerald-500/40">always</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">Full project source — node_modules excluded. Re-importable via Upload ZIP.</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                <a href={status.zip || `/api/zip?projectId=${encodeURIComponent(projectId)}`} download={`${projectName.replace(/[^a-z0-9]+/gi, '-')}.zip`}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Download ZIP
                </a>
              </Button>
            </div>

            {renderTarget('apk', <Smartphone className="w-4 h-4 text-emerald-500" />, 'Android APK', 'Installable app file for Android phones (flutter build). Real background build with live progress.')}
            {renderTarget('exe', <Monitor className="w-4 h-4 text-blue-500" />, 'Windows EXE', 'Standalone Windows program (dotnet publish win-x64). For C#/.NET projects.')}
            {/* IPA — honest, always locked */}
            <div className="rounded-lg border border-border p-3 bg-card/30 opacity-80">
              <div className="flex items-center gap-2 mb-1">
                <Apple className="w-4 h-4" />
                <span className="text-sm font-medium flex-1">iOS IPA</span>
                <Badge variant="outline" className="text-[9px] py-0 h-4 text-muted-foreground">not possible here</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-red-500" />
                {status.targets?.ipa?.reason || 'iOS IPA builds need macOS + Xcode — not possible on this server.'}
              </p>
            </div>

            {status.targets?.apk?.state === 'done' && (
              <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> APK ready — install it on any Android phone (allow "install from unknown sources").
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">status unavailable</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
