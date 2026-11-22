"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  Rocket,
  Loader2,
  Undo2,
  Square,
  ScrollText,
  HeartPulse,
  Boxes,
} from "lucide-react";
import { api, fmtAgo, fmtDate, type DeploymentRow } from "../client";

const STATUS_CLASS: Record<string, string> = {
  QUEUED: "border-zinc-500/40 text-zinc-400",
  BUILDING: "border-sky-500/40 text-sky-400",
  DEPLOYING: "border-indigo-500/40 text-indigo-400",
  RUNNING: "border-emerald-500/40 text-emerald-400",
  FAILED: "border-red-500/40 text-red-400",
  ROLLED_BACK: "border-amber-500/40 text-amber-400",
  STOPPED: "border-zinc-500/40 text-zinc-400",
};

type DeployPayload = {
  deployments: DeploymentRow[];
  nodes: { nodeId: string; name: string; role: string }[];
  apps: { id: string; appId: string; name: string; slug: string }[];
  sources: string[];
};

export default function DeploysView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">DEPLOY — app delivery pipeline</h3>
        <p className="text-sm text-muted-foreground">
          Builds from NEXA (the AI builder), GIT or MANUAL uploads ship onto APP_RUNTIME nodes.
          Every deployment is app-bound (data gravity), gets a health monitor on success, and rolls
          back with one click — history is never lost.
        </p>
      </div>
      <DeploysTable onChanged={onChanged} />
    </div>
  );
}

function DeploysTable({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["deploys"],
    queryFn: () => api<DeployPayload>("/api/v1/deploys"),
    refetchInterval: 5_000, // deployments advance on read — poll faster while building
  });
  const data = q.data?.ok ? q.data.data : null;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logFor, setLogFor] = useState<DeploymentRow | null>(null);
  const [form, setForm] = useState({ appId: "", version: "", source: "NEXA_BUILDER", nodeId: "" });

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function deploy() {
    setBusy(true);
    const res = await api("/api/v1/deploys", {
      method: "POST",
      body: { ...form, appId: form.appId || data?.apps[0]?.id, nodeId: form.nodeId || undefined },
    });
    setBusy(false);
    if (res.ok) {
      toast({ title: "Deployment queued", description: "Build → ship → live takes a few seconds; the list refreshes itself." });
      setOpen(false);
      setForm({ appId: "", version: "", source: "NEXA_BUILDER", nodeId: "" });
      reload();
    } else {
      toast({ title: "Deploy failed", description: res.error, variant: "destructive" });
    }
  }

  async function action(deployId: string, act: "ROLLBACK" | "STOP") {
    const res = await api("/api/v1/deploys", { method: "PATCH", body: { deployId, action: act } });
    if (res.ok) {
      toast({ title: act === "ROLLBACK" ? "Rollback queued — previous version re-shipping" : "Deployment stopped" });
      reload();
    } else {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    }
  }

  const inflight = data?.deployments.filter((d) => ["QUEUED", "BUILDING", "DEPLOYING"].includes(d.status)) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data
            ? `${data.deployments.filter((d) => d.status === "RUNNING").length} running · ${inflight.length} in flight · latest ${data.deployments[0] ? `v${data.deployments[0].version} ${fmtAgo(data.deployments[0].createdAt)}` : "—"}`
            : "…"}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Rocket className="w-4 h-4 mr-1" /> New deployment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ship a build</DialogTitle>
              <DialogDescription>
                QUEUED → BUILDING → DEPLOYING → RUNNING. The artifact lands in STORAGE (3x replicas)
                and a health monitor is attached automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>App</Label>
                <Select value={form.appId || data?.apps[0]?.id} onValueChange={(v) => setForm({ ...form, appId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select app" /></SelectTrigger>
                  <SelectContent>
                    {data?.apps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.appId})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Source</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {data?.sources.map((s) => (
                        <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Version</Label>
                  <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="auto (build number)" />
                </div>
              </div>
              <div>
                <Label>Target node</Label>
                <Select value={form.nodeId || "auto"} onValueChange={(v) => setForm({ ...form, nodeId: v === "auto" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto — first APP_RUNTIME node</SelectItem>
                    {data?.nodes.map((n) => (
                      <SelectItem key={n.nodeId} value={n.nodeId}>{n.name} ({n.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={deploy} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />} Ship it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {inflight.length > 0 && (
        <Card className="border-sky-500/30">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {inflight.map((d) => `${d.app.name} v${d.version}: ${d.status.toLowerCase()}`).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">stages advance as the list refreshes — log lines appear in real time</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="space-y-2">
          {data.deployments.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-sm">{d.app.name}</p>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_CLASS[d.status] || ""}`}>{d.status}</Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">v{d.version} · build #{d.buildNumber}</Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">{d.source.replace("_", " ")}</Badge>
                    {d.status === "RUNNING" && (
                      <Badge variant="outline" className={`text-[10px] ${d.health === "HEALTHY" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}>
                        <HeartPulse className="w-3 h-3 mr-1" />{d.health}
                      </Badge>
                    )}
                    {d.rollbackOf && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
                        <Undo2 className="w-3 h-3 mr-1" />rollback
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {d.node?.name || "no node"} · {d.url || "—"}{d.artifactKb ? ` · artifact ${d.artifactKb} KB` : ""}
                    {d.gitSha ? ` · ${d.gitSha.slice(0, 7)}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    created {fmtDate(d.createdAt)}{d.finishedAt ? ` · finished ${fmtAgo(d.finishedAt)}` : ` · ${fmtAgo(d.createdAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setLogFor(d)}>
                    <ScrollText className="w-4 h-4 mr-1" /> Log
                  </Button>
                  {d.status === "RUNNING" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => action(d.deployId, "ROLLBACK")}>
                        <Undo2 className="w-4 h-4 mr-1" /> Rollback
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Stop deployment" onClick={() => action(d.deployId, "STOP")}>
                        <Square className="w-4 h-4 text-red-400" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!logFor} onOpenChange={(o) => !o && setLogFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Deploy log — {logFor?.app.name} v{logFor?.version}</DialogTitle>
            <DialogDescription>Build + ship trace; the artifact lives in the app&apos;s storage bucket.</DialogDescription>
          </DialogHeader>
          <pre className="rounded-lg bg-zinc-950 border border-border/60 p-4 text-[11px] leading-relaxed overflow-auto max-h-80 font-mono text-emerald-300 whitespace-pre-wrap">
            {logFor?.log || "(no log)"}
          </pre>
          <p className="text-xs text-muted-foreground font-mono break-all">
            artifact: {logFor?.artifactPath || "—"} · via {logFor?.deployedBy || "system"}
          </p>
        </DialogContent>
      </Dialog>

      {data && data.deployments.length === 0 && (
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
            <Boxes className="w-5 h-5 text-primary shrink-0" />
            Nothing deployed yet — ship the first build of an app.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
