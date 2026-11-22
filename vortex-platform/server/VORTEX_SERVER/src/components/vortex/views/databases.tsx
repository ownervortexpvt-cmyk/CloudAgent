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
  HardDrive,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  Copy,
  KeyRound,
  Globe,
} from "lucide-react";
import { api, fmtSize, type AppRow, type DatabaseRow } from "../client";

const DB_STATUS: Record<string, string> = {
  PROVISIONING: "border-sky-500/40 text-sky-400",
  RUNNING: "border-emerald-500/40 text-emerald-400",
  STOPPED: "border-amber-500/40 text-amber-400",
  ERROR: "border-red-500/40 text-red-400",
  DESTROYED: "border-zinc-500/40 text-zinc-400",
};

const ENGINES: Record<string, { label: string; versions: string[]; port: number }> = {
  POSTGRES: { label: "PostgreSQL", versions: ["16.4", "15.8"], port: 5432 },
  MYSQL: { label: "MySQL", versions: ["8.4", "8.0"], port: 3306 },
  REDIS: { label: "Redis", versions: ["7.4", "7.2"], port: 6379 },
  MONGO: { label: "MongoDB", versions: ["7.0", "6.0"], port: 27017 },
};

type Credentials = {
  username: string;
  password: string;
  host: string;
  port: number;
  dns: string | null;
  engine: string;
};

