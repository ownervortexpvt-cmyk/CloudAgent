"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Boxes,
  KeyRound,
  ListChecks,
  Mail,
  Bell,
  BrainCircuit,
  ScrollText,
  Settings2,
  Server,
  ServerCog,
  Database,
  ArchiveRestore,
  HeartPulse,
  Network,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Globe,
  HardDrive,
  FolderOpen,
  Rocket,
  GitBranch,
  Sparkles,
  ReceiptText,
  Flame,
  Gauge,
} from "lucide-react";
import { api, type Overview, fmtDate, fmtAgo, fmtSize, PHASES } from "./client";
import { VortexMark } from "./login";
// v151 — ecosystem i18n (English default / বাংলা / हिन्दी) + one-platform shortcuts
import { useLang, setLang, LANGS } from "@/lib/i18n";
import { platformLinks } from "@/lib/platform-links";
import { ExternalLink } from "lucide-react";
import ServicesView from "./views/services";
import ServersView from "./views/servers";
import NetworkView from "./views/network";
import DatabasesView from "./views/databases";
import BackupsView from "./views/backups";
import MonitoringView from "./views/monitoring";
import GatewayView from "./views/gateway";
import StorageView from "./views/storage";
import FilesView from "./views/files";
import SecurityView from "./views/security";
import DeploysView from "./views/deploys";
import DevopsView from "./views/devops";
import ExpansionView from "./views/expansion";
import Phase7View from "./views/phase7";
import VaasView from "./views/vaas";
import AppsView from "./views/apps";
import KeysView from "./views/keys";
import ConfigView from "./views/config";
import LogsView from "./views/logs";
import RoadmapView from "./views/roadmap";
import ServerView from "./views/server";

type ViewKey = "overview" | "services" | "servers" | "network" | "databases" | "backups" | "monitoring" | "gateway" | "storage" | "files" | "security" | "deploys" | "devops" | "expansion" | "phase7" | "vaas" | "apps" | "keys" | "config" | "logs" | "roadmap" | "vserver";

const NAV_KEYS: { key: ViewKey; i18n: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", i18n: "nav.overview", icon: Activity },
  { key: "vserver", i18n: "nav.vserver", icon: Gauge },
  { key: "services", i18n: "nav.services", icon: Server },
  { key: "servers", i18n: "nav.servers", icon: ServerCog },
  { key: "network", i18n: "nav.network", icon: Network },
  { key: "databases", i18n: "nav.databases", icon: Database },
  { key: "backups", i18n: "nav.backups", icon: ArchiveRestore },
  { key: "monitoring", i18n: "nav.monitoring", icon: HeartPulse },
  { key: "gateway", i18n: "nav.gateway", icon: Globe },
  { key: "storage", i18n: "nav.storage", icon: HardDrive },
  { key: "files", i18n: "nav.files", icon: FolderOpen },
  { key: "security", i18n: "nav.security", icon: ShieldAlert },
  { key: "deploys", i18n: "nav.deploys", icon: Rocket },
  { key: "devops", i18n: "nav.devops", icon: GitBranch },
  { key: "expansion", i18n: "nav.expansion", icon: Sparkles },
  { key: "phase7", i18n: "nav.phase7", icon: ReceiptText },
  { key: "vaas", i18n: "nav.vaas", icon: Flame },
  { key: "apps", i18n: "nav.apps", icon: Boxes },
  { key: "keys", i18n: "nav.keys", icon: KeyRound },
  { key: "config", i18n: "nav.config", icon: Settings2 },
  { key: "logs", i18n: "nav.logs", icon: ScrollText },
  { key: "roadmap", i18n: "nav.roadmap", icon: ListChecks },
];

