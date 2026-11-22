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
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Plus,
  Trash2,
  Radar,
  Ban,
  Siren,
  ScrollText,
} from "lucide-react";
import { api, fmtAgo, fmtDate, type SecurityState, type WafRuleRow } from "../client";

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: "border-red-500/40 text-red-400",
  WARNING: "border-amber-500/40 text-amber-400",
  INFO: "border-sky-500/40 text-sky-400",
};

export default function SecurityView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">SECURITY — central threat detection</h3>
        <p className="text-sm text-muted-foreground">
          The shield in front of the gateway edge (the one door): an IP blocklist, WAF regex rules over
          path / query / body / user-agent / headers, and a DDoS shield that auto-blocks IPs hammering
          the rate limits. Every decision lands in the event feed — nothing is silent.
        </p>
      </div>

      <Tabs defaultValue="policy" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="policy" className="gap-2">
            <ShieldCheck className="w-4 h-4" /> Policy
          </TabsTrigger>
          <TabsTrigger value="waf" className="gap-2">
            <Siren className="w-4 h-4" /> WAF rules
          </TabsTrigger>
          <TabsTrigger value="blocks" className="gap-2">
            <Ban className="w-4 h-4" /> IP blocklist
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-2">
            <ScrollText className="w-4 h-4" /> Event feed
          </TabsTrigger>
        </TabsList>
        <TabsContent value="policy" className="mt-4">
          <PolicyTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="waf" className="mt-4">
          <WafTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="blocks" className="mt-4">
          <BlocksTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- POLICY ---------------- */

function PolicyTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["security"],
    queryFn: () => api<SecurityState>("/api/v1/security"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ blocked: boolean; reason: string | null; matchedRule: string | null; sourceIp: string } | null>(null);

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function patch(fields: Record<string, unknown>) {
    const res = await api("/api/v1/security", { method: "PATCH", body: fields });
    if (res.ok) {
      toast({ title: "Policy updated" });
      reload();
    } else {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
    }
  }

  async function runProbe() {
    setProbing(true);
    setProbeResult(null);
    const res = await api<{ probe: { blocked: boolean; reason: string | null; matchedRule: string | null; sourceIp: string } }>("/api/v1/security", {
      method: "POST",
      body: { op: "probe" },
    });
    setProbing(false);
    if (res.ok && res.data) {
      setProbeResult(res.data.probe);
      toast({ title: res.data.probe.blocked ? "Probe blocked by WAF" : "Probe was NOT blocked", variant: res.data.probe.blocked ? "default" : "destructive" });
      reload();
    } else {
      toast({ title: "Probe failed", description: res.error, variant: "destructive" });
    }
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  const p = data.policy;
  const observe = p.blockMode === "LOG_ONLY";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Events (24h)" value={data.stats.events24h} icon={Radar} danger={data.stats.events24h > 50} />
        <StatCard label="WAF blocks (24h)" value={data.stats.wafBlocked24h} icon={ShieldAlert} danger={data.stats.wafBlocked24h > 20} />
        <StatCard label="Blocked IPs" value={data.stats.activeBlocks} icon={Ban} />
        <StatCard label="WAF rules armed" value={data.rules.filter((r) => r.enabled).length} icon={ShieldCheck} />
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="font-medium text-sm">Edge policy</h4>
              <p className="text-xs text-muted-foreground">Applies to every request hitting /api/gw before auth.</p>
            </div>
            <Badge variant="outline" className={observe ? "border-amber-500/40 text-amber-400" : "border-emerald-500/40 text-emerald-400"}>
              {observe ? "OBSERVE (LOG_ONLY)" : "ENFORCING (BLOCK)"}
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleRow
              label="WAF inspection"
              hint="Regex rules over path, query, body, user-agent and headers"
              checked={p.wafEnabled}
              disabled={false}
              onChange={(v) => patch({ wafEnabled: v })}
            />
            <ToggleRow
              label="IP blocklist"
              hint="Manual + auto blocks reject instantly at the edge"
              checked={p.ipBlockEnabled}
              disabled={false}
              onChange={(v) => patch({ ipBlockEnabled: v })}
            />
            <ToggleRow
              label="DDoS shield"
              hint={`Auto-block after ${p.ddosThreshold} rate-limit hits in 5 min`}
              checked={p.ddosEnabled}
              disabled={false}
              onChange={(v) => patch({ ddosEnabled: v })}
            />
            <div className="rounded-lg border border-border/60 p-3">
              <Label className="text-xs text-muted-foreground">Threshold (hits / 5 min)</Label>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  type="number"
                  defaultValue={p.ddosThreshold}
                  min={5}
                  max={1000}
                  className="h-8 w-24"
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v !== p.ddosThreshold) patch({ ddosThreshold: v });
                  }}
                />
                <span className="text-xs text-muted-foreground">then the IP is blocked for 1h</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Enforcement mode</p>
              <p className="text-xs text-muted-foreground">
                LOG_ONLY = observe mode: WAF hits and blocklist matches are recorded but never rejected.
              </p>
            </div>
            <Select value={p.blockMode} onValueChange={(v) => patch({ blockMode: v })}>
              <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOCK">BLOCK (enforce)</SelectItem>
                <SelectItem value="LOG_ONLY">LOG_ONLY (observe)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Live self-test</p>
              <p className="text-xs text-muted-foreground">
                Fires a synthetic attack (path traversal + SQLi query + sqlmap UA) through the real edge pipeline.
              </p>
            </div>
            <Button size="sm" onClick={runProbe} disabled={probing}>
              {probing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
              Fire probe
            </Button>
          </div>
          {probeResult && (
            <div className={`rounded-lg border p-3 text-xs ${probeResult.blocked ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
              <p className="font-medium">
                Probe from {probeResult.sourceIp}: {probeResult.blocked ? "BLOCKED" : "PASSED THROUGH"}
              </p>
              <p className="text-muted-foreground mt-1">
                {probeResult.matchedRule ? `Matched rule: ${probeResult.matchedRule}. ` : ""}
                {probeResult.reason || "No enabled BLOCK rule matched."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, danger }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <Icon className={`w-4 h-4 ${danger ? "text-red-400" : "text-primary"}`} />
        </div>
        <p className="text-2xl font-bold mt-1.5">{value}</p>
      </CardContent>
    </Card>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/* ---------------- WAF RULES ---------------- */

function WafTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["security"],
    queryFn: () => api<SecurityState>("/api/v1/security"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", pattern: "", matchIn: "QUERY", action: "BLOCK", severity: "WARNING", headerName: "" });

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/security/waf", { method: "POST", body: form });
    setBusy(false);
    if (res.ok) {
      toast({ title: "Rule armed" });
      setOpen(false);
      setForm({ name: "", pattern: "", matchIn: "QUERY", action: "BLOCK", severity: "WARNING", headerName: "" });
      reload();
    } else {
      toast({ title: "Could not create rule", description: res.error, variant: "destructive" });
    }
  }

  async function toggle(rule: WafRuleRow) {
    const res = await api("/api/v1/security/waf", { method: "PATCH", body: { id: rule.id, enabled: !rule.enabled } });
    if (res.ok) reload();
    else toast({ title: "Toggle failed", description: res.error, variant: "destructive" });
  }

  async function remove(rule: WafRuleRow) {
    const res = await api(`/api/v1/security/waf?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Rule removed" });
      reload();
    } else {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Case-insensitive regex rules. System rules form the protected baseline — they can be paused, not deleted.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New rule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Arm a WAF rule</DialogTitle>
              <DialogDescription>The pattern is tested case-insensitively against the selected request facet.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Rule name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Block credential stuffing" />
              </div>
              <div>
                <Label>Pattern (regex)</Label>
                <Input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} placeholder={`login\\?user=.*&pass=`} className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Match in</Label>
                  <Select value={form.matchIn} onValueChange={(v) => setForm({ ...form, matchIn: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PATH">PATH</SelectItem>
                      <SelectItem value="QUERY">QUERY</SelectItem>
                      <SelectItem value="BODY">BODY</SelectItem>
                      <SelectItem value="USER_AGENT">USER_AGENT</SelectItem>
                      <SelectItem value="HEADER">HEADER</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.matchIn === "HEADER" && (
                  <div>
                    <Label>Header name</Label>
                    <Input value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} placeholder="x-forwarded-for" />
                  </div>
                )}
                <div>
                  <Label>Action</Label>
                  <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BLOCK">BLOCK</SelectItem>
                      <SelectItem value="LOG">LOG (observe)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                    <SelectItem value="WARNING">WARNING</SelectItem>
                    <SelectItem value="INFO">INFO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={busy || !form.name || !form.pattern}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Arm rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!data ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <div className="space-y-2">
          {data.rules.map((r) => (
            <Card key={r.id} className={!r.enabled ? "opacity-60" : ""}>
              <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-sm">{r.name}</p>
                    {r.isSystem && <Badge variant="outline" className="text-[10px] text-muted-foreground">SYSTEM</Badge>}
                    <Badge variant="outline" className={`text-[10px] ${SEVERITY_CLASS[r.severity]}`}>{r.severity}</Badge>
                    <Badge variant="outline" className={`text-[10px] ${r.action === "BLOCK" ? "border-red-500/40 text-red-400" : "border-sky-500/40 text-sky-400"}`}>
                      {r.action}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">{r.matchIn}{r.headerName ? `:${r.headerName}` : ""}</Badge>
                  </div>
                  <p className="font-mono text-xs text-primary mt-1 truncate">/{r.pattern}/i</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{r.hitCount} hits · armed {fmtAgo(r.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} />
                  {!r.isSystem && (
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- IP BLOCKS ---------------- */

function BlocksTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["security"],
    queryFn: () => api<SecurityState>("/api/v1/security"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ip: "", reason: "", hours: "0" });

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function block() {
    setBusy(true);
    const res = await api("/api/v1/security/ipblocks", {
      method: "POST",
      body: { ip: form.ip, reason: form.reason, hours: parseInt(form.hours, 10) || null },
    });
    setBusy(false);
    if (res.ok) {
      toast({ title: "IP blocked" });
      setOpen(false);
      setForm({ ip: "", reason: "", hours: "0" });
      reload();
    } else {
      toast({ title: "Could not block IP", description: res.error, variant: "destructive" });
    }
  }

  async function unblock(ip: string) {
    const res = await api(`/api/v1/security/ipblocks?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: `${ip} unblocked` });
      reload();
    } else {
      toast({ title: "Unblock failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Auto blocks (DDoS shield / WAF) expire on their own; manual blocks stay until you lift them.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Ban className="w-4 h-4 mr-1" /> Block IP</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Block an IP address</DialogTitle>
              <DialogDescription>Blocked IPs are rejected at the gateway edge before auth.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>IP address</Label>
                <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="203.0.113.66" className="font-mono" />
              </div>
              <div>
                <Label>Reason</Label>
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Repeated abuse of /api/gw/store" />
              </div>
              <div>
                <Label>Duration</Label>
                <Select value={form.hours} onValueChange={(v) => setForm({ ...form, hours: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Permanent (until lifted)</SelectItem>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="168">1 week</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="destructive" onClick={block} disabled={busy || !form.ip}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />} Block
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!data ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : data.blocks.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No IPs blocked right now.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {data.blocks.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono font-medium text-sm">{b.ip}</p>
                    <Badge variant="outline" className={`text-[10px] ${b.source === "MANUAL" ? "border-amber-500/40 text-amber-400" : "border-red-500/40 text-red-400"}`}>
                      {b.source}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {b.expiresAt ? `expires ${fmtDate(b.expiresAt)}` : "permanent"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{b.reason}</p>
                  <p className="text-[11px] text-muted-foreground">blocked {fmtAgo(b.createdAt)}{b.createdBy ? ` by ${b.createdBy}` : ""}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => unblock(b.ip)}>Unblock</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- EVENTS ---------------- */

function EventsTab() {
  const q = useQuery({
    queryKey: ["security"],
    queryFn: () => api<SecurityState>("/api/v1/security"),
    refetchInterval: 10_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-2">
      {data.events.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No security events yet — the edge is quiet.</CardContent></Card>
      ) : (
        data.events.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <Badge variant="outline" className={`shrink-0 w-fit ${SEVERITY_CLASS[e.severity]}`}>{e.type}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{e.detail || e.action}</p>
                <p className="text-[11px] text-muted-foreground">
                  {e.sourceIp ? `${e.sourceIp} · ` : ""}
                  {e.routeKey ? `route ${e.routeKey} · ` : ""}
                  {e.action}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{fmtAgo(e.createdAt)}</span>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
