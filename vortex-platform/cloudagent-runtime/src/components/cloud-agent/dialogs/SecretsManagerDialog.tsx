'use client'

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Key, Plus, Trash2, Eye, EyeOff, Upload, Download, Copy,
  Shield, ShieldCheck, Loader2, CheckCircle2, XCircle, FlaskConical, AlertTriangle,
  FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface SecretEntry {
  id?: string
  key: string
  value: string
  isSecret: boolean
  scope: 'project' | 'global'
  masked?: string
}

export function SecretsManagerDialog() {
  const { secretsOpen, setSecretsOpen, activeProject } = useAppStore()
  const [projectSecrets, setProjectSecrets] = useState<SecretEntry[]>([])
  const [globalSecrets, setGlobalSecrets] = useState<SecretEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})

  // New secret form
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newIsSecret, setNewIsSecret] = useState(true)
  // Default scope: project (if a project is open) or global (if on welcome page)
  const [newScope, setNewScope] = useState<'project' | 'global'>(activeProject ? 'project' : 'global')
  // Default tab: project (if a project is open) or global (welcome page)
  const [activeTab, setActiveTab] = useState<'project' | 'global' | 'bulk'>(activeProject ? 'project' : 'global')
  const [bulkText, setBulkText] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      // Project secrets
      if (activeProject) {
        const res = await fetch(`/api/settings?projectId=${activeProject.id}`)
        const data = await res.json()
        setProjectSecrets((data.envVars || []).map((v: any) => ({ ...v, scope: 'project' as const })))
      } else {
        setProjectSecrets([])
      }
      // Global secrets (stored in UserSetting with prefix)
      const res = await fetch('/api/secrets')
      const data = await res.json()
      setGlobalSecrets(data.secrets || [])
    } catch {
      toast.error('Failed to load secrets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (secretsOpen) load()
  }, [secretsOpen, activeProject?.id])

  async function addSecret() {
    if (!newKey.trim()) return toast.error('Key required')
    if (newScope === 'project' && !activeProject) return toast.error('Open a project first')

    try {
      if (newScope === 'project') {
        await fetch('/api/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProject!.id, key: newKey, value: newValue, isSecret: newIsSecret }),
        })
      } else {
        await fetch('/api/secrets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: newKey, value: newValue, isSecret: newIsSecret }),
        })
      }
      toast.success(`${newScope === 'project' ? 'Project' : 'Global'} secret saved`)
      setNewKey(''); setNewValue(''); setNewIsSecret(true)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function removeSecret(id: string, scope: 'project' | 'global') {
    if (!confirm('Delete this secret?')) return
    try {
      if (scope === 'project') {
        await fetch(`/api/settings?id=${id}`, { method: 'DELETE' })
      } else {
        await fetch(`/api/secrets?id=${id}`, { method: 'DELETE' })
      }
      toast.success('Secret deleted')
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function bulkImport() {
    if (!bulkText.trim()) return
    // Format: KEY=VALUE per line, or KEY: VALUE per line
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    let count = 0
    for (const line of lines) {
      const m = line.match(/^([A-Za-z0-9_]+)\s*[=:]\s*(.+)$/)
      if (!m) continue
      const [, k, v] = m
      if (newScope === 'project' && activeProject) {
        await fetch('/api/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProject.id, key: k, value: v, isSecret: true }),
        })
      } else {
        await fetch('/api/secrets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: k, value: v, isSecret: true }),
        })
      }
      count++
    }
    toast.success(`Imported ${count} secrets`)
    setBulkText('')
    load()
  }

  function exportEnv() {
    // Secrets are returned MASKED by the API — exporting the mask would write
    // garbage like "sk-1••••abcd" into .env and silently break imports. Warn
    // the user instead of writing masked placeholders.
    const hasMaskedSecret = [...projectSecrets, ...globalSecrets].some(s => s.isSecret)
    if (hasMaskedSecret && !confirm('Secret values are masked for security — masked entries will export as EMPTY values (key names only). Continue?')) return
    const all = [...projectSecrets, ...globalSecrets]
    const text = all
      .map(s => `${s.key}=${s.isSecret ? '' : (s.value || s.masked || '')}`)
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '.env'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function testSecret(entry: SecretEntry) {
    setTestingId(entry.id || entry.key)
    // Quick heuristic test: if it looks like an OpenAI/Gemini/Claude key, do a tiny API call.
    // Project secrets must pass their scope + projectId + row id — the test
    // route used to only look at GLOBAL storage, so project secrets always
    // failed with "secret not found in storage".
    try {
      const res = await fetch('/api/secrets/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: entry.key,
          id: entry.id,
          scope: entry.scope,
          projectId: entry.scope === 'project' ? activeProject?.id : undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) toast.success(`✓ ${entry.key} responds${data.scope ? ` (${data.scope})` : ''}`)
      else toast.error(`✗ ${entry.key}: ${data.error}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTestingId(null)
    }
  }

  /** Fetch the REAL (decrypted) value for a secret via the explicit
   *  reveal endpoint. Project secrets go through /api/settings/reveal;
   *  global secrets stay masked by design. */
  async function revealValue(entry: SecretEntry): Promise<string> {
    if (entry.scope === 'project' && entry.id) {
      const res = await fetch('/api/settings/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id }),
      })
      const data = await res.json()
      if (data.ok) return data.value
      toast.error(data.error || 'Could not reveal value')
      return ''
    }
    return entry.value || entry.masked || ''
  }

  async function copyValue(entry: SecretEntry) {
    // Copy used to copy the MASKED value ("sk-1••••abcd") — useless. Now it
    // resolves the real value first (project secrets via the reveal endpoint).
    const real = await revealValue(entry)
    navigator.clipboard.writeText(real)
    toast.success('Copied real value to clipboard')
  }

  const renderSecret = (entry: SecretEntry) => {
    const entryId = entry.id || entry.key
    const revealed = !!showValues[entryId]
    return (
    <div key={entryId} className="flex items-center gap-2 p-2 border border-border rounded text-sm">
      <code className="font-mono text-xs flex-1 truncate">{entry.key}</code>
      <code className="font-mono text-xs text-muted-foreground flex-1 truncate">
        {!revealed ? '••••••••••••' : (entry.value || entry.masked || '')}
      </code>
      {entry.isSecret && (
        <Button variant="ghost" size="icon" className="h-6 w-6" title={revealed ? 'Hide' : 'Reveal real value'} onClick={async () => {
          if (revealed) { setShowValues(s => ({ ...s, [entryId]: false })); return }
          // Fetch the decrypted value on demand (never sent in list responses)
          const real = await revealValue(entry)
          if (real) {
            if (entry.scope === 'project') {
              setProjectSecrets(list => list.map(x => (x.id === entry.id ? { ...x, value: real } : x)))
            } else {
              setGlobalSecrets(list => list.map(x => (x.id === entry.id ? { ...x, value: real } : x)))
            }
          }
          setShowValues(s => ({ ...s, [entryId]: true }))
        }}>
          {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyValue(entry)} title="Copy real value">
        <Copy className="w-3 h-3" />
      </Button>
      {entry.isSecret && (
        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={testingId === entryId} onClick={() => testSecret(entry)} title="Test connection">
          {testingId === entryId ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
        </Button>
      )}
      <Badge variant="outline" className="text-[10px]">{entry.isSecret ? 'secret' : 'plain'}</Badge>
      <Badge variant="outline" className="text-[10px] text-muted-foreground" title="Secret scope">{entry.scope}</Badge>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSecret(entry.id!, entry.scope)}>
        <Trash2 className="w-3 h-3 text-destructive" />
      </Button>
    </div>
    )
  }

  return (
    <Dialog open={secretsOpen} onOpenChange={setSecretsOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Secrets & Environment Variables
          </DialogTitle>
          <DialogDescription>
            Sensitive credentials (API keys, tokens, database URLs) are encrypted at rest with AES-256-GCM.
            Cloud Agent decrypts them only when needed — they are never sent to the browser in plaintext
            and never appear in logs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
            <Shield className="w-3 h-3 mr-1" />AES-256-GCM encrypted
          </Badge>
          <Badge variant="outline" className="text-[10px]">Server-side only</Badge>
          <Badge variant="outline" className="text-[10px]">Never logged</Badge>
          <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/30" title="Each project has its own Secrets. Switch to Global tab for secrets shared across all projects.">
            <FolderOpen className="w-3 h-3 mr-1" />Per-project isolation
          </Badge>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={exportEnv}><Download className="w-3.5 h-3.5 mr-1" />Export .env</Button>
        </div>

        <Card className="p-2 mb-3 bg-blue-500/5 border-blue-500/30 text-xs text-muted-foreground">
          <strong className="text-blue-400">Per-project isolation:</strong> Each project has its own Secrets, Terminal, Files, GitHub repository, and Settings. Switching projects switches all of these. Use the <strong>Global</strong> tab below for secrets shared across all projects (like a default OPENAI_API_KEY).
        </Card>

        <Tabs value={activeTab} onValueChange={(v) => {
          const tv = v as 'project' | 'global' | 'bulk'
          setActiveTab(tv)
          if (tv === 'project' || tv === 'global') setNewScope(tv)
        }}>
          <TabsList className="w-full">
            <TabsTrigger value="project" className="flex-1" disabled={!activeProject}>
              Project ({projectSecrets.length})
            </TabsTrigger>
            <TabsTrigger value="global" className="flex-1">
              Global ({globalSecrets.length})
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1">
              <Upload className="w-3.5 h-3.5 mr-1" />Bulk import
            </TabsTrigger>
          </TabsList>

          {/* Add new secret form */}
          <TabsContent value="project" className="mt-3">
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-end">
                <div>
                  <Label>Key</Label>
                  <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="OPENAI_API_KEY" className="font-mono text-xs" />
                </div>
                <div>
                  <Label>Value</Label>
                  <Input type={newIsSecret ? 'password' : 'text'} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="sk-..." className="font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Secret</Label>
                  <Switch checked={newIsSecret} onCheckedChange={setNewIsSecret} />
                </div>
                <Button size="sm" onClick={addSecret}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Scope: <Badge variant="outline" className="text-[10px]">{activeProject ? activeProject.name : 'Global'}</Badge>
              </p>
            </Card>

            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : projectSecrets.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground mt-2">
                <Key className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No project secrets yet. Add one above or bulk-import.
              </Card>
            ) : (
              <div className="space-y-1 mt-2">
                {projectSecrets.map(renderSecret)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="global" className="mt-3">
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-end">
                <div>
                  <Label>Key</Label>
                  <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="OPENAI_API_KEY" className="font-mono text-xs" />
                </div>
                <div>
                  <Label>Value</Label>
                  <Input type={newIsSecret ? 'password' : 'text'} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="sk-..." className="font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Secret</Label>
                  <Switch checked={newIsSecret} onCheckedChange={setNewIsSecret} />
                </div>
                <Button size="sm" onClick={addSecret}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Scope: <Badge variant="outline" className="text-[10px]">Global (available to all projects)</Badge>
              </p>
            </Card>

            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : globalSecrets.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground mt-2">
                <Key className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No global secrets yet. Add one above or bulk-import.
              </Card>
            ) : (
              <div className="space-y-1 mt-2">
                {globalSecrets.map(renderSecret)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bulk" className="mt-3 space-y-2">
            <Card className="p-3 space-y-2">
              <Label>Bulk paste (KEY=VALUE per line)</Label>
              <Textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`OPENAI_API_KEY=sk-abc123\nANTHROPIC_API_KEY=sk-ant-xyz\nDATABASE_URL=postgres://...`}
                rows={8}
                className="font-mono text-xs"
              />
              <div className="flex items-center gap-2">
                <Label>Scope:</Label>
                <select value={newScope} onChange={(e) => setNewScope(e.target.value as any)} className="bg-background border border-border rounded px-2 py-1 text-xs">
                  <option value="project" disabled={!activeProject}>Project{activeProject ? ` (${activeProject.name})` : ''}</option>
                  <option value="global">Global</option>
                </select>
                <Button size="sm" onClick={bulkImport}><Upload className="w-3.5 h-3.5 mr-1" />Import</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Lines starting with <code>#</code> are skipped. Empty lines are ignored. All imported values default to <code>secret=true</code>.
              </p>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="p-3 bg-amber-500/5 border-amber-500/30 mt-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <strong>Security note:</strong> Cloud Agent stores secrets encrypted, but anyone with filesystem
              access to the server can theoretically read them. For production deployments, set
              <code className="bg-muted px-1 py-0.5 rounded mx-1">CLOUD_AGENT_SECRET</code> env var to a strong random value
              to use a distinct encryption key.
            </div>
          </div>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
