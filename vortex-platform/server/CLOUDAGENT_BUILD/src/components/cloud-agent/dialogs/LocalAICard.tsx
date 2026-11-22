'use client'

/**
 * v111 — Local AI card for the Provider Manager.
 *
 * Shows the on-server open-source model runtime (Ollama / llama.cpp) and its
 * auto-provisioned zero-key models, plus one-click install for the 6-model
 * catalog. This is the "build without any AI API key" surface: every model
 * listed here runs on the owner's own server — no key, no per-token bill.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Loader2, RefreshCw, Server, HardDriveDownload, Trash2, ShieldCheck, Cpu } from 'lucide-react'
import { toast } from 'sonner'

interface CatalogModel {
  tag: string
  name: string
  family: string
  sizeGB: number
  ramGB: number
  strength: string
  ollamaName: string
}

interface LocalStatus {
  ok: boolean
  up: boolean
  server: string
  version: string | null
  base: string
  installed: string[]
  error: string | null
  providers: Array<{ id: string; name: string; model: string; isDefault: boolean }>
  catalog: CatalogModel[]
}

export function LocalAICard({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<LocalStatus | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/local', { cache: 'no-store' })
      setSt(await res.json())
    } catch {
      setSt(null)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20_000) // pulls take minutes — poll honestly
    return () => clearInterval(t)
  }, [load])

  async function act(action: string, model?: string) {
    setBusy(action + (model || ''))
    try {
      const res = await fetch('/api/ai/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, model }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        if (action === 'install') toast.success(`${model} downloading in the background — press Rescan in a minute.`)
        else if (action === 'remove') toast.success(`${model} removed.`)
        onChanged()
      } else {
        toast.error(data?.error || `Action failed (HTTP ${res.status}).`)
      }
    } catch {
      toast.error('Network error.')
    } finally {
      setBusy('')
      load()
    }
  }

  const up = Boolean(st?.up)
  const installedSet = new Set(st?.installed || [])

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              Local open-source AI
              <Badge variant="secondary" className="text-[10px]">no API key needed</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Models that run on this server — free, private, always available.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs flex items-center gap-1 ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${up ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            {up ? `online · ${st?.server}${st?.version ? ` v${st.version}` : ''}` : 'offline'}
          </span>
          <Button size="sm" variant="outline" onClick={() => act('sync')} disabled={busy === 'sync'} title="Re-detect installed models and (re)provision them">
            {busy === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Rescan
          </Button>
        </div>
      </div>

      {!st && <div className="text-xs text-muted-foreground">Checking the local model runtime…</div>}

      {st && !up && (
        <div className="text-xs text-muted-foreground rounded-lg border border-dashed p-3">
          No local model server detected on <code className="text-[11px]">{st.base}</code>.
          {st.error ? ` (${st.error})` : null} Run <code className="text-[11px]">bash scripts/setup-models.sh</code> on this
          host to install Ollama + the 6-model open-source catalog — the builder then provisions every model automatically
          and users can build apps without any API key.
        </div>
      )}

      {st && up && (
        <>
          {st.providers.length > 0 && (
            <div className="space-y-1.5">
              {st.providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground ml-2 font-mono text-[10px]">{p.model}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">ready · zero-key</Badge>
                </div>
              ))}
            </div>
          )}

          <div className="pt-1 border-t">
            <div className="text-[11px] text-muted-foreground mt-2 mb-1.5 flex items-center gap-1">
              <HardDriveDownload className="w-3 h-3" /> Model catalog — click to install on this server
              {st.server !== 'ollama' && <span className="ml-1">(install needs the Ollama runtime)</span>}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {st.catalog.map((m) => {
                const has = installedSet.has(m.tag) || st.providers.some((p) => p.model === m.tag)
                return (
                  <div key={m.tag} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{m.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{m.sizeGB}GB · {m.strength}</div>
                    </div>
                    {has ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px]"><ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> installed</Badge>
                        {st.server === 'ollama' && (
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => act('remove', m.ollamaName)} disabled={busy === 'remove' + m.ollamaName} title="Remove from the server">
                            {busy === 'remove' + m.ollamaName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] shrink-0"
                        onClick={() => act('install', m.ollamaName)}
                        disabled={busy === 'install' + m.ollamaName || st.server !== 'ollama'}
                        title={st.server !== 'ollama' ? 'Model install needs the Ollama runtime (scripts/setup-models.sh)' : `Download ${m.sizeGB}GB`}
                      >
                        {busy === 'install' + m.ollamaName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
                        Install
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
