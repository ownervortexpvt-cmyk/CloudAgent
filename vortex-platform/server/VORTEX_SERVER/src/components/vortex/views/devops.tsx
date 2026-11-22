"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  GitBranch,
  Loader2,
  Plus,
  Play,
  Trash2,
  ScrollText,
  Lock,
  RefreshCw,
  GitCommitHorizontal,
  Rocket,
} from "lucide-react";
import {
  api,
  fmtAgo,
  fmtDate,
  type DevopsState,
  type PipelineRow,
  type PipelineRunRow,
  type StageLogRow,
  type SslCertRow,
} from "../client";

export default function DevopsView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">DEVOPS — CI/CD + SSL</h3>
        <p className="text-sm text-muted-foreground">
          Pipelines watch Gitea repos and walk build → test → deploy; a successful deploy stage ships a
          REAL deployment through the DEPLOY module. TLS certificates come from the internal CA with
          auto-renew — the whole chain stays inside VORTEX.
        </p>
      </div>

      <Tabs defaultValue="pipelines" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="pipelines" className="gap-2">
            <GitBranch className="w-4 h-4" /> Pipelines
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <GitCommitHorizontal className="w-4 h-4" /> Runs
          </TabsTrigger>
          <TabsTrigger value="ssl" className="gap-2">
            <Lock className="w-4 h-4" /> SSL certificates
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pipelines" className="mt-4">
          <PipelinesTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="ssl" className="mt-4">
          <SslTab onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- PIPELINES ---------------- */

function PipelinesTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["devops"],
    queryFn: () => api<DevopsState>("/api/v1/devops"),
    refetchInterval: 8_000,
  });
  const appsQ = useQuery({
    queryKey: ["apps-for-devops"],
    queryFn: () => api<{ apps: { id: string; appId: string; name: string }[] }>("/api/v1/apps"),
  });
  const data = q.data?.ok ? q.data.data : null;
  const apps = appsQ.data?.ok ? appsQ.data.data?.apps ?? [] : [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ appId: "", name: "", repo: "", branch: "main", trigger: "PUSH" });

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/devops/pipelines", { method: "POST", body: form });
    setBusy(false);
    if (res.ok) {
      toast({ title: "Pipeline created" });
      setOpen(false);
      setForm({ appId: "", name: "", repo: "", branch: "main", trigger: "PUSH" });
      reload();
    } else {
      toast({ title: "Could not create pipeline", description: res.error, variant: "destructive" });
    }
  }

  async function toggle(p: PipelineRow) {
    const res = await api("/api/v1/devops/pipelines", { method: "PATCH", body: { id: p.id, enabled: !p.enabled } });
    if (res.ok) reload();
    else toast({ title: "Toggle failed", description: res.error, variant: "destructive" });
  }

  async function remove(p: PipelineRow) {
    const res = await api(`/api/v1/devops/pipelines?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Pipeline removed" });
      reload();
    } else {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
    }
  }

  async function runNow(p: PipelineRow) {
    const res = await api<{ run: PipelineRunRow }>("/api/v1/devops/runs", { method: "POST", body: { pipelineId: p.pipelineId } });
    if (res.ok) {
      toast({ title: `Run ${res.data?.run.runId} started`, description: "build → test → deploy; watch the Runs tab" });
      reload();
    } else {
      toast({ title: "Run failed to start", description: res.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.stats.pipelinesActive} active · ${data.stats.runsSuccess24h} green / ${data.stats.runsFailed24h} red runs in 24h` : "…"}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New pipeline</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a CI/CD pipeline</DialogTitle>
              <DialogDescription>Stages are fixed at build → test → deploy for now; the deploy stage ships a real deployment.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>App</Label>
                <Select value={form.appId} onValueChange={(v) => setForm({ ...form, appId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select app" /></SelectTrigger>
                  <SelectContent>
                    {apps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.appId})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pipeline name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="nexseva-main" />
              </div>
              <div>
                <Label>Gitea repo</Label>
                <Input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="gitea.vortex.internal/vortex/nexseva" className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Branch</Label>
                  <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </div>
                <div>
                  <Label>Trigger</Label>
                  <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUSH">PUSH</SelectItem>
                      <SelectItem value="MANUAL">MANUAL</SelectItem>
                      <SelectItem value="WEBHOOK">WEBHOOK</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={busy || !form.appId || !form.name || !form.repo}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!data ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.pipelines.map((p) => (
            <Card key={p.id} className={!p.enabled ? "opacity-60" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{p.name}</p>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{p.app.name}</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{p.trigger}</Badge>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
                      {p.repo}#{p.branch}
                    </p>
                  </div>
                  <Switch checked={p.enabled} onCheckedChange={() => toggle(p)} />
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {p.stages.split(",").map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] border-primary/30 text-primary">{s.trim()}</Badge>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border/50 py-1.5">
                    <p className="text-sm font-semibold">{p.runCount}</p>
                    <p className="text-[10px] text-muted-foreground">runs</p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/25 py-1.5">
                    <p className="text-sm font-semibold text-emerald-400">{p.successCount}</p>
                    <p className="text-[10px] text-muted-foreground">green</p>
                  </div>
                  <div className="rounded-lg border border-red-500/25 py-1.5">
                    <p className="text-sm font-semibold text-red-400">{p.failCount}</p>
                    <p className="text-[10px] text-muted-foreground">red</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    last run: {p.lastRunAt ? `${fmtAgo(p.lastRunAt)} (${p.lastStatus || "?"})` : "never"}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => runNow(p)} disabled={!p.enabled}>
                      <Play className="w-3.5 h-3.5 mr-1" /> Run
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- RUNS ---------------- */

function RunsTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["devops"],
    queryFn: () => api<DevopsState>("/api/v1/devops"),
    refetchInterval: 4_000, // runs advance on read — poll fast while running
  });
  const data = q.data?.ok ? q.data.data : null;
  const [logFor, setLogFor] = useState<PipelineRunRow | null>(null);

  const running = data?.runs.filter((r) => ["QUEUED", "RUNNING"].includes(r.status)) ?? [];

  return (
    <div className="space-y-3">
      {running.length > 0 && (
        <Card className="border-sky-500/30">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
            <p className="text-sm">
              {running.map((r) => `${r.pipeline.name}: ${r.commitSha.slice(0, 7)} walking stages`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      )}

      {!data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="space-y-2">
          {data.runs.map((r) => {
            const stages: StageLogRow[] = safeStages(r.stagesLog);
            return (
              <Card key={r.id}>
                <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{r.pipeline.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${RUN_STATUS[r.status]}`}>{r.status}</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground font-mono">{r.commitSha.slice(0, 7)}</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{r.trigger}</Badge>
                      {r.deployId && (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                          <Rocket className="w-3 h-3 mr-1" />{r.deployId.slice(0, 11)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{r.commitMessage}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {stages.map((s) => (
                        <Badge key={s.stage} variant="outline" className={`text-[10px] ${STAGE_CLASS[s.status] || ""}`}>
                          {s.stage}: {s.status}
                        </Badge>
                      ))}
                      <span className="text-[11px] text-muted-foreground">
                        {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "in flight"} · {fmtAgo(r.createdAt)}
                      </span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setLogFor(r)}>
                    <ScrollText className="w-4 h-4 mr-1" /> Stages
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!logFor} onOpenChange={(o) => !o && setLogFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Run {logFor?.runId} — {logFor?.pipeline.name} @ {logFor?.commitSha.slice(0, 7)}
            </DialogTitle>
            <DialogDescription>Stage-by-stage CI trace (Woodpecker-style log).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-auto">
            {logFor && safeStages(logFor.stagesLog).map((s) => (
              <div key={s.stage} className="rounded-lg border border-border/60 overflow-hidden">
                <div className={`px-3 py-1.5 text-xs font-medium flex items-center gap-2 ${s.status === "OK" ? "bg-emerald-500/10 text-emerald-400" : s.status === "FAILED" ? "bg-red-500/10 text-red-400" : "bg-sky-500/10 text-sky-400"}`}>
                  {s.stage} — {s.status}{s.ms ? ` (${(s.ms / 1000).toFixed(1)}s)` : ""}
                </div>
                <pre className="bg-zinc-950 p-3 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap">{s.log || "(pending)"}</pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <span className="hidden" onClick={onChanged} />
    </div>
  );
}

const RUN_STATUS: Record<string, string> = {
  QUEUED: "border-zinc-500/40 text-zinc-400",
  RUNNING: "border-sky-500/40 text-sky-400",
  SUCCESS: "border-emerald-500/40 text-emerald-400",
  FAILED: "border-red-500/40 text-red-400",
};

const STAGE_CLASS: Record<string, string> = {
  PENDING: "border-zinc-500/40 text-zinc-400",
  RUNNING: "border-sky-500/40 text-sky-400",
  OK: "border-emerald-500/40 text-emerald-400",
  FAILED: "border-red-500/40 text-red-400",
};

function safeStages(json: string): StageLogRow[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------- SSL ---------------- */

function SslTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["devops"],
    queryFn: () => api<DevopsState>("/api/v1/devops"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ domain: "", issuer: "VORTEX_INTERNAL_CA", targetLabel: "" });

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function issue() {
    setBusy(true);
    const res = await api("/api/v1/devops/ssl", { method: "POST", body: form });
    setBusy(false);
    if (res.ok) {
      toast({ title: "Certificate issued (90 days)" });
      setOpen(false);
      setForm({ domain: "", issuer: "VORTEX_INTERNAL_CA", targetLabel: "" });
      reload();
    } else {
      toast({ title: "Issuance failed", description: res.error, variant: "destructive" });
    }
  }

  async function patch(cert: SslCertRow, body: Record<string, unknown>) {
    const res = await api("/api/v1/devops/ssl", { method: "PATCH", body: { id: cert.id, ...body } });
    if (res.ok) {
      toast({ title: body.renew ? `${cert.domain} renewed` : "Auto-renew updated" });
      reload();
    } else {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Internal CA keeps every domain inside VORTEX. Auto-renew fires at expiry — no surprises.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Lock className="w-4 h-4 mr-1" /> Issue certificate</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue a TLS certificate</DialogTitle>
              <DialogDescription>Valid 90 days from the VORTEX internal CA (Let&apos;s Encrypt supported from Phase 6).</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Domain</Label>
                <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="admin.vortex.internal or *.apps.vortex.internal" className="font-mono text-xs" />
              </div>
              <div>
                <Label>Issuer</Label>
                <Select value={form.issuer} onValueChange={(v) => setForm({ ...form, issuer: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VORTEX_INTERNAL_CA">VORTEX_INTERNAL_CA</SelectItem>
                    <SelectItem value="LETS_ENCRYPT">LETS_ENCRYPT (Phase 6)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>What it protects</Label>
                <Input value={form.targetLabel} onChange={(e) => setForm({ ...form, targetLabel: e.target.value })} placeholder="Admin panel + control plane" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={issue} disabled={busy || !form.domain}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />} Issue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!data ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="space-y-2">
          {data.certs.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono font-medium text-sm">{c.domain}</p>
                    <Badge variant="outline" className={`text-[10px] ${CERT_CLASS[c.status] || ""}`}>{c.status}</Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">{c.issuer}</Badge>
                    {(c.daysLeft ?? 999) <= 14 && c.status !== "EXPIRED" && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">{c.daysLeft}d left</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.targetLabel || "—"} · expires {fmtDate(c.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    auto-renew
                    <Switch checked={c.autoRenew} onCheckedChange={(v) => patch(c, { autoRenew: v })} />
                  </label>
                  <Button variant="outline" size="sm" onClick={() => patch(c, { renew: true })}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Renew
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const CERT_CLASS: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-400",
  EXPIRING: "border-amber-500/40 text-amber-400",
  EXPIRED: "border-red-500/40 text-red-400",
  REVOKED: "border-zinc-500/40 text-zinc-400",
};