export default function DatabasesView({ onChanged }: { onChanged: () => void }) {
  const dbsQuery = useQuery({
    queryKey: ["databases"],
    queryFn: () => api<{ databases: DatabaseRow[] }>("/api/v1/databases"),
    refetchInterval: 10_000,
  });
  const dbs = dbsQuery.data?.ok ? dbsQuery.data.data?.databases ?? null : null;

  const running = dbs?.filter((d) => d.status === "RUNNING").length ?? 0;
  const sizeMb = dbs?.filter((d) => d.status !== "DESTROYED").reduce((a, d) => a + d.sizeMb, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Databases</h3>
          <p className="text-sm text-muted-foreground">
            DATABASE module — per-app SQL/NoSQL provisioning. Every instance is app-bound (data gravity), gets an IP +
            DNS record from NETWORK, and one-time credentials shown only once.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
            {running}/{dbs?.length ?? 0} running
          </Badge>
          <Badge variant="outline" className="border-violet-500/40 text-violet-300">
            <HardDrive className="w-3 h-3 mr-1" /> {fmtSize(sizeMb)} provisioned
          </Badge>
          <AddDbDialog onCreated={() => { dbsQuery.refetch(); onChanged(); }} />
        </div>
      </div>

      {!dbs && <Skeleton className="h-72 rounded-xl" />}

      {dbs && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[34rem] overflow-y-auto vortex-scroll">
              {dbs.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No databases yet — provision the first one.</p>
              )}
              {dbs.map((d) => (
                <DbRow key={d.id} db={d} onChanged={() => { dbsQuery.refetch(); onChanged(); }} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DbRow({ db, onChanged }: { db: DatabaseRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function patch(status: string) {
    setBusy(true);
    const res = await api("/api/v1/databases", { method: "PATCH", body: { id: db.id, status } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${db.name} → ${status.toLowerCase()}` });
    onChanged();
  }

  async function purge() {
    setBusy(true);
    const res = await api(`/api/v1/databases?id=${encodeURIComponent(db.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Purge failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${db.name} purged from registry` });
    onChanged();
  }

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <code className="font-mono text-sm text-foreground">{db.name}</code>
        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
          {ENGINES[db.engine]?.label || db.engine} {db.version}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${DB_STATUS[db.status] || ""}`}>
          {db.status === "PROVISIONING" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {db.status}
        </Badge>
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 lg:block lg:space-y-0.5">
        <span className="block truncate">
          app: <span className="text-foreground">{db.app?.name || "—"}</span> · {fmtSize(db.sizeMb)}
        </span>
        <span className="block truncate">
          {db.host} · {db.ipAddress || "no ip"} · :{db.port}
        </span>
        {db.dnsName && (
          <span className="block truncate lg:col-span-2">
            <Globe className="w-3 h-3 inline mr-1" />
            <code className="font-mono">{db.dnsName}</code>
          </span>
        )}
        <span className="block truncate">
          user <code className="font-mono text-foreground/80">{db.username}</code>
          {db.secretPrefix && <span className="ml-1 opacity-70">({db.secretPrefix}… stored hashed)</span>}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {db.status === "RUNNING" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => patch("STOPPED")}>
            <Square className="w-3 h-3 mr-1" /> Stop
          </Button>
        )}
        {db.status === "STOPPED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => patch("RUNNING")}>
            <Play className="w-3 h-3 mr-1" /> Start
          </Button>
        )}
        {db.status !== "DESTROYED" && (
          <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={() => setConfirming(true)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
        {db.status === "DESTROYED" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={purge}>
            <Trash2 className="w-3 h-3 mr-1" /> Purge
          </Button>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={(v) => !v && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy {db.name}?</DialogTitle>
            <DialogDescription>
              {db.engine} {db.version} · owned by {db.app?.name || "unknown app"}. Data on this instance becomes
              unreachable (snapshots in BACKUP keep history). IP + DNS record are released.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setConfirming(false);
                await patch("DESTROYED");
              }}
            >
              Destroy database
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddDbDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState("POSTGRES");
  const [version, setVersion] = useState("16.4");
  const [sizeGb, setSizeGb] = useState("10");
  const [appId, setAppId] = useState("");
  const [creds, setCreds] = useState<Credentials | null>(null);

  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
  });
  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? [] : [];
  const activeApps = apps.filter((a) => a.status === "ACTIVE");

  function reset() {
    setName("");
    setEngine("POSTGRES");
    setVersion("16.4");
    setSizeGb("10");
    setAppId("");
  }

  async function create() {
    setBusy(true);
    const res = await api<{ instance: DatabaseRow; credentials: Credentials }>("/api/v1/databases", {
      method: "POST",
      body: { name, engine, version, sizeGb: parseFloat(sizeGb) || 10, appId: appId || undefined },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Provisioning failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${name} is provisioning — IP + DNS record auto-assigned` });
    setCreds(res.data?.credentials || null);
    setOpen(false);
    reset();
    onCreated();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" /> Provision database
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provision a database instance</DialogTitle>
            <DialogDescription>
              SQL first (PostgreSQL), then NoSQL. Bound to an app, hosted on vortex-db-01, auto IP + DNS.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="db-name">Instance name</Label>
              <Input id="db-name" placeholder="e.g. billing-pg" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Engine</Label>
                <Select
                  value={engine}
                  onValueChange={(v) => {
                    setEngine(v);
                    setVersion(ENGINES[v]?.versions[0] || "16.4");
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENGINES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Version</Label>
                <Select value={version} onValueChange={setVersion}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(ENGINES[engine]?.versions || []).map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="db-size">Size (GB)</Label>
                <Input id="db-size" type="number" min="0.5" max="4096" step="0.5" value={sizeGb} onChange={(e) => setSizeGb(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner app</Label>
                <Select value={appId} onValueChange={setAppId}>
                  <SelectTrigger><SelectValue placeholder="Select app" /></SelectTrigger>
                  <SelectContent>
                    {activeApps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !name || !appId} onClick={create}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Provision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time credentials */}
      <Dialog open={!!creds} onOpenChange={(v) => !v && setCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-400" /> Database credentials — shown once
            </DialogTitle>
            <DialogDescription>
              The password is stored only as a sha256 hash. Copy it now — it cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          {creds && (
            <div className="space-y-2 text-sm">
              {[
                ["Engine", `${creds.engine} :${creds.port}`],
                ["Host (IP)", creds.host],
                ["DNS", creds.dns || "—"],
                ["Username", creds.username],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                  <span className="text-muted-foreground text-xs">{k}</span>
                  <code className="font-mono text-xs truncate">{v}</code>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <span className="text-muted-foreground text-xs">Password</span>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-xs text-amber-300 truncate">{creds.password}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(creds.password);
                      toast({ title: "Password copied" });
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreds(null)}>I saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
