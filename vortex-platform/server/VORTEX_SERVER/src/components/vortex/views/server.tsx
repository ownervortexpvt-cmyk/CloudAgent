"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { api } from "@/components/vortex/client";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Copy,
  Database,
  Flame,
  FolderGit2,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Package,
  Plus,
  ReceiptText,
  Rocket,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";

/**
 * VORTEX SERVER — the Central Cloud Infrastructure shell (Phase VS).
 * 14-item sidebar per the founder's spec. Every panel shows REAL data from
 * /api/v1/admin/* and the platform namespaces; items that ship in later
 * phases say so honestly instead of faking ACTIVE.
 */

type Overview = {
  totals: {
    users: number; developers: number;
    cloudAgentProjects: number; cloudAgentBuilds: number;
    websites: number; websitesDeployed: number;
    apps: number; appsPublished: number;
    vaasProjects: number; activePlatformKeys: number;
    successfulDeployments: number; openAlerts: number;
  };
  storagePool: { provider: string; configured: boolean; missing: string[]; usedGb: number; poolGb: number; pct: number; endpoint: string };
  server: { version: string; tagline: string; time: string };
};

type Platforms = {
  platforms: {
    platformId: string; name: string; kind: string; namespace: string; description: string; status: string;
    keys: { keyId: string; name: string; kind: string; status: string; scopes: string[]; lastUsedAt: string | null; createdAt: string }[];
  }[];
};

type StorageInfo = {
  provider: { active: string; configured: boolean; missing: string[]; endpoint: string; region: string; note: string };
  pool: { usedGb: number; poolGb: number; pct: number; alertThresholdPct: number };
  buckets: {
    bucketId: string; name: string; platform: string; purpose: string; provider: string;
    status: string; quotaMb: number; usedMb: number; objectCount: number; versioning: boolean; versionDays: number;
  }[];
};

type CaProjects = { projects: { projectId: string; name: string; type: string; status: string; sizeBytes: number; fileCount: number; buildCount: number; ownerEmail: string; updatedAt: string; lastBuild: { status: string } | null }[] };
type Sites = { sites: { siteId: string; name: string; subdomain: string; customDomain: string | null; status: string; activeVersion: number; deployCount: number; url: string }[] };
type Apps = { apps: { appId: string; name: string; packageName: string; category: string; status: string; latestVersion: string | null; downloadCount: number }[] };
type Billing = { cloudAgentPlans: { code: string; name: string; priceInr: number; currency: string; active: boolean }[]; activeSubscriptions: number; note: string };
type SecInfo = {
  securityEvents: { type: string; severity: string; sourceIp: string | null; action: string; detail: string; createdAt: string }[];
  activeIpBlocks: number;
  policy: { wafEnabled: boolean; ipBlockEnabled: boolean; ddosEnabled: boolean; blockMode: string } | null;
  recentAudits: { id: string; actor: string; action: string; resource: string; detail: string; createdAt: string }[];
};