export default function Dashboard({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  // v151 — deep-link support: /?view=apps opens a view directly (used by the
  // APPVERSE shortcut from the other modules of this one platform).
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "overview";
    const v = new URLSearchParams(window.location.search).get("view");
    return NAV_KEYS.some((n) => n.key === v) ? (v as ViewKey) : "overview";
  });
  // v151 — the whole control plane follows the ecosystem language
  const { lang, t } = useLang();

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/api/v1/overview"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data?.ok ? overviewQuery.data.data ?? null : null;

  const refresh = () => {
    overviewQuery.refetch();
  };

  return (
    <div className="min-h-screen vortex-bg flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border/60 bg-sidebar/60 backdrop-blur">
        <div className="px-5 py-5 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <VortexMark className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-bold tracking-[0.25em] text-sm">VORTEX</p>
              <p className="text-[10px] text-muted-foreground tracking-wider">CONTROL PLANE</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_KEYS.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? "page" : undefined}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                view === item.key
                  ? "bg-primary/15 text-primary font-medium border border-primary/25"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {t(item.i18n)}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border/60">
          <div className="rounded-lg bg-card/70 border border-border/60 p-3 mb-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mode: PRIVATE</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span>CORE v{overview?.version || "…"}</span>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start" onClick={onLogout}>
            <LogOut className="w-4 h-4 mr-2" /> {t("nav.signOut")}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="flex items-center justify-between px-4 md:px-6 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="md:hidden w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <VortexMark className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold truncate">{t(NAV_KEYS.find((n) => n.key === view)?.i18n ?? "nav.overview")}</h2>
                <p className="text-xs text-muted-foreground truncate">
                  {overview
                    ? `${overview.stats.servicesOnline} modules online · ${overview.stats.serversRunning} nodes · ${overview.stats.dbsRunning} databases up${overview.stats.alertsOpen > 0 ? ` · ${overview.stats.alertsOpen} alerts open` : ""}`
                    : "…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* v151 — ecosystem language switcher: English / বাংলা / हिन्दी */}
              <div className="hidden sm:flex items-center gap-0.5 rounded-full border border-border/60 bg-card/70 p-0.5" aria-label="Language">
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLang(l.id)}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                      lang === l.id ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {l.native}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="icon" aria-label="Refresh data" onClick={refresh}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-border/60 bg-card/70 pl-1 pr-3 py-1">
                <span className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                  {userEmail.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground max-w-[160px] truncate">{userEmail}</span>
              </div>
            </div>
          </div>
          {/* Mobile nav */}
          <div className="md:hidden flex overflow-x-auto vortex-scroll gap-1 px-3 pb-2">
            {NAV_KEYS.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs border transition-colors ${
                  view === item.key
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground border-border/60"
                }`}
              >
                <item.icon className="w-3.5 h-3.5" />
                {t(item.i18n)}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          {view === "overview" && (
            <OverviewView overview={overview} onNavigate={setView} onHeartbeatDemo={refresh} />
          )}
          {view === "services" && <ServicesView onChanged={refresh} />}
          {view === "servers" && <ServersView onChanged={refresh} />}
          {view === "network" && <NetworkView onChanged={refresh} />}
          {view === "databases" && <DatabasesView onChanged={refresh} />}
          {view === "backups" && <BackupsView onChanged={refresh} />}
          {view === "monitoring" && <MonitoringView onChanged={refresh} />}
          {view === "gateway" && <GatewayView onChanged={refresh} />}
          {view === "storage" && <StorageView onChanged={refresh} />}
          {view === "files" && <FilesView onChanged={refresh} />}
          {view === "vserver" && <ServerView />}
          {view === "security" && <SecurityView onChanged={refresh} />}
          {view === "deploys" && <DeploysView onChanged={refresh} />}
          {view === "devops" && <DevopsView onChanged={refresh} />}
          {view === "expansion" && <ExpansionView onChanged={refresh} />}
          {view === "phase7" && <Phase7View onChanged={refresh} />}
          {view === "vaas" && <VaasView onChanged={refresh} />}
          {view === "apps" && <AppsView onChanged={refresh} />}
          {view === "keys" && <KeysView onChanged={refresh} />}
          {view === "config" && <ConfigView onChanged={refresh} />}
          {view === "logs" && <LogsView onChanged={refresh} />}
          {view === "roadmap" && <RoadmapView services={overview?.phases ?? []} />}
        </main>

        <footer className="mt-auto border-t border-border/60 px-6 py-3 text-center text-xs text-muted-foreground">
          VORTEX — control plane private & proprietary; the public face is VaaS (Phase 8): projects, keys, auth, data, storage, realtime, functions. SDK: /vortex-sdk.js
        </footer>
      </div>
    </div>
  );
}

function OverviewView({
  overview,
  onNavigate,
  onHeartbeatDemo,
}: {
  overview: Overview | null;
  onNavigate: (v: ViewKey) => void;
  onHeartbeatDemo: () => void;
}) {
  if (!overview) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  const s = overview.stats;
  const cards = [
    { label: "Modules Online", value: `${s.servicesOnline}/${s.servicesTotal}`, icon: Server, hint: `${s.servicesBuilding} building · ${s.servicesPlanned} planned` },
    { label: "Nodes Running", value: `${s.serversRunning}/${s.serversTotal}`, icon: Layers, hint: `${s.cpuAllocated} vCPU · ${(s.ramAllocatedMb / 1024).toFixed(1)} GB RAM` },
    { label: "Databases Up", value: `${s.dbsRunning}/${s.dbsTotal}`, icon: Database, hint: `${s.dbsSizeGb} GB provisioned for apps` },
    { label: "Monitors Up", value: `${s.monitorsUp}/${s.monitorsTotal}`, icon: HeartPulse, hint: `health checks every minute` },
    { label: "Backups", value: `${s.backupsCount}`, icon: ArchiveRestore, hint: `${s.backupsSizeGb} GB encrypted${s.lastBackupAt ? ` · last ${fmtAgo(s.lastBackupAt)}` : ""}` },
    { label: "Gateway 24h", value: `${s.gwRequests24h}`, icon: Globe, hint: `${s.gwRoutesActive} routes · ${s.gwBlocked24h} blocked`, danger: s.gwBlocked24h > 40 },
    { label: "Storage", value: fmtSize(s.storageUsedMb), icon: HardDrive, hint: `${s.storageBuckets} buckets · ${s.storageObjects} objects · 3x replicas` },
    { label: "Security 24h", value: `${s.secEvents24h}`, icon: ShieldAlert, hint: `${s.wafRulesEnabled} WAF rules armed · ${s.ipBlocksActive} IPs blocked`, danger: s.secEvents24h > 60 },
    { label: "Deployments", value: `${s.deploysRunning} live`, icon: Rocket, hint: s.deploysInflight > 0 ? `${s.deploysInflight} shipping right now` : "all apps healthy" },
    { label: "CI/CD", value: `${s.pipelinesActive} pipelines`, icon: GitBranch, hint: `${s.pipelineRunsTotal} runs recorded` },
    { label: "SSL Certificates", value: `${s.sslActive}`, icon: ShieldCheck, hint: s.sslExpiringSoon > 0 ? `${s.sslExpiringSoon} expiring within 14 days` : "auto-renew armed", danger: s.sslExpiringSoon > 0 },
    { label: "Mail (24h)", value: `${s.mailsLast24h}`, icon: Mail, hint: s.mailsFailed > 0 ? `${s.mailsFailed} failed — retryable` : "outbox healthy", danger: s.mailsFailed > 0 },
    { label: "Notifications", value: `${s.notifyUnread} unread`, icon: Bell, hint: "fan-out: feed · email · webhooks" },
    { label: "CDN", value: `${s.cdnDists} dists`, icon: Globe, hint: `${s.cdnHitRate}% cache hit at the edge` },
    { label: "Compute", value: `${s.computeRunning}/${s.computeTotal}`, icon: Boxes, hint: "runtime workloads on app nodes" },
    { label: "AI Infra", value: `${s.aiModelsReady}/${s.aiModelsTotal} models`, icon: BrainCircuit, hint: `${s.aiJobs24h} inference jobs in 24h` },
    { label: "Open Alerts", value: `${s.alertsOpen}`, icon: HeartPulse, hint: s.alertsOpen > 0 ? "needs attention" : "everything healthy", danger: s.alertsOpen > 0 },
    { label: "IPs Free", value: `${s.ipsFree}/${s.ipsTotal}`, icon: Activity, hint: `${s.firewallRulesActive} firewall rules active` },
    { label: "Apps Inside", value: s.appsTotal, icon: Boxes, hint: `${s.keysActive} active API keys` },
    { label: "Billing Showback", value: `৳${s.billingShowbackMonthBdt.toLocaleString("en-US")}`, icon: ReceiptText, hint: `${s.billingSubsActive} apps metered · ${s.billingInvoices} invoices${s.billingOverBudget > 0 ? ` · ${s.billingOverBudget} over budget` : ""}`, danger: s.billingOverBudget > 0 },
    { label: "Firebase Mode", value: s.firebaseMode, icon: ShieldCheck, hint: s.firebaseMode === "OPEN" ? "VAAS is live — public multi-tenant BaaS" : "external offering stays locked by owner decision" },
    { label: "VaaS Projects", value: s.vaasProjects, icon: Flame, hint: `${s.vaasDevelopers} developers · ${s.vaasEndUsers} end users${s.vaasNexaProjects > 0 ? ` · ${s.vaasNexaProjects} via NEXA` : ""}` },
    { label: "VaaS Docs & Files", value: `${s.vaasDocs} / ${s.vaasFiles}`, icon: Boxes, hint: `${s.vaasApiCalls} SDK calls this period · ${s.vaasRt24h} realtime msgs 24h` },
  ];

  return (
    <div className="space-y-6">
      {/* Hero strip */}
      <Card className="border-primary/25 overflow-hidden">
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <VortexMark className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Phase 8 is live — VORTEX AS A SERVICE, the Firebase&apos;s father.</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                The owner flipped the Phase 7 reserve: the platform is now a public, multi-tenant Backend-as-a-Service.
                Developers sign up, provision projects with CLIENT/ADMIN keys, and get end-user auth (password + OTP),
                a Firestore-style doc DB with server-side rules, storage on real 3×-replica buckets, socket.io realtime
                and sandboxed cloud functions — all metered into BDT plans, all wired into the NEXA AI app builder.
                The control plane below stays PRIVATE. Open the console:{" "}
                <button className="text-primary underline underline-offset-4" onClick={() => onNavigate("vaas")}>
                  Phase 8 — VaaS
                </button>
                .
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 w-fit">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse" />
            VAAS LIVE · CONTROL PLANE PRIVATE
          </Badge>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground tracking-wide uppercase">{c.label}</p>
                <c.icon className={`w-4 h-4 ${"danger" in c && c.danger ? "text-red-400" : "text-primary"}`} />
              </div>
              <p className="text-2xl font-bold mt-2">{c.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Phase progress */}
        <Card>
          <CardContent className="p-5">
            <h4 className="font-semibold mb-4 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-primary" /> Build phases
            </h4>
            <div className="space-y-4">
              {overview.phases.map((p) => (
                <div key={p.phase}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className={p.phase === 7 ? "text-amber-400" : ""}>{PHASES[p.phase]?.label || `Phase ${p.phase}`}</span>
                    <span className="text-muted-foreground">
                      {p.done}/{p.total} online
                    </span>
                  </div>
                  <Progress value={p.pct} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Recent audit events
              </h4>
              <Button variant="ghost" size="sm" onClick={() => onNavigate("logs")}>
                View all
              </Button>
            </div>
            <ScrollArea className="max-h-64">
              <div className="space-y-2 pr-3">
                {overview.recentAudit.length === 0 && (
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                )}
                {overview.recentAudit.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-primary truncate">{a.action}</p>
                      <p className="text-muted-foreground truncate">
                        {a.actor} → {a.resource}
                      </p>
                    </div>
                    <span className="text-muted-foreground shrink-0">{fmtDate(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Heartbeat demo */}
      <Card>
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-sm">Module heartbeat protocol</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">
              Every VORTEX module reports to CORE via <code className="font-mono text-primary">POST /api/v1/services/heartbeat</code>.
              Try it on a live module from the Service Registry.
            </p>
          </div>
          <Button variant="outline" onClick={() => onNavigate("services")}>
            <Server className="w-4 h-4 mr-2" /> Open registry
          </Button>
        </CardContent>
      </Card>
      {/* keep heartbeat callback referenced for future auto-demo */}
      <span className="hidden" onClick={onHeartbeatDemo} />
    </div>
  );
}
