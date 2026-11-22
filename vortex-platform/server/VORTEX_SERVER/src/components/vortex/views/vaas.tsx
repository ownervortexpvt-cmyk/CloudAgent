"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Flame, Lock, Unlock, Loader2, Plus, Users, Boxes, DatabaseZap, HardDrive,
  Radio, Zap, KeyRound, Copy, Sparkles, Terminal, ShieldCheck, Ban, CheckCircle2,
  RotateCcw, MessageSquareText, Upload, PlayCircle, FileCode2, Crown,
} from "lucide-react";
import { api, fmtDate, fmtAgo, type VaasState } from "../client";

/**
 * Phase 8 — VORTEX AS A SERVICE. The owner console over the public BaaS:
 * gate control, projects + keys, developers, NEXA one-call provisioning,
 * and a live SDK playground that exercises the real /api/vaas/v1 surface.
 */

const RULE_CLASS: Record<string, string> = {
  public: "border-emerald-500/40 text-emerald-400",
  auth: "border-sky-500/40 text-sky-400",
  owner: "border-amber-500/40 text-amber-400",
  admin: "border-red-500/40 text-red-400",
};

type LogLine = { at: string; method: string; path: string; status: number; detail: string };

export default function VaasView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["vaas"],
    queryFn: () => api<VaasState>("/api/v1/vaas"),
    refetchInterval: 30_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSnippet, setLastSnippet] = useState<{ title: string; body: string } | null>(null);

  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  async function act(op: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(op);
    const res = await api<{ snippet?: string } & Record<string, unknown>>("/api/v1/vaas", { method: "POST", body: { op, ...body } });
    setBusy(null);
    if (!res.ok) {
      toast({ title: "VaaS action failed", description: res.error, variant: "destructive" });
      return null;
    }
    toast({ title: okMsg, description: op === "flip_gate" ? `future.firebase_mode = ${String(res.data?.mode || "")}` : undefined });
    q.refetch();
    onChanged();
    if (res.data?.snippet) {
      setLastSnippet({
        title: op === "nexa_provision" ? `NEXA backend for "${String(body.appName)}" is provisioned` : `Project "${String(body.name || "")}" provisioned`,
        body: String(res.data.snippet),
      });
    }
    return res.data;
  }

  const open = data.mode !== "LOCKED";
  const s = data.stats;

  return (
    <div className="space-y-6">
      {/* Gate hero */}
      <Card className={open ? "border-emerald-600/40" : "border-amber-600/30"}>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${open ? "bg-emerald-500/10 border-emerald-600/30" : "bg-amber-500/10 border-amber-600/30"}`}>
                <Flame className={`w-6 h-6 ${open ? "text-emerald-500" : "text-amber-500"}`} />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">
                  VORTEX AS A SERVICE — Firebase Mode: <span className={open ? "text-emerald-500" : "text-amber-500"}>{data.mode}</span>
                </h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  {open ? (
                    <>
                      The owner flipped the Phase 7 reserve: VORTEX is now a public, multi-tenant Backend-as-a-Service —
                      every developer gets projects with CLIENT/ADMIN keys, end-user auth (password + OTP over real MAIL),
                      a Firestore-style doc DB with <span className="text-foreground">server-side rules</span>, storage on
                      real 3×-replica buckets, socket.io realtime and sandboxed cloud functions. NEXA provisions a whole
                      backend in one call. Every call is metered into BDT plans.
                    </>
                  ) : (
                    <>
                      Gate is LOCKED — the VaaS surface refuses public traffic (signup, docs publish, external plans)
                      until the owner flips <code className="font-mono text-xs text-primary">future.firebase_mode</code>.
                    </>
                  )}
                  {data.gate.updatedAt ? (
                    <span className="block text-[11px] mt-1 text-muted-foreground">
                      last change {fmtDate(data.gate.updatedAt)} by {data.gate.updatedBy || "system"}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            <Button
              variant={open ? "outline" : "default"}
              onClick={() => act("flip_gate", { mode: open ? "LOCKED" : "OPEN" }, open ? "Gate re-locked" : "Gate opened — VaaS is live")}
              disabled={busy === "flip_gate"}
              className="shrink-0"
            >
              {busy === "flip_gate" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : open ? <Lock className="w-4 h-4 mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
              {open ? "Re-lock the gate" : "Open the gate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Developers", value: s.developers, icon: Users, hint: `${s.nexaDevId ? "NEXA builder wired" : "NEXA identity missing"}` },
          { label: "Projects", value: s.projects, icon: Boxes, hint: `${s.nexaProjects} provisioned via NEXA` },
          { label: "End Users", value: s.endUsers, icon: Users, hint: "password + OTP, per project" },
          { label: "Documents", value: s.docs, icon: DatabaseZap, hint: `${s.collections} collections · server-side rules` },
          { label: "Files", value: s.files, icon: HardDrive, hint: `${s.storageMb} MB on real 3×-replica buckets` },
          { label: "Realtime 24h", value: s.rt24h, icon: Radio, hint: "socket.io rooms + pollable history" },
          { label: "Fn Runs 24h", value: s.fnRuns24h, icon: Zap, hint: "sandboxed, timeout-enforced" },
          { label: "SDK Calls", value: s.apiCalls, icon: KeyRound, hint: "metered this period (BDT plans)" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground tracking-wide uppercase">{c.label}</p>
                <c.icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2">{c.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="projects" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0">
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="developers">Developers</TabsTrigger>
          <TabsTrigger value="nexa">NEXA Provisioning</TabsTrigger>
          <TabsTrigger value="playground">SDK Playground</TabsTrigger>
          <TabsTrigger value="functions">Functions</TabsTrigger>
          <TabsTrigger value="usage">Usage &amp; Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <ProjectsTab data={data} act={act} busy={busy} />
        </TabsContent>
        <TabsContent value="developers" className="mt-4">
          <DevelopersTab data={data} act={act} busy={busy} />
        </TabsContent>
        <TabsContent value="nexa" className="mt-4">
          <NexaTab act={act} busy={busy} snippet={lastSnippet} onCopy={copyText} />
        </TabsContent>
        <TabsContent value="playground" className="mt-4">
          <PlaygroundTab data={data} />
        </TabsContent>
        <TabsContent value="functions" className="mt-4">
          <FunctionsTab data={data} />
        </TabsContent>
        <TabsContent value="usage" className="mt-4">
          <UsageTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: what });
  } catch {
    toast({ title: "Copy failed", description: "Select the text and copy manually", variant: "destructive" });
  }
}

// ------------------------------------------------------------
// Projects
// ------------------------------------------------------------

function ProjectsTab({ data, act, busy }: { data: VaasState; act: (op: string, body: Record<string, unknown>, msg: string) => Promise<unknown>; busy: string | null }) {
  const [selected, setSelected] = useState<string | null>(data.projects[0]?.projectId || null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [devId, setDevId] = useState("");
  const [cols, setCols] = useState("posts,profile");
  const [usage, setUsage] = useState<{ priced: { subtotalBdt: number; taxBdt: number; totalBdt: number; lines: { metric: string; quantity: number; costBdt: number; unit: string }[] } | null } | null>(null);
  const project = data.projects.find((p) => p.projectId === selected) || data.projects[0] || null;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">Projects ({data.projects.length})</h4>
          <Button size="sm" variant="outline" onClick={() => { setCreating(!creating); setDevId(data.stats.nexaDevId ? "" : (data.developers[0]?.devId || "")); }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New project
          </Button>
        </div>

        {creating && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vx-name">Project name</Label>
                  <Input id="vx-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My SaaS backend" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vx-dev">Developer</Label>
                  <select
                    id="vx-dev"
                    value={devId}
                    onChange={(e) => setDevId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— choose developer —</option>
                    {data.developers.map((d) => (
                      <option key={d.devId} value={d.devId}>{d.name} ({d.email}){d.isNexa ? " · NEXA" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="vx-cols">Collections (comma separated — rules default read:public, write:auth)</Label>
                  <Input id="vx-cols" value={cols} onChange={(e) => setCols(e.target.value)} placeholder="posts,comments,profile" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={busy === "provision_project" || !name || !devId}
                  onClick={async () => {
                    await act("provision_project", { name, devId, collections: cols.split(",").map((c) => c.trim()).filter(Boolean) }, "Project provisioned");
                    setCreating(false); setName("");
                  }}
                >
                  {busy === "provision_project" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />} Provision
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {data.projects.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
            No projects yet — provision one for a developer, or let NEXA do it in one call.
          </p>
        )}

        {data.projects.map((p) => (
          <button
            key={p.projectId}
            onClick={() => setSelected(p.projectId)}
            className={`w-full text-left rounded-xl border p-4 transition-colors ${project?.projectId === p.projectId ? "border-primary/40 bg-primary/5" : "border-border/60 hover:bg-accent/50"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{p.name}</p>
                  <Badge variant="outline" className="font-mono text-[10px]">{p.projectId}</Badge>
                  {p.viaNexa && <Badge variant="outline" className="border-primary/40 text-primary text-[10px]"><Sparkles className="w-3 h-3 mr-1" /> NEXA</Badge>}
                  <Badge variant="outline" className={p.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400 text-[10px]" : "border-amber-500/40 text-amber-400 text-[10px]"}>{p.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {p.developer?.name || "—"} · {p.region} · {p.collections} collections · {p.docs} docs · {p.users} users · ৳{p.usageBdt} this month
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground shrink-0">{fmtAgo(p.createdAt)}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="lg:col-span-2 space-y-4">
        {project ? (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm">{project.name} — detail</h4>
                  <div className="flex gap-1">
                    <Button
                      size="sm" variant="outline"
                      disabled={busy === "rotate_keys"}
                      onClick={() => act("rotate_keys", { projectId: project.projectId }, "New keys issued (shown in snippet area)")}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Rotate keys
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => act("set_project_status", { projectId: project.projectId, status: project.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }, "Status updated")}
                    >
                      {project.status === "ACTIVE" ? <Ban className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                      {project.status === "ACTIVE" ? "Pause" : "Resume"}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><span className="font-mono text-primary">{project.projectId}</span> · slug <span className="font-mono">{project.slug}</span>.vaas.vortex.internal</p>
                  <p>features: auth {project.authEnabled ? "on" : "off"} · realtime {project.rtEnabled ? "on" : "off"} · functions {project.fnEnabled ? "on" : "off"}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => act("project_usage", { projectId: project.projectId }, "") && undefined}>
                    Refresh usage
                  </Button>
                </div>
                {usage && usage.priced && null}
                <Button size="sm" variant="outline" className="w-full" onClick={async () => {
                  const res = await api<{ priced: { subtotalBdt: number; taxBdt: number; totalBdt: number; lines: { metric: string; quantity: number; costBdt: number; unit: string }[] }; plan: string } & Record<string, unknown>>("/api/v1/vaas", { method: "POST", body: { op: "project_usage", projectId: project.projectId } });
                  if (res.ok) {
                    setUsage({ priced: res.data?.priced || null });
                    toast({ title: "Usage refreshed", description: `plan ${res.data?.plan} · ৳${res.data?.priced?.subtotalBdt || 0} subtotal` });
                  }
                }}>
                  <Zap className="w-3.5 h-3.5 mr-1" /> Price this month
                </Button>
                {usage?.priced && (
                  <div className="text-xs border border-border/60 rounded-lg p-3 space-y-1">
                    {usage.priced.lines.filter((l) => l.quantity > 0).map((l) => (
                      <div key={l.metric} className="flex justify-between">
                        <span className="text-muted-foreground">{l.metric} · {l.quantity.toLocaleString("en-US")} {l.unit}</span>
                        <span className="font-mono">৳{l.costBdt}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-border/60 pt-1 font-medium">
                      <span>Subtotal · VAT 15% · Total</span>
                      <span className="font-mono">৳{usage.priced.subtotalBdt} + ৳{usage.priced.taxBdt} = ৳{usage.priced.totalBdt}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold text-sm mb-3">Collections &amp; rules (server-enforced)</h4>
                <div className="space-y-2">
                  {data.collections.filter((c) => c.projectId === project.id).map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-mono text-xs truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.docCount} docs</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${RULE_CLASS[c.readRule] || ""}`}>read: {c.readRule}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${RULE_CLASS[c.writeRule] || ""}`}>write: {c.writeRule}</Badge>
                      </div>
                    </div>
                  ))}
                  {data.collections.filter((c) => c.projectId === project.id).length === 0 && (
                    <p className="text-xs text-muted-foreground">No collections.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Skeleton className="h-64 rounded-xl" />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Developers
// ------------------------------------------------------------

function DevelopersTab({ data, act, busy }: { data: VaasState; act: (op: string, body: Record<string, unknown>, msg: string) => Promise<unknown>; busy: string | null }) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm">Developer accounts ({data.developers.length})</h4>
          <Button size="sm" variant="outline" onClick={() => setCreating(!creating)}><Plus className="w-3.5 h-3.5 mr-1" /> Add developer</Button>
        </div>

        {creating && (
          <Card>
            <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="dev-name">Name</Label>
                <Input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahim" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-email">Email</Label>
                <Input id="dev-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dev@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-pass">Password (8+)</Label>
                <Input id="dev-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="sm:col-span-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
                <Button
                  size="sm" disabled={busy === "create_developer" || !email || password.length < 8}
                  onClick={async () => {
                    await act("create_developer", { email, password, name }, "Developer account created");
                    setCreating(false); setEmail(""); setPassword(""); setName("");
                  }}
                >
                  {busy === "create_developer" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />} Create
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {data.developers.map((d) => (
          <div key={d.devId} className="rounded-xl border border-border/60 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {d.isNexa && <Crown className="w-4 h-4 text-primary" />}
                <p className="font-medium truncate">{d.name}</p>
                <Badge variant="outline" className="text-[10px]">{d.plan}</Badge>
                <Badge variant="outline" className={d.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400 text-[10px]" : "border-red-500/40 text-red-400 text-[10px]"}>{d.status}</Badge>
                {d.emailVerified && <Badge variant="outline" className="border-sky-500/40 text-sky-400 text-[10px]">verified</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">{d.email} · {d.projects} projects · last login {fmtAgo(d.lastLoginAt)}</p>
            </div>
            {!d.isNexa && (
              <Button
                size="sm" variant="outline" className="shrink-0"
                disabled={busy === "set_dev_status"}
                onClick={() => act("set_dev_status", { devId: d.devId, status: d.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, "Developer updated")}
              >
                {d.status === "ACTIVE" ? <Ban className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                {d.status === "ACTIVE" ? "Suspend" : "Activate"}
              </Button>
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <h4 className="font-semibold text-sm mb-3">Public developer signup</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            While <code className="font-mono text-primary">vaas.public_signup = true</code> and the gate is open, anyone
            can self-register through the SDK surface:
          </p>
          <pre className="mt-3 rounded-lg bg-muted/50 border border-border/60 p-3 text-[11px] font-mono overflow-x-auto">
{`POST /api/vaas/v1/dev/signup
{ "email": "...", "password": "..." }
→ vdt_ token + verification mail`}
          </pre>
          <p className="text-[11px] text-muted-foreground mt-3">
            Config lives in Configuration; every signup is audited. The control plane itself stays private.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// NEXA provisioning
// ------------------------------------------------------------

function NexaTab({ act, busy, snippet, onCopy }: {
  act: (op: string, body: Record<string, unknown>, msg: string) => Promise<unknown>;
  busy: string | null;
  snippet: { title: string; body: string } | null;
  onCopy: (t: string, w: string) => void;
}) {
  const [appName, setAppName] = useState("");
  const [cols, setCols] = useState("posts,comments,profile");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-primary/25">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">NEXA — one call, one whole backend</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The AI app builder provisions a complete VaaS backend while generating an app: project under the NEXA
                developer identity, collections with default rules, a real storage bucket, CLIENT + ADMIN keys, an
                <span className="text-foreground"> onUserWelcome</span> EVENT_AUTH function, and a ready-to-paste SDK snippet.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nexa-app">App name (from the builder)</Label>
              <Input id="nexa-app" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Rakib's Grocery" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nexa-cols">Collections</Label>
              <Input id="nexa-cols" value={cols} onChange={(e) => setCols(e.target.value)} placeholder="posts,orders,profile" />
            </div>
            <Button
              className="w-full"
              disabled={busy === "nexa_provision" || !appName}
              onClick={() => act("nexa_provision", { appName, collections: cols.split(",").map((c) => c.trim()).filter(Boolean) }, "NEXA backend provisioned")}
            >
              {busy === "nexa_provision" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Provision backend
            </Button>
            <p className="text-[11px] text-muted-foreground font-mono">
              POST /api/v1/vaas {"{"} op: &quot;nexa_provision&quot;, appName, collections[] {"}"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {snippet ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-2"><FileCode2 className="w-4 h-4 text-primary" /> {snippet.title}</h3>
                <Button size="sm" variant="outline" onClick={() => onCopy(snippet.body, "SDK snippet")}><Copy className="w-3.5 h-3.5 mr-1" /> Copy</Button>
              </div>
              <ScrollArea className="max-h-96">
                <pre className="rounded-lg bg-muted/50 border border-border/60 p-3 text-[11px] font-mono whitespace-pre-wrap">{snippet.body}</pre>
              </ScrollArea>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-10">
              <Terminal className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-xs">
                Provision a backend (or a project) and the generated SDK snippet appears here — copy it straight into
                the builder&apos;s app template.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// SDK playground — real calls against /api/vaas/v1
// ------------------------------------------------------------

type RtItem = { eventId: string; channel: string; type: string; payload: Record<string, unknown>; at: string };

function PlaygroundTab({ data }: { data: VaasState }) {
  const demo = data.demo;
  const [email, setEmail] = useState(demo?.email || "");
  const [password, setPassword] = useState(demo?.password || "");
  const [token, setToken] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rtFeed, setRtFeed] = useState<RtItem[]>([]);
  const socketRef = useRef<{ emit: (e: string, d: unknown) => void; on: (e: string, h: (d: unknown) => void) => void; connected: boolean } | null>(null);
  const [rtConnected, setRtConnected] = useState(false);

  const cfg = demo ? { projectId: demo.projectId, clientKey: demo.clientKey, apiUrl: "/api/vaas/v1" } : null;

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    // dynamic import so the page also runs before socket.io loads
    import("socket.io-client").then(({ io }) => {
      if (cancelled) return;
      const socket = io("/?XTransformPort=3005", { transports: ["websocket", "polling"], forceNew: true, reconnection: true, timeout: 10000 });
      socketRef.current = socket as unknown as typeof socketRef.current;
      socket.on("connect", () => {
        if (cancelled) return;
        setRtConnected(true);
        socket.emit("vx:subscribe", { projectId: cfg.projectId });
      });
      socket.on("disconnect", () => { if (!cancelled) setRtConnected(false); });
      socket.on("vx:event", (env: unknown) => {
        const e = env as RtItem;
        if (cancelled || !e?.eventId) return;
        setRtFeed((prev) => [{ eventId: e.eventId, channel: e.channel, type: e.type, payload: e.payload || {}, at: e.at || new Date().toISOString() }, ...prev].slice(0, 12));
      });
    }).catch(() => setRtConnected(false));
    return () => {
      cancelled = true;
      try { socketRef.current?.emit("vx:unsubscribe", { projectId: cfg.projectId }); socketRef.current = null; } catch { /* noop */ }
    };
  }, [cfg?.projectId]);

  function addLog(method: string, path: string, status: number, detail: string) {
    setLog((prev) => [{ at: new Date().toLocaleTimeString("en-GB"), method, path, status, detail }, ...prev].slice(0, 30));
  }

  async function call(method: string, path: string, body?: unknown, label?: string): Promise<Record<string, unknown> | null> {
    if (!cfg) return null;
    const headers: Record<string, string> = { "x-vx-key": cfg.clientKey };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const res = await fetch(cfg.apiUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const json = (await res.json()) as { ok?: boolean; error?: string; code?: number } & Record<string, unknown>;
      addLog(method, path, res.status, json.ok ? JSON.stringify(json).slice(0, 140) : json.error || "error");
      if (!json.ok) {
        toast({ title: `${label || method} failed (HTTP ${res.status})`, description: json.error, variant: "destructive" });
        return null;
      }
      return json;
    } catch (err) {
      addLog(method, path, 0, err instanceof Error ? err.message : "network error");
      toast({ title: "Network error", variant: "destructive" });
      return null;
    }
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try { await fn(); } finally { setBusy(null); }
  }

  if (!demo || !cfg) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
        Playground needs the seeded demo project — re-seed the platform to get it.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2"><PlayCircle className="w-4 h-4 text-primary" /> Live SDK playground</h4>
              <Badge variant="outline" className="font-mono text-[10px]">{demo.projectId}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Real calls against <span className="font-mono">/api/vaas/v1</span> with the publishable CLIENT key
              (<span className="font-mono">{demo.clientKey.slice(0, 12)}…</span>) — exactly what a third-party app does.
            </p>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pg-email">End-user email</Label>
                <Input id="pg-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-pass">Password</Label>
                <Input id="pg-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("signup", async () => {
                const res = await call("POST", "/auth/signup", { email, password, displayName: email.split("@")[0] }, "signup");
                if (res?.idToken) { setToken(String(res.idToken)); setUid(String(res.uid)); toast({ title: "Signed up", description: `uid ${res.uid}` }); }
              })}>
                {busy === "signup" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Users className="w-3.5 h-3.5 mr-1" />} Sign up
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("login", async () => {
                const res = await call("POST", "/auth/login", { email, password }, "login");
                if (res?.idToken) { setToken(String(res.idToken)); setUid(String(res.uid)); toast({ title: "Signed in", description: `uid ${res.uid}` }); }
              })}>
                {busy === "login" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1" />} Sign in
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null || !token} onClick={() => run("me", async () => {
                const res = await call("GET", "/auth/me", undefined, "me");
                if (res) toast({ title: "Current user", description: `${res.uid} · ${res.email}` });
              })}>
                <Users className="w-3.5 h-3.5 mr-1" /> Me
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("otp", async () => {
                const res = await call("POST", "/auth/otp-request", { email }, "otp-request");
                if (res) toast({ title: `OTP ${res.delivery === "SIMULATED" ? "captured in outbox (SIMULATED)" : "delivered via SMTP"}`, description: "see Mail & Audit — SMTP wiring makes it real" });
              })}>
                <MessageSquareText className="w-3.5 h-3.5 mr-1" /> OTP code
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("addDoc", async () => {
                const res = await call("POST", "/data/posts", { data: { title: `Playground post ${new Date().toLocaleTimeString("en-GB")}`, body: "added from the VaaS console", likes: 0, author: uid || "guest" } }, "doc add");
                if (res?.doc) toast({ title: "Document added", description: `id ${String((res.doc as { id?: string }).id)}` });
              })}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add doc
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("query", async () => {
                const res = await call("GET", "/data/posts?orderBy=-likes&limit=3", undefined, "query");
                if (res) toast({ title: `Top ${res.items ? (res.items as unknown[]).length : 0} posts by likes`, description: "ordered query with server-side rules" });
              })}>
                <DatabaseZap className="w-3.5 h-3.5 mr-1" /> Query
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("upload", async () => {
                const content = `VaaS playground upload at ${new Date().toISOString()}\nPowered by real VORTEX STORAGE (3x replicas, sha256).`;
                const b64 = btoa(unescape(encodeURIComponent(content)));
                const res = await call("POST", "/storage/upload", { path: `notes/playground-${Date.now()}.txt`, contentB64: b64, mime: "text/plain" }, "upload");
                if (res?.fileId) toast({ title: "File stored", description: `${res.fileId} · checksum ${String(res.checksum).slice(0, 12)}…` });
              })}>
                <Upload className="w-3.5 h-3.5 mr-1" /> Upload
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("fn", async () => {
                const res = await call("POST", "/fn/ping/invoke", { payload: { from: "playground" } }, "fn invoke");
                if (res?.status === "OK") toast({ title: "Function ran", description: `pong in ${res.latencyMs}ms — watch the realtime feed` });
              })}>
                <Zap className="w-3.5 h-3.5 mr-1" /> Invoke fn
              </Button>
              <Button size="sm" variant="outline" className="col-span-2" disabled={busy !== null} onClick={() => run("rt", async () => {
                const res = await call("POST", "/rt/publish", { channel: "chat-room-1", type: "message", payload: { text: "hello from the console", by: uid || "guest" } }, "rt publish");
                if (res) toast({ title: "Realtime event published", description: `channel chat-room-1 · ${res.eventId}` });
              })}>
                <Radio className="w-3.5 h-3.5 mr-1" /> Publish realtime message
              </Button>
            </div>
            {uid && (
              <p className="text-[11px] text-muted-foreground">
                Session: <span className="font-mono text-primary">{uid}</span> · idToken held in memory (SDK stores it in localStorage)
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3 grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" /> Request log</h4>
            <ScrollArea className="max-h-96">
              <div className="space-y-1.5 pr-3">
                {log.length === 0 && <p className="text-xs text-muted-foreground">Press any button — every call lands here with its real HTTP status.</p>}
                {log.map((l, i) => (
                  <div key={`${l.at}-${i}`} className="rounded border border-border/50 px-2 py-1.5 text-[11px] font-mono">
                    <span className={l.status >= 400 || l.status === 0 ? "text-red-400" : "text-emerald-400"}>{l.status || "ERR"}</span>
                    <span className="text-muted-foreground ml-2">{l.at}</span>
                    <span className="text-primary ml-2">{l.method}</span> {l.path}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm flex items-center gap-2"><Radio className="w-4 h-4 text-primary" /> Live realtime feed</h4>
              <Badge variant="outline" className={rtConnected ? "border-emerald-500/40 text-emerald-400 text-[10px]" : "border-amber-500/40 text-amber-400 text-[10px]"}>
                {rtConnected ? "socket.io live" : "polling fallback"}
              </Badge>
            </div>
            <ScrollArea className="max-h-96">
              <div className="space-y-1.5 pr-3">
                {rtFeed.length === 0 && <p className="text-xs text-muted-foreground">Subscribed to project rooms — publish a message or invoke the ping function.</p>}
                {rtFeed.map((e) => (
                  <div key={e.eventId} className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                    <p className="font-mono text-primary">{e.channel} · {e.type}</p>
                    <p className="text-muted-foreground truncate">{JSON.stringify(e.payload)}</p>
                  </div>
                ))}
                {data.recentEvents.slice(0, 4).map((e) => (
                  <div key={`hist-${e.eventId}`} className="rounded border border-border/30 px-2 py-1.5 text-[11px] opacity-60">
                    <p className="font-mono text-muted-foreground">{e.channel} · {e.type} (history)</p>
                    <p className="text-muted-foreground truncate">{e.payloadJson}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Functions
// ------------------------------------------------------------

function FunctionsTab({ data }: { data: VaasState }) {
  const fns = data.functions;
  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm">Cloud Functions ({fns.length}) — sandboxed runtime, ctx = {"{"} payload, db, realtime, project, user, log {"}"}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {fns.map((f) => {
          const project = data.projects.find((p) => p.id === f.projectId);
          return (
            <Card key={f.fnId}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Zap className={`w-4 h-4 ${f.status === "ACTIVE" ? "text-primary" : "text-red-400"}`} />
                    <p className="font-medium font-mono text-sm">{f.name}</p>
                    <Badge variant="outline" className="text-[10px]">{f.trigger}</Badge>
                  </div>
                  <Badge variant="outline" className={f.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400 text-[10px]" : "border-red-500/40 text-red-400 text-[10px]"}>
                    {f.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {project?.name || "—"} · {f.invocations} invocations{f.fails > 0 ? ` · ${f.fails} failed` : ""} · last run {fmtAgo(f.lastRunAt)}
                </p>
                {f.lastError && <p className="text-[11px] text-red-400 mt-1 font-mono truncate">last error: {f.lastError}</p>}
              </CardContent>
            </Card>
          );
        })}
        {fns.length === 0 && <p className="text-sm text-muted-foreground">No functions yet — NEXA provisioning adds onUserWelcome automatically.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Usage & plans
// ------------------------------------------------------------

function UsageTab({ data }: { data: VaasState }) {
  const total = data.projects.reduce((a, p) => a + p.usageBdt, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold text-sm mb-4">Platform usage this period (metered from real SDK calls)</h4>
          <div className="space-y-2">
            {data.usageTop.length === 0 && <p className="text-sm text-muted-foreground">No metered usage yet — use the playground.</p>}
            {data.usageTop.map((u) => (
              <div key={u.metric} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-primary">{u.metric}</span>
                <span>{u.quantity.toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">All projects, priced against their plans</p>
            <p className="font-semibold">৳{total.toLocaleString("en-US")} <span className="text-xs text-muted-foreground font-normal">/ month (VAT excl.)</span></p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold text-sm mb-4 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Public plans (audience EXTERNAL — active)</h4>
          <div className="space-y-3">
            {data.plans.map((p) => (
              <div key={p.planId} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{p.name} <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span></p>
                  <p className="font-semibold">{p.monthlyBaseBdt === 0 ? "Free" : `৳${p.monthlyBaseBdt}/mo`}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{p.note}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-4">
            The Phase 7 reserve became an offering with zero rewrites — the same metering, rate card and VAT pipeline
            that prices the owner&apos;s internal apps now prices the public surface.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