const SUBVIEWS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: Users },
  { key: "developers", label: "Developers", icon: UserCog },
  { key: "projects", label: "Projects", icon: FolderGit2 },
  { key: "storage", label: "Storage", icon: HardDrive },
  { key: "database", label: "Database", icon: Database },
  { key: "apis", label: "APIs", icon: KeyRound },
  { key: "applications", label: "Applications", icon: Package },
  { key: "websites", label: "Websites", icon: Globe },
  { key: "deployments", label: "Deployments", icon: Rocket },
  { key: "security", label: "Security", icon: ShieldCheck },
  { key: "billing", label: "Billing", icon: ReceiptText },
  { key: "monitoring", label: "Monitoring", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type SubKey = (typeof SUBVIEWS)[number]["key"];

const PHASES = [
  { p: "Phase 1", t: "Core backend & authentication", s: "LIVE" },
  { p: "Phase 2", t: "JOY SERVICES storage integration (keys pending)", s: "BUILDING" },
  { p: "Phase 3", t: "PostgreSQL-targeted schema, dev on SQLite", s: "BUILDING" },
  { p: "Phase 4", t: "Developer & user management", s: "LIVE" },
  { p: "Phase 5", t: "Admin dashboard (this shell)", s: "LIVE" },
  { p: "Phase 6", t: "API key management (app + platform keys)", s: "LIVE" },
  { p: "Phase 7", t: "CLOUD AGENT project lifecycle", s: "LIVE" },
  { p: "Phase 8", t: "VORTEX WEBSITE full hosting (domains + SSL)", s: "PLANNED" },
  { p: "Phase 9", t: "APPVERSE distribution hardening", s: "BUILDING" },
  { p: "Phase 10", t: "VI deep coordination", s: "BUILDING" },
  { p: "Phase 11", t: "Security audit & load testing", s: "PLANNED" },
  { p: "Phase 12", t: "Production deployment (PG + JOY cutover)", s: "PLANNED" },
];

function StatusBadge({ s }: { s: string }) {
  if (s === "LIVE") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40" variant="outline">{s}</Badge>;
  if (s === "BUILDING") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/40" variant="outline">{s}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{s}</Badge>;
}

function StatCell({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export default function ServerView() {
  const [sub, setSub] = useState<SubKey>("overview");
  const qc = useQueryClient();
  const [joyForm, setJoyForm] = useState({ apiToken: "", accessKey: "", secretKey: "", endpoint: "https://s3.joy.services" });
  const [joyBusy, setJoyBusy] = useState(false);
  const [keyDialog, setKeyDialog] = useState<{ platformId: string } | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ keyId: string; raw: string; scopes: string[] } | null>(null);

  const overview = useQuery({ queryKey: ["vs-overview"], queryFn: () => api<Overview>("/api/v1/admin/overview") });
  const platforms = useQuery({ queryKey: ["vs-platforms"], queryFn: () => api<Platforms>("/api/v1/admin/platforms"), enabled: sub === "apis" });
  const storage = useQuery({ queryKey: ["vs-storage"], queryFn: () => api<StorageInfo>("/api/v1/admin/storage"), enabled: sub === "storage" || sub === "overview" });
  const projects = useQuery({ queryKey: ["vs-projects"], queryFn: () => api<CaProjects>("/api/v1/cloud-agent/projects"), enabled: sub === "projects" });
  const sites = useQuery({ queryKey: ["vs-sites"], queryFn: () => api<Sites>("/api/v1/vortex-website/sites"), enabled: sub === "websites" || sub === "deployments" });
  const apps = useQuery({ queryKey: ["vs-apps"], queryFn: () => api<Apps>("/api/v1/appverse/apps"), enabled: sub === "applications" });
  const billing = useQuery({ queryKey: ["vs-billing"], queryFn: () => api<Billing>("/api/v1/admin/billing"), enabled: sub === "billing" });
  const security = useQuery({ queryKey: ["vs-security"], queryFn: () => api<SecInfo>("/api/v1/admin/security"), enabled: sub === "security" });

  const t = overview.data?.data?.totals;
  const pool = storage.data?.data?.pool;
  const prov = storage.data?.data?.provider;

  async function configureJoy() {
    setJoyBusy(true);
    try {
      const res = await api<{ configured: boolean }>("/api/v1/admin/storage/joy/configure", {
        method: "POST",
        body: {
          apiToken: joyForm.apiToken,
          accessKey: joyForm.accessKey,
          secretKey: joyForm.secretKey,
          endpoint: joyForm.endpoint,
        },
      });
      if (res.ok) {
        toast({ title: "JOY SERVICES wired", description: "storage.provider = joy — the storage panel now runs the live truth-check." });
        setJoyForm({ apiToken: "", accessKey: "", secretKey: "", endpoint: "https://s3.joy.services" });
        void qc.invalidateQueries({ queryKey: ["vs-storage"] });
        void qc.invalidateQueries({ queryKey: ["vs-overview"] });
      } else {
        toast({ title: "Configuration rejected", description: res.error || "Check the credentials", variant: "destructive" });
      }
    } finally {
      setJoyBusy(false);
    }
  }

  async function issueKey(platformId: string) {
    const res = await api<{ keyId: string; raw: string; scopes: string[] }>(`/api/v1/admin/platforms/${platformId}/keys`, {
      method: "POST",
      body: { name: `${platformId} service key` },
    });
    if (res.ok && res.data) {
      setIssuedKey({ keyId: res.data.keyId, raw: res.data.raw, scopes: res.data.scopes });
      void qc.invalidateQueries({ queryKey: ["vs-platforms"] });
    } else {
      toast({ title: "Key issuance failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="w-5 h-5 text-primary" /> VORTEX SERVER
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">ONE CENTRAL INFRASTRUCTURE</Badge>
              </CardTitle>
              <CardDescription>
                Five platforms, one backend, one database, one storage pool. Platforms: CLOUD AGENT, VORTEX WEBSITE, APPVERSE, VI — scoped by platform keys and bucket ownership.
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Storage provider</p>
              {prov ? (
                prov.configured ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">{prov.active === "joy" ? "JOY SERVICES LIVE" : "LOCAL ENGINE LIVE"}</Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400">JOY: NOT CONFIGURED</Badge>
                )
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {SUBVIEWS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setSub(s.key)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    sub === s.key ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {s.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ---------- OVERVIEW ---------- */}
      {sub === "overview" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Central Overview</CardTitle>
            <CardDescription>Live counts from the real tables — nothing here is mocked.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {overview.isPending ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : overview.data?.ok && t ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCell label="Users (owner)" value={t.users} />
                  <StatCell label="Developers" value={t.developers} />
                  <StatCell label="CA Projects" value={t.cloudAgentProjects} hint={`${t.cloudAgentBuilds} builds run`} />
                  <StatCell label="Websites" value={t.websites} hint={`${t.websitesDeployed} deployed`} />
                  <StatCell label="APPVERSE Apps" value={t.apps} hint={`${t.appsPublished} published`} />
                  <StatCell label="VaaS Projects" value={t.vaasProjects} hint="Firebase-parity backends" />
                  <StatCell label="Active Platform Keys" value={t.activePlatformKeys} />
                  <StatCell label="Open Alerts" value={t.openAlerts} hint={t.openAlerts > 0 ? "check Monitoring" : "all clear"} />
                </div>
                {pool && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Shared storage pool — {prov?.active === "joy" ? "JOY SERVICES" : "local engine (JOY keys pending)"}</span>
                      <span className={pool.pct >= pool.alertThresholdPct ? "text-amber-400 font-medium" : ""}>{pool.usedGb} / {pool.poolGb} GB ({pool.pct}%)</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${pool.pct >= pool.alertThresholdPct ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.max(pool.pct, 1.5)}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Alert threshold {pool.alertThresholdPct}% — an AlertEvent fires on crossing.</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-destructive">{overview.data?.error || "Failed to load overview"}</p>
            )}
            <div>
              <p className="text-xs font-semibold mb-2">Twelve-phase roadmap (honest status)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {PHASES.map((p) => (
                  <div key={p.p} className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5">
                    <span className="text-xs"><span className="font-semibold">{p.p}</span> — {p.t}</span>
                    <StatusBadge s={p.s} />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- USERS / DEVELOPERS ---------- */}
      {(sub === "users" || sub === "developers") && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{sub === "users" ? "User Management" : "Developer Management"}</CardTitle>
            <CardDescription>
              {sub === "users"
                ? "Owner accounts live in VORTEX ID; end users live per-platform (VaaS users, app users)."
                : "Developers own source code, builds and published apps; identity is shared with the VaaS dev console."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {t && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCell label="Owner users" value={t.users} />
                <StatCell label="Developers" value={t.developers} />
                <StatCell label="VaaS projects" value={t.vaasProjects} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Per-account lists, quotas and suspension controls ship with the Phase 11 hardening pass — the counts above are real table aggregates today.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ---------- PROJECTS (CLOUD AGENT) ---------- */}
      {sub === "projects" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">CLOUD AGENT Projects</CardTitle>
            <CardDescription>AI-builder projects with source archives and package builds in cloud-agent-projects.</CardDescription>
          </CardHeader>
          <CardContent>
            {projects.isPending ? <Skeleton className="h-24" /> : projects.data?.ok ? (
              projects.data.data.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects yet — CLOUD AGENT creates them via POST /api/v1/cloud-agent/projects.</p>
              ) : (
                <ScrollArea className="max-h-80">
                  <div className="space-y-2 pr-2">
                    {projects.data.data.projects.map((p) => (
                      <div key={p.projectId} className="rounded-md border border-border/60 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{p.name} <span className="text-xs text-muted-foreground">({p.type})</span></p>
                          <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 font-mono">{p.projectId} · {p.fileCount} files · {(p.sizeBytes / 1024).toFixed(1)} KB · builds {p.buildCount}{p.lastBuild ? ` · last ${p.lastBuild.status}` : ""}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )
            ) : (
              <p className="text-sm text-destructive">{projects.data?.error || "Failed to load projects"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- STORAGE ---------- */}
      {sub === "storage" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Storage — Bucket Registry & Provider</CardTitle>
            <CardDescription>{prov?.note}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {storage.isPending || !storage.data?.ok ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-primary/40 text-primary">provider: {storage.data.data.provider.active}</Badge>
                  <Badge variant="outline">{storage.data.data.pool.usedGb} / {storage.data.data.pool.poolGb} GB used ({storage.data.data.pool.pct}%)</Badge>
                  <Badge variant="outline" className="text-muted-foreground">{storage.data.data.provider.endpoint}</Badge>
                  {!storage.data.data.provider.configured && storage.data.data.provider.missing.length > 0 && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-400">missing: {storage.data.data.provider.missing.join(", ")}</Badge>
                  )}
                </div>
                <ScrollArea className="max-h-96">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/60">
                        <th className="py-1.5 pr-2 font-medium">Bucket</th>
                        <th className="py-1.5 pr-2 font-medium">Owner</th>
                        <th className="py-1.5 pr-2 font-medium">Objects</th>
                        <th className="py-1.5 pr-2 font-medium">Used</th>
                        <th className="py-1.5 pr-2 font-medium">Versions</th>
                        <th className="py-1.5 font-medium">Provider</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.data.data.buckets.map((b) => (
                        <tr key={b.bucketId} className="border-b border-border/30">
                          <td className="py-1.5 pr-2 font-mono">{b.name}</td>
                          <td className="py-1.5 pr-2">{b.platform}</td>
                          <td className="py-1.5 pr-2">{b.objectCount}</td>
                          <td className="py-1.5 pr-2">{(b.usedMb / 1024).toFixed(1)} GB</td>
                          <td className="py-1.5 pr-2">{b.versioning ? `${b.versionDays}d` : "off"}</td>
                          <td className="py-1.5">{b.provider}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
                {!storage.data.data.provider.configured && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2.5">
                    <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Wire JOY SERVICES — credentials are stored as secrets and never echoed back</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs">REST token (joy_...)</Label><Input className="h-8 text-xs" type="password" value={joyForm.apiToken} onChange={(e) => setJoyForm({ ...joyForm, apiToken: e.target.value })} placeholder="joy_..." /></div>
                      <div className="space-y-1"><Label className="text-xs">S3 access key</Label><Input className="h-8 text-xs" type="password" value={joyForm.accessKey} onChange={(e) => setJoyForm({ ...joyForm, accessKey: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">S3 secret key</Label><Input className="h-8 text-xs" type="password" value={joyForm.secretKey} onChange={(e) => setJoyForm({ ...joyForm, secretKey: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">S3 endpoint</Label><Input className="h-8 text-xs" value={joyForm.endpoint} onChange={(e) => setJoyForm({ ...joyForm, endpoint: e.target.value })} /></div>
                    </div>
                    <Button size="sm" onClick={configureJoy} disabled={joyBusy || !joyForm.apiToken || !joyForm.accessKey || !joyForm.secretKey}>
                      {joyBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />} Save &amp; switch provider to joy
                    </Button>
                    <p className="text-[11px] text-muted-foreground">On save, GET /api/v1/admin/storage performs the live connectivity truth-check; buckets provision through the real JOY REST API (max 100 buckets, keys stay server-side).</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- DATABASE ---------- */}
      {sub === "database" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Database — Twelve Modules</CardTitle>
            <CardDescription>PostgreSQL-targeted schema, running on SQLite in this sandbox (migration path documented in the architecture PDF).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {t && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCell label="Users module" value={t.users} hint="AdminUser/Session/Otp" />
                <StatCell label="Developers module" value={t.developers} />
                <StatCell label="Projects module" value={t.cloudAgentProjects} hint="CaProject/CaBuild" />
                <StatCell label="Applications module" value={t.apps} hint="AppverseApp/Version" />
                <StatCell label="Websites module" value={t.websites} hint="WebsiteProject/Deploy" />
                <StatCell label="Deployments module" value={t.successfulDeployments} hint="successful" />
                <StatCell label="VaaS projects" value={t.vaasProjects} hint="Vx* BaaS stack" />
                <StatCell label="Security logs" value={security.data?.ok ? security.data.data.securityEvents.length : "-"} hint="SecurityEvent rows" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">Isolation keys: platform_id + user_id + project_id on every tenant row. Backups land in database-backups (DR only — never mounted as a live database).</p>
          </CardContent>
        </Card>
      )}

      {/* ---------- APIs (platforms + keys) ---------- */}
      {sub === "apis" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">API Management — Platform Registry &amp; Keys</CardTitle>
            <CardDescription>Every platform gets scoped pk_live_ keys. The master key never leaves the server. Secrets are stored as SHA-256 hashes.</CardDescription>
          </CardHeader>
          <CardContent>
            {platforms.isPending ? <Skeleton className="h-40" /> : platforms.data?.ok ? (
              <div className="space-y-3">
                {platforms.data.data.platforms.map((p) => (
                  <div key={p.platformId} className="rounded-md border border-border/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">{p.name} <Badge variant="outline" className="text-[10px]">{p.kind}</Badge></p>
                        <p className="text-[11px] text-muted-foreground font-mono">{p.namespace}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => { setKeyDialog({ platformId: p.platformId }); void issueKey(p.platformId); }}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Issue key
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.keys.length === 0 && <span className="text-[11px] text-muted-foreground">No keys yet</span>}
                      {p.keys.map((k) => (
                        <Badge key={k.keyId} variant="outline" className={`text-[10px] ${k.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400" : "text-muted-foreground"}`}>
                          <KeyRound className="w-3 h-3 mr-1" />{k.keyId} · {k.kind}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-destructive">{platforms.data?.error || "Failed to load platforms"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- APPLICATIONS (APPVERSE) ---------- */}
      {sub === "applications" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">APPVERSE Applications</CardTitle>
            <CardDescription>APK/AAB distribution with SHA-256 integrity, review gate and signed counted downloads.</CardDescription>
          </CardHeader>
          <CardContent>
            {apps.isPending ? <Skeleton className="h-24" /> : apps.data?.ok ? (
              apps.data.data.apps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No apps yet — APPVERSE registers them via POST /api/v1/appverse/apps.</p>
              ) : (
                <div className="space-y-2">
                  {apps.data.data.apps.map((a) => (
                    <div key={a.appId} className="rounded-md border border-border/60 p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{a.name} <span className="text-xs text-muted-foreground font-mono">{a.packageName}</span></p>
                        <p className="text-[11px] text-muted-foreground">{a.latestVersion || "no version"} · {a.downloadCount} downloads</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${a.status === "PUBLISHED" ? "border-emerald-500/40 text-emerald-400" : ""}`}>{a.status}</Badge>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-destructive">{apps.data?.error || "Failed to load apps"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- WEBSITES ---------- */}
      {sub === "websites" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">VORTEX WEBSITE Sites</CardTitle>
            <CardDescription>Sites in the vortex-websites bucket with per-version deploy manifests. Custom domains + SSL join in Phase 8.</CardDescription>
          </CardHeader>
          <CardContent>
            {sites.isPending ? <Skeleton className="h-24" /> : sites.data?.ok ? (
              sites.data.data.sites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sites yet — VORTEX WEBSITE creates them via POST /api/v1/vortex-website/sites.</p>
              ) : (
                <div className="space-y-2">
                  {sites.data.data.sites.map((s) => (
                    <div key={s.siteId} className="rounded-md border border-border/60 p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{s.name} <span className="text-xs text-muted-foreground font-mono">{s.url}</span></p>
                        <p className="text-[11px] text-muted-foreground">v{s.activeVersion || 0} active · {s.deployCount} deploys</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${s.status === "DEPLOYED" ? "border-emerald-500/40 text-emerald-400" : ""}`}>{s.status}</Badge>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-destructive">{sites.data?.error || "Failed to load sites"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- DEPLOYMENTS ---------- */}
      {sub === "deployments" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Deployments</CardTitle>
            <CardDescription>Website deploys run through this stack today; server deploys reuse the existing Deployment/Pipeline engine.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {t && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCell label="Successful site deploys" value={t.successfulDeployments} />
                <StatCell label="Sites" value={t.websites} />
                <StatCell label="Deployed" value={t.websitesDeployed} />
              </div>
            )}
            {sites.data?.ok && sites.data.data.sites.length > 0 && (
              <div className="space-y-1.5">
                {sites.data.data.sites.map((s) => (
                  <div key={s.siteId} className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
                    <span className="font-mono">{s.siteId}</span>
                    <span>v{s.activeVersion} · {s.deployCount} deploys</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- SECURITY ---------- */}
      {sub === "security" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Security</CardTitle>
            <CardDescription>Real SecurityEvent + AuditLog rows; WAF and IP-block engine live in the main Security view.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {security.isPending ? <Skeleton className="h-24" /> : security.data?.ok ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCell label="Active IP blocks" value={security.data.data.activeIpBlocks} />
                  <StatCell label="Recent events" value={security.data.data.securityEvents.length} />
                </div>
                <ScrollArea className="max-h-72">
                  <div className="space-y-1.5 pr-2">
                    {security.data.data.recentAudits.slice(0, 12).map((x) => (
                      <div key={x.id} className="rounded-md border border-border/50 px-2.5 py-1.5">
                        <p className="text-xs font-mono">{x.action} <span className="text-muted-foreground">{x.resource}</span></p>
                        <p className="text-[11px] text-muted-foreground truncate">{x.actor} · {x.detail}</p>
                      </div>
                    ))}
                    {security.data.data.recentAudits.length === 0 && <p className="text-xs text-muted-foreground">No audit rows yet.</p>}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-destructive">{security.data?.error || "Failed to load security"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- BILLING ---------- */}
      {sub === "billing" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Billing — Cloud Agent Plans (INR)</CardTitle>
            <CardDescription>{billing.data?.data?.note || "Real BillingPlan rows; payment gateway joins in Phase 12."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {billing.isPending ? <Skeleton className="h-32" /> : billing.data?.ok ? (
              <>
                {billing.data.data.cloudAgentPlans.map((p) => (
                  <div key={p.code} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{p.code}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">INR {p.priceInr.toLocaleString("en-IN")}/mo</p>
                      <p className="text-[10px] text-muted-foreground">{p.active ? "active" : "inactive"}</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Active subscriptions: {billing.data.data.activeSubscriptions}</p>
              </>
            ) : (
              <p className="text-sm text-destructive">{billing.data?.error || "Failed to load billing"}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- MONITORING ---------- */}
      {sub === "monitoring" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Monitoring</CardTitle>
            <CardDescription>The full monitor engine (targets, checks, alert channels) lives in the main Monitoring view — these are the central aggregates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.data?.ok && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCell label="Open alerts" value={overview.data.data.totals.openAlerts} hint={overview.data.data.totals.openAlerts > 0 ? "needs attention" : "all clear"} />
                <StatCell label="Storage used" value={`${overview.data.data.storagePool.pct}%`} hint={`${overview.data.data.storagePool.usedGb} / ${overview.data.data.storagePool.poolGb} GB`} />
                <StatCell label="VaaS API calls" value={overview.data.data.totals.activePlatformKeys} hint="platform keys active" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">80% storage-pool alert raises an AlertEvent + audit row automatically on every usage sync.</p>
          </CardContent>
        </Card>
      )}

      {/* ---------- SETTINGS ---------- */}
      {sub === "settings" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Settings</CardTitle>
            <CardDescription>Central infrastructure configuration and references.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border border-border/60 p-3 space-y-1.5">
              <p className="font-medium">Object storage provider</p>
              <p className="text-xs text-muted-foreground">{prov ? `${prov.active} · ${prov.endpoint}` : "loading..."} — switch to JOY SERVICES from the Storage panel with the endpoint + access key + secret key.</p>
            </div>
            <div className="rounded-md border border-border/60 p-3 space-y-1.5">
              <p className="font-medium">Architecture document</p>
              <p className="text-xs text-muted-foreground">VORTEX_SERVER_Architecture.pdf (English) — technical architecture, database schema, API specification, infrastructure requirements and the twelve-phase roadmap. Download: <span className="font-mono">download/VORTEX_SERVER_Architecture.pdf</span></p>
            </div>
            <div className="rounded-md border border-border/60 p-3 space-y-1.5">
              <p className="font-medium">Namespaces</p>
              <div className="flex flex-wrap gap-1.5">
                {["/api/v1/admin", "/api/v1/cloud-agent", "/api/v1/vortex-website", "/api/v1/appverse", "/api/v1/vi"].map((n) => (
                  <Badge key={n} variant="outline" className="text-[10px] font-mono">{n}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* issued-key reveal dialog */}
      <Dialog open={!!issuedKey} onOpenChange={(v) => { if (!v) setIssuedKey(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Platform key issued</DialogTitle>
            <DialogDescription>Shown once — store it in the platform's server-side secret store now.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs text-muted-foreground">Key ID</Label>
              <p className="font-mono text-sm mt-1">{issuedKey?.keyId}</p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Raw key</Label>
                <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(issuedKey?.raw || ""); toast({ title: "Key copied" }); }}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                </Button>
              </div>
              <p className="font-mono text-xs rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 break-all mt-1">{issuedKey?.raw}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {issuedKey?.scopes.map((s) => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssuedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
