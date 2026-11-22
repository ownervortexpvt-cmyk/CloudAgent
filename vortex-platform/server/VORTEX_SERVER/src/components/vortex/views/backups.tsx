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
  ArchiveRestore,
  Database as DatabaseIcon,
  HardDrive,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Clock,
} from "lucide-react";
import {
  api,
  fmtAgo,
  fmtDate,
  fmtIn,
  fmtSize,
  type DatabaseRow,
  type PolicyRow,
  type ServerNodeRow,
  type SnapshotRow,
} from "../client";

const SNAP_STATUS: Record<string, string> = {
  COMPLETED: "border-emerald-500/40 text-emerald-400",
  RUNNING: "border-sky-500/40 text-sky-400",
  EXPIRED: "border-zinc-500/40 text-zinc-500",
  FAILED: "border-red-500/40 text-red-400",
};

export default function BackupsView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Backups</h3>
        <p className="text-sm text-muted-foreground">
          BACKUP module — every snapshot is encrypted (age-x25519) and replicated across the 3-tier permanent storage
          design: local disk → cluster storage → offsite. Policies run on schedule with retention pruning; restore is
          one click.
        </p>
      </div>

      <Tabs defaultValue="snapshots" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="snapshots" className="gap-2">
            <ArchiveRestore className="w-4 h-4" /> Snapshots
          </TabsTrigger>
          <TabsTrigger value="policies" className="gap-2">
            <Clock className="w-4 h-4" /> Policies
          </TabsTrigger>
        </TabsList>
        <TabsContent value="snapshots" className="mt-4">
          <SnapshotsTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="policies" className="mt-4">
          <PoliciesTab onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- SNAPSHOTS ---------------- */

