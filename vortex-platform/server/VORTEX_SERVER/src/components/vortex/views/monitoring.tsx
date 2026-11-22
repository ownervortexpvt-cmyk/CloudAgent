"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  BellOff,
  CheckCircle2,
  Globe,
  HeartPulse,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { api, fmtAgo, type AlertRow, type CheckRow, type MonitorRow } from "../client";

const MON_STATUS: Record<string, string> = {
  UP: "border-emerald-500/40 text-emerald-400",
  DOWN: "border-red-500/40 text-red-400",
  PENDING: "border-sky-500/40 text-sky-400",
  PAUSED: "border-zinc-500/40 text-zinc-400",
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  URL: Globe,
  NODE: HeartPulse,
  DATABASE: Activity,
  SERVICE: HeartPulse,
};

export default function MonitoringView({ onChanged }: { onChanged: () => void }) {
  const monQuery = useQuery({
    queryKey: ["monitor"],
    queryFn: () =>
      api<{ targets: MonitorRow[]; checks: CheckRow[]; alerts: AlertRow[]; openAlerts: number }>("/api/v1/monitor"),
    refetchInterval: 20_000,
  });
  const data = monQuery.data?.ok ? monQuery.data.data ?? null : null;
  const [sweeping, setSweeping] = useState(false);

  const reload = () => {
    monQuery.refetch();
    onChanged();
  };

  async function runSweep() {
    setSweeping(true);
    const res = await api<{ summary: { ran: number; up: number; down: number; newAlerts: number } }>("/api/v1/monitor/run", {
      method: "POST",
    });
    setSweeping(false);
    if (!res.ok) {
      toast({ title: "Sweep failed", description: res.error, variant: "destructive" });
      return;
    }
    const s = res.data?.summary;
    toast({
      title: `Checked ${s?.ran ?? 0} targets — ${s?.up ?? 0} up, ${s?.down ?? 0} down`,
      description: s?.newAlerts ? `${s.newAlerts} new alert(s) raised` : "No new alerts",
    });
    reload();
  }

  const up = data?.targets.filter((t) => t.enabled && t.status === "UP").length ?? 0;
  const enabled = data?.targets.filter((t) => t.enabled).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Monitoring</h3>
          <p className="text-sm text-muted-foreground">
            MONITOR module — real-state health checks (URL probes, nodes, databases, services), rolling 24h uptime and
            alert events. Own dashboard, no AGPL Grafana. Downtime raises an alert and mails the outbox.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
            {up}/{enabled} up
          </Badge>
          {(data?.openAlerts ?? 0) > 0 && (
            <Badge variant="outline" className="border-red-500/40 text-red-400 animate-pulse">
              {data?.openAlerts} open alerts
            </Badge>
          )}
          <Button size="sm" variant="outline" disabled={sweeping} onClick={runSweep}>
            {sweeping ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Run all checks
          </Button>
          <AddMonitorDialog onCreated={reload} />
        </div>
      </div>

      <Tabs defaultValue="targets" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="targets" className="gap-2">
            <HeartPulse className="w-4 h-4" /> Targets
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="w-4 h-4" /> Alerts
            {(data?.openAlerts ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-red-500/20 text-red-400 px-1.5 text-[10px]">{data?.openAlerts}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="targets" className="mt-4">
          {!data ? <Skeleton className="h-72 rounded-xl" /> : <TargetsTab targets={data.targets} checks={data.checks} onChanged={reload} />}
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          {!data ? <Skeleton className="h-72 rounded-xl" /> : <AlertsTab alerts={data.alerts} onChanged={reload} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- TARGETS ---------------- */

function TargetsTab({ targets, checks, onChanged }: { targets: MonitorRow[]; checks: CheckRow[]; onChanged: () => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="max-h-[32rem] overflow-y-auto vortex-scroll">
          {targets.length === 0 && (
            <p className="text-sm text-muted-foreground p-6 text-center">No monitor targets yet.</p>
          )}
          {targets.map((t) => (
            <TargetRow key={t.id} target={t} checks={checks.filter((c) => c.targetId === t.id).slice(0, 20).reverse()} onChanged={onChanged} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TargetRow({ target, checks, onChanged }: { target: MonitorRow; checks: CheckRow[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const Icon = TYPE_ICON[target.targetType] || Globe;

  async function patch(action: string) {
    setBusy(true);
    const res = await api("/api/v1/monitor", { method: "PATCH", body: { id: target.monitorId, action } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    if (action === "RUN") {
      const okUp = (res.data as { result?: { up: boolean } } | undefined)?.result?.up;
      toast({ title: `${target.name}: ${okUp ? "UP" : "DOWN"}`, description: target.lastMessage || undefined });
    } else {
      toast({ title: `${target.name} ${action === "PAUSE" ? "paused" : "enabled"}` });
    }
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const res = await api(`/api/v1/monitor?id=${encodeURIComponent(target.monitorId)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${target.name} removed` });
    onChanged();
  }

  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {target.status === "UP" ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : target.status === "DOWN" ? (
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
        ) : target.status === "PAUSED" ? (
          <Pause className="w-4 h-4 text-zinc-500 shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-sky-400 shrink-0 animate-spin" />
        )}
        <span className="text-sm truncate">{target.name}</span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
          <Icon className="w-3 h-3 mr-1" /> {target.targetType}
        </Badge>
        {target.consecutiveFails > 0 && (
          <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400 shrink-0">
            {target.consecutiveFails}× fails
          </Badge>
        )}
      </div>

      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <code className="font-mono text-foreground/80 truncate block">{target.target}</code>
        <span>
          {target.lastCheckedAt ? `checked ${fmtAgo(target.lastCheckedAt)}` : "never checked"}
          {target.lastLatencyMs != null && ` · ${target.lastLatencyMs}ms`}
          {target.lastMessage && ` · ${target.lastMessage}`}
          {` · every ${target.intervalSec}s`}
        </span>
      </div>

      {/* last checks sparkline */}
      <div className="hidden sm:flex items-center gap-[3px] shrink-0" title="Last checks">
        {checks.length === 0 && <span className="text-[10px] text-muted-foreground">no history</span>}
        {checks.map((c) => (
          <span
            key={c.id}
            title={`${c.status}${c.latencyMs != null ? ` ${c.latencyMs}ms` : ""} — ${c.message || ""}`}
            className={`w-1.5 h-5 rounded-sm ${c.status === "UP" ? "bg-emerald-500/70" : "bg-red-500/80"}`}
            style={{ opacity: c.latencyMs ? Math.max(0.35, Math.min(1, 1.2 - c.latencyMs / 400)) : 1 }}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant="outline" className={`text-[10px] ${MON_STATUS[target.status] || ""}`}>
          {target.status}
          {target.uptimePct != null && ` · ${target.uptimePct}%`}
        </Badge>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch("RUN")} title="Check now">
          <Play className="w-3.5 h-3.5" />
        </Button>
        {target.enabled ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch("PAUSE")} title="Pause">
            <Pause className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch("ENABLE")} title="Enable">
            <Play className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={remove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ---------------- ALERTS ---------------- */

function AlertsTab({ alerts, onChanged }: { alerts: AlertRow[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(id: string, action: "ACK" | "RESOLVE") {
    setBusy(true);
    const res = await api("/api/v1/monitor/alerts", { method: "PATCH", body: { id, action } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Alert ${action === "ACK" ? "acknowledged" : "resolved"}` });
    onChanged();
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="max-h-[32rem] overflow-y-auto vortex-scroll">
          {alerts.length === 0 && (
            <p className="text-sm text-muted-foreground p-6 text-center">No alert events — everything healthy.</p>
          )}
          {alerts.map((a) => (
            <div key={a.id} className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {a.severity === "CRITICAL" ? (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                ) : a.severity === "WARNING" ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-sm min-w-0">{a.message}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px] text-muted-foreground">{a.source}</Badge>
                {a.status === "OPEN" && <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400">OPEN</Badge>}
                {a.status === "ACK" && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">ACK</Badge>}
                {a.status === "RESOLVED" && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">RESOLVED</Badge>}
                <span className="whitespace-nowrap">{fmtAgo(a.createdAt)}</span>
                {a.status !== "RESOLVED" && (
                  <>
                    {a.status === "OPEN" && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(a.id, "ACK")}>
                        <BellOff className="w-3.5 h-3.5 mr-1" /> Ack
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => patch(a.id, "RESOLVE")}>
                      Resolve
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- ADD TARGET ---------------- */

function AddMonitorDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("URL");
  const [target, setTarget] = useState("");
  const [intervalSec, setIntervalSec] = useState("60");

  const placeholder =
    targetType === "URL"
      ? "/api/v1/overview or https://…"
      : targetType === "NODE"
        ? "vortex-core-01"
        : targetType === "DATABASE"
          ? "nexseva-pg"
          : "auth";

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/monitor", {
      method: "POST",
      body: { name, targetType, target, intervalSec: parseInt(intervalSec) || 60 },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Monitor creation failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${name} is being monitored — first check done` });
    setOpen(false);
    setName("");
    setTarget("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> Add target
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Monitor a target</DialogTitle>
          <DialogDescription>
            URL targets get a live HTTP probe; nodes, databases and services derive real state from their registry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="mon-name">Name</Label>
            <Input id="mon-name" placeholder="e.g. FLAREX API" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="URL">URL probe</SelectItem>
                  <SelectItem value="NODE">Server node</SelectItem>
                  <SelectItem value="DATABASE">Database</SelectItem>
                  <SelectItem value="SERVICE">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Interval</Label>
              <Select value={intervalSec} onValueChange={setIntervalSec}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15s</SelectItem>
                  <SelectItem value="30">30s</SelectItem>
                  <SelectItem value="60">60s</SelectItem>
                  <SelectItem value="300">5 min</SelectItem>
                  <SelectItem value="600">10 min</SelectItem>
                  <SelectItem value="1800">30 min</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mon-target">Target</Label>
            <Input id="mon-target" placeholder={placeholder} value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !name || !target} onClick={create}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Add monitor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
