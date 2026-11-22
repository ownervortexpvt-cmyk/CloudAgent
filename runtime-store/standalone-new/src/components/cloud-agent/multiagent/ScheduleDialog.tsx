'use client'

/**
 * v58 — ⏰ ScheduleDialog: scheduled army runs.
 *
 * The army can now fire ITSELF on a timer: pick the task, the mode
 * (single agent or the full swarm) and an interval — a real server-side
 * scheduler (src/lib/scheduler.ts) fires the SAME real runs the buttons
 * fire, on time, even while every browser is closed. Nothing simulated:
 * each fire is stamped on the schedule row (lastStatus / lastRunAt /
 * nextRunAt) so this screen always shows the honest truth.
 *
 * Interval floor: 5 minutes — protects the user's keys from runaway loops.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CalendarClock, Loader2, Plus, RefreshCw, Trash2, Bot, Crown, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface ScheduleRow {
  id: string
  projectId: string
  prompt: string
  mode: 'single' | 'swarm'
  intervalMinutes: number
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: string
  lastRunId: string | null
  createdAt: string
}

const INTERVALS = [
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every 1 hour' },
  { value: '180', label: 'Every 3 hours' },
  { value: '360', label: 'Every 6 hours' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Every 24 hours' },
]

function timeOrNever(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function ScheduleDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (b: boolean) => void }) {
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'single' | 'swarm'>('single')
  const [intervalMin, setIntervalMin] = useState('60')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/schedules?projectId=${encodeURIComponent(projectId)}`)
      const data = await res.json().catch(() => null)
      if (data?.ok) setRows(data.schedules || [])
    } catch {}
    finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function createSchedule() {
    if (!prompt.trim()) {
      toast.error('Write the task first — what should the army do?')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: prompt.trim(), mode, intervalMinutes: Number(intervalMin) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Could not create the schedule')
        return
      }
      toast.success(`⏰ Scheduled — the ${mode === 'swarm' ? 'army' : 'agent'} will run every ${Number(intervalMin) >= 60 ? `${Number(intervalMin) / 60} hour(s)` : `${intervalMin} min`}`)
      setPrompt('')
      void load()
    } catch {
      toast.error('Network error while creating the schedule')
    } finally {
      setCreating(false)
    }
  }

  async function toggleSchedule(row: ScheduleRow, enabled: boolean) {
    try {
      const res = await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, enabled }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Could not update the schedule')
        return
      }
      toast.success(enabled ? '⏰ Schedule enabled — next run scheduled' : '⏹ Schedule paused — nothing will fire')
      void load()
    } catch {
      toast.error('Network error while updating the schedule')
    }
  }

  async function removeSchedule(row: ScheduleRow) {
    try {
      const res = await fetch(`/api/schedules?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Could not remove the schedule')
        return
      }
      toast.success('Schedule removed')
      void load()
    } catch {
      toast.error('Network error while removing the schedule')
    }
  }

  /** v59 — ⚡ Run now: fire THIS schedule immediately through the server's
   *  real scheduler fire path (same code the timer uses). Works even while
   *  paused — a one-shot owner tap never silently re-enables the schedule. */
  async function runScheduleNow(row: ScheduleRow) {
    try {
      const res = await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, runNow: true }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Could not fire the run')
        return
      }
      toast.success(`⚡ Run started — the ${row.mode === 'swarm' ? 'army' : 'agent'} is firing now; watch "Last" below for the outcome`)
      // Poll once after a beat so the row shows ⏳ running now…
      setTimeout(() => void load(), 1500)
    } catch {
      toast.error('Network error while starting the run')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="w-4 h-4 text-primary" />
            Scheduled runs — the army fires itself
          </DialogTitle>
          <DialogDescription className="text-xs">
            A real server-side scheduler launches these runs on time, even with no browser open. Runs use your saved
            keys exactly like the buttons do. Minimum interval: 5 minutes (protects your keys).
          </DialogDescription>
        </DialogHeader>

        {/* Create form */}
        <div className="space-y-2 border border-border rounded-lg p-3 bg-primary/5">
          <div className="space-y-1">
            <Label htmlFor="sched-prompt" className="text-xs">Task to run on schedule</Label>
            <Input
              id="sched-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Check the app, fix any errors you find and keep it working"
              className="text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void createSchedule() } }}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Who runs it</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as 'single' | 'swarm')}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single"><span className="flex items-center gap-1.5"><Bot className="w-3 h-3" />One agent — built-in Vortex Engine (cheap, 1 call)</span></SelectItem>
                  <SelectItem value="swarm"><span className="flex items-center gap-1.5"><Crown className="w-3 h-3" />Full army (leader + workers)</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Repeat</Label>
              <Select value={intervalMin} onValueChange={setIntervalMin}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-9" onClick={() => void createSchedule()} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-0.5" />}
              Schedule
            </Button>
          </div>
        </div>

        {/* Existing schedules */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-muted-foreground">
              {rows.length > 0 ? `${rows.length} schedule(s) for this project` : 'No schedules yet'}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void load()} title="Refresh">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          </div>
          {rows.map(r => (
            <div key={r.id} className="border border-border rounded-lg p-2.5 space-y-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate" title={r.prompt}>{r.prompt}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{r.mode === 'swarm' ? '👑 Full army' : '🤖 One agent'}</span>
                    <span>⏱ every {r.intervalMinutes >= 60 ? `${r.intervalMinutes / 60}h` : `${r.intervalMinutes}m`}</span>
                    <span>Next: {timeOrNever(r.nextRunAt)}</span>
                  </div>
                  <div className="text-[10px] mt-0.5">
                    <span className="text-muted-foreground">Last: </span>
                    {r.lastRunAt ? (
                      <span>
                        {timeOrNever(r.lastRunAt)} — {r.lastStatus}
                        {r.lastRunId && <span className="text-muted-foreground"> ({r.lastRunId})</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.lastStatus}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 text-primary hover:text-primary"
                    onClick={() => void runScheduleNow(r)}
                    title="Fire this schedule RIGHT NOW through the real scheduler — same path the timer uses"
                  >
                    <Zap className="w-3 h-3" />
                  </Button>
                  <Switch checked={r.enabled} onCheckedChange={(b) => void toggleSchedule(r, b)} />
                  <Badge variant={r.enabled ? 'outline' : 'secondary'} className="text-[9px] py-0 h-4">
                    {r.enabled ? 'ON' : 'PAUSED'}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-500" onClick={() => void removeSchedule(r)} title="Remove this schedule">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground">
          Runs fired by a schedule appear in the 🕘 run history like every other run. Pause any schedule with the
          switch — nothing fires while it is paused.
        </p>
      </DialogContent>
    </Dialog>
  )
}