function SnapshotsTab({ onChanged }: { onChanged: () => void }) {
  const snapsQuery = useQuery({
    queryKey: ["backups"],
    queryFn: () =>
      api<{ snapshots: SnapshotRow[]; stats: { total: number; completed: number; sizeMb: number; lastBackupAt: string | null; policyCount: number } }>(
        "/api/v1/backups"
      ),
    refetchInterval: 15_000,
  });
  const data = snapsQuery.data?.ok ? snapsQuery.data.data ?? null : null;
  const snaps = data?.snapshots ?? null;

  const reload = () => {
    snapsQuery.refetch();
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Snapshots" value={data ? `${data.stats.completed}` : "…"} hint="completed" />
        <StatTile label="Vault size" value={data ? fmtSize(data.stats.sizeMb) : "…"} hint="encrypted at rest" />
        <StatTile label="Last backup" value={data?.stats.lastBackupAt ? fmtAgo(data.stats.lastBackupAt) : "—"} hint={data?.stats.lastBackupAt ? fmtDate(data.stats.lastBackupAt) : "no snapshot yet"} />
        <StatTile label="Policies" value={data ? `${data.stats.policyCount}` : "…"} hint="scheduled" />
      </div>

      <div className="flex justify-end">
        <SnapshotNowDialog onCreated={reload} />
      </div>

      {!snaps && <Skeleton className="h-72 rounded-xl" />}

      {snaps && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[30rem] overflow-y-auto vortex-scroll">
              {snaps.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No snapshots yet — take one or add a policy.</p>
              )}
              {snaps.map((s) => (
                <SnapRow key={s.id} snap={s} onChanged={reload} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] text-muted-foreground tracking-wide uppercase">{label}</p>
        <p className="text-lg font-bold mt-1">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TierChip({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${on ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}>
      {on ? "✓" : "~"} {label}
    </Badge>
  );
}

function SnapRow({ snap, onChanged }: { snap: SnapshotRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    const res = await api("/api/v1/backups", { method: "PATCH", body: { id: snap.backupId, action: "RESTORE" } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Restore failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Restored ${snap.targetLabel} from ${snap.backupId}`, description: "Confirmation mail sent to the outbox." });
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const res = await api(`/api/v1/backups?id=${encodeURIComponent(snap.backupId)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${snap.backupId} removed from vault` });
    onChanged();
  }

  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <code className="font-mono text-xs text-primary">{snap.backupId}</code>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {snap.trigger === "POLICY" ? "scheduled" : "manual"}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${SNAP_STATUS[snap.status] || ""}`}>
          {snap.status}
        </Badge>
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span className="text-foreground">{snap.targetLabel}</span>
        <span className="opacity-70"> · {snap.targetType} · {fmtSize(snap.sizeMb)} · {fmtDate(snap.createdAt)}</span>
        {snap.restoredAt && <span className="block text-emerald-400">restored {fmtAgo(snap.restoredAt)}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0 flex-wrap">
        <TierChip on={snap.tierDisk} label="disk" />
        <TierChip on={snap.tierCluster} label="cluster" />
        <TierChip on={snap.tierOffsite} label="offsite" />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {snap.status === "COMPLETED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={restore}>
            <RotateCcw className="w-3 h-3 mr-1" /> Restore
          </Button>
        )}
        {["EXPIRED", "FAILED"].includes(snap.status) && (
          <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={remove}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function SnapshotNowDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetType, setTargetType] = useState("DATABASE");
  const [targetId, setTargetId] = useState("");

  const dbsQuery = useQuery({
    queryKey: ["databases"],
    queryFn: () => api<{ databases: DatabaseRow[] }>("/api/v1/databases"),
  });
  const nodesQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ nodes: ServerNodeRow[] }>("/api/v1/servers"),
  });

  const dbs = (dbsQuery.data?.ok ? dbsQuery.data.data?.databases ?? [] : []).filter((d) => d.status !== "DESTROYED");
  const nodes = (nodesQuery.data?.ok ? nodesQuery.data.data?.nodes ?? [] : []).filter((n) => n.status !== "DESTROYED");

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/backups", { method: "POST", body: { targetType, targetId } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Snapshot failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Snapshot created — encrypted, replicated to tier 1+2" });
    setOpen(false);
    setTargetId("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> Snapshot now
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take a manual snapshot</DialogTitle>
          <DialogDescription>Encrypted with age-x25519, replicated to disk + cluster immediately; offsite syncs async.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Target type</Label>
            <Select
              value={targetType}
              onValueChange={(v) => {
                setTargetType(v);
                setTargetId("");
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DATABASE"><DatabaseIcon className="w-3.5 h-3.5 inline mr-1" />Database</SelectItem>
                <SelectItem value="SERVER"><Server className="w-3.5 h-3.5 inline mr-1" />Server node</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger>
              <SelectContent>
                {targetType === "DATABASE"
                  ? dbs.map((d) => <SelectItem key={d.dbId} value={d.dbId}>{d.name} ({d.engine})</SelectItem>)
                  : nodes.map((n) => <SelectItem key={n.nodeId} value={n.nodeId}>{n.name} ({n.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !targetId} onClick={create}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- POLICIES ---------------- */

function PoliciesTab({ onChanged }: { onChanged: () => void }) {
  const policiesQuery = useQuery({
    queryKey: ["backup-policies"],
    queryFn: () => api<{ policies: PolicyRow[] }>("/api/v1/backups/policies"),
    refetchInterval: 15_000,
  });
  const policies = policiesQuery.data?.ok ? policiesQuery.data.data?.policies ?? null : null;

  const reload = () => {
    policiesQuery.refetch();
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddPolicyDialog onCreated={reload} />
      </div>

      {!policies && <Skeleton className="h-56 rounded-xl" />}

      {policies && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[26rem] overflow-y-auto vortex-scroll">
              {policies.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No policies — add one to automate backups.</p>
              )}
              {policies.map((p) => (
                <PolicyRow key={p.id} policy={p} onChanged={reload} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PolicyRow({ policy, onChanged }: { policy: PolicyRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const res = await api("/api/v1/backups/policies", { method: "PATCH", body: { id: policy.policyId, ...body } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: okMsg });
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const res = await api(`/api/v1/backups/policies?id=${encodeURIComponent(policy.policyId)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${policy.name} deleted (snapshots kept)` });
    onChanged();
  }

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm truncate">{policy.name}</span>
        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">{policy.schedule}</Badge>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
          <ShieldCheck className="w-3 h-3 mr-1" /> encrypted
        </Badge>
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span className="text-foreground">{policy.targetLabel}</span>
        <span className="opacity-70"> · {policy.targetType} · keep {policy.retentionCount} · {policy.runCount} runs</span>
        <span className="block">
          last {fmtAgo(policy.lastRunAt)} · next <span className="text-foreground">{fmtIn(policy.nextRunAt)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={policy.enabled}
          disabled={busy}
          onCheckedChange={(v) => patch({ enabled: v }, v ? `${policy.name} enabled` : `${policy.name} paused`)}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ action: "RUN" }, "Policy ran — snapshot created")}>
          <Play className="w-3 h-3 mr-1" /> Run
        </Button>
        <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={remove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddPolicyDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("DATABASE");
  const [targetId, setTargetId] = useState("");
  const [schedule, setSchedule] = useState("DAILY");
  const [retention, setRetention] = useState("7");

  const dbsQuery = useQuery({
    queryKey: ["databases"],
    queryFn: () => api<{ databases: DatabaseRow[] }>("/api/v1/databases"),
    enabled: open,
  });
  const nodesQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ nodes: ServerNodeRow[] }>("/api/v1/servers"),
    enabled: open,
  });

  const dbs = (dbsQuery.data?.ok ? dbsQuery.data.data?.databases ?? [] : []).filter((d) => d.status !== "DESTROYED");
  const nodes = (nodesQuery.data?.ok ? nodesQuery.data.data?.nodes ?? [] : []).filter((n) => n.status !== "DESTROYED");

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/backups/policies", {
      method: "POST",
      body: { name, targetType, targetId, schedule, retentionCount: parseInt(retention) || 7 },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Policy creation failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Policy "${name}" created` });
    setOpen(false);
    setName("");
    setTargetId("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> New policy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backup policy</DialogTitle>
          <DialogDescription>Runs on schedule, keeps the latest N snapshots (older ones expire automatically).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pol-name">Policy name</Label>
            <Input id="pol-name" placeholder="e.g. nexseva-pg — daily" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target type</Label>
              <Select
                value={targetType}
                onValueChange={(v) => {
                  setTargetType(v);
                  setTargetId("");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DATABASE"><HardDrive className="w-3.5 h-3.5 inline mr-1" />Database</SelectItem>
                  <SelectItem value="SERVER"><Server className="w-3.5 h-3.5 inline mr-1" />Server node</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger>
                <SelectContent>
                  {targetType === "DATABASE"
                    ? dbs.map((d) => <SelectItem key={d.dbId} value={d.dbId}>{d.name}</SelectItem>)
                    : nodes.map((n) => <SelectItem key={n.nodeId} value={n.nodeId}>{n.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Schedule</Label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-retention">Keep latest</Label>
              <Input id="pol-retention" type="number" min="1" max="100" value={retention} onChange={(e) => setRetention(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !name || !targetId} onClick={create}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
