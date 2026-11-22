"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ReceiptText, BookOpen, Globe, Lock, Unlock, ShieldCheck, Loader2, Plus, FileText,
  Send, Ban, Banknote, Eye, Pencil, Trash2, CircleAlert, Blocks, KeyRound,
  Database, HardDrive, Boxes, Rocket, Activity, RefreshCw,
} from "lucide-react";
import {
  api, fmtDate,
  type BillingState, type InvoiceRow, type InvoiceLineRow,
  type PortalState, type DocRow, type PlanRow,
} from "../client";

function bdt(n: number): string {
  return `৳${n.toLocaleString("en-US")}`;
}

const INV_STATUS_CLASS: Record<string, string> = {
  DRAFT: "border-sky-500/40 text-sky-400",
  ISSUED: "border-amber-500/40 text-amber-400",
  PAID: "border-emerald-500/40 text-emerald-400",
  VOID: "border-border text-muted-foreground",
};

const METHOD_CLASS: Record<string, string> = {
  GET: "border-emerald-500/40 text-emerald-400",
  POST: "border-sky-500/40 text-sky-400",
  PUT: "border-amber-500/40 text-amber-400",
  PATCH: "border-amber-500/40 text-amber-400",
  DELETE: "border-red-500/40 text-red-400",
  ANY: "border-primary/40 text-primary",
};

/** Phase 7 — Firebase Mode groundwork: BILLING + DEV PORTAL + DOCS + the locked GATE. */
export default function Phase7View({ onChanged }: { onChanged: () => void }) {
  return (
    <Tabs defaultValue="billing" className="w-full">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="billing" className="gap-2">
          <ReceiptText className="w-4 h-4" /> BILLING
        </TabsTrigger>
        <TabsTrigger value="portal" className="gap-2">
          <Blocks className="w-4 h-4" /> DEV PORTAL
        </TabsTrigger>
        <TabsTrigger value="docs" className="gap-2">
          <BookOpen className="w-4 h-4" /> DOCS
        </TabsTrigger>
        <TabsTrigger value="gate" className="gap-2">
          <Lock className="w-4 h-4" /> FIREBASE GATE
        </TabsTrigger>
      </TabsList>
      <TabsContent value="billing" className="mt-4">
        <BillingTab onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="portal" className="mt-4">
        <PortalTab />
      </TabsContent>
      <TabsContent value="docs" className="mt-4">
        <DocsTab />
      </TabsContent>
      <TabsContent value="gate" className="mt-4">
        <GateTab />
      </TabsContent>
    </Tabs>
  );
}

/* ============================================================ BILLING */

function BillingTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["billing"],
    queryFn: () => api<BillingState>("/api/v1/billing"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function post(body: Record<string, unknown>, okTitle: string) {
    const res = await api("/api/v1/billing", { method: "POST", body });
    if (res.ok) {
      toast({ title: okTitle });
      reload();
    } else {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
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

  const unpaid = data.invoices.filter((i) => i.status === "ISSUED").reduce((a, i) => a + i.totalBdt, 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">BILLING — showback for the owner&apos;s apps</h3>
        <p className="text-sm text-muted-foreground">
          Real metering from the platform (gateway, storage, compute, AI, databases, CDN), priced on a BDT
          rate card. <span className="text-foreground">Nothing is charged externally</span> — mode is
          {" "}<Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">{data.mode}</Badge>
          {" "}and external plans refuse to activate while the Firebase gate is locked.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Projected · {data.period}</p>
              <ReceiptText className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{bdt(data.stats.showbackMonthBdt)}</p>
            <p className="text-xs text-muted-foreground mt-1">live meter across {data.stats.subsActive} apps</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Settled · {data.recentPeriod}</p>
              <Banknote className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{bdt(data.stats.showbackLastMonthBdt)}</p>
            <p className="text-xs text-muted-foreground mt-1">{bdt(unpaid)} still open on ISSUED invoices</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Invoices</p>
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.invoicesTotal}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.invoicesDraft} draft · {data.stats.invoicesIssued} issued · {data.stats.invoicesPaid} paid
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Budget warnings</p>
              <CircleAlert className={`w-4 h-4 ${data.stats.overBudget > 0 ? "text-red-400" : "text-primary"}`} />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.overBudget}</p>
            <p className="text-xs text-muted-foreground mt-1">{data.stats.usageRecords} usage records on file</p>
          </CardContent>
        </Card>
      </div>

      {/* Live projections per app */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h4 className="font-semibold">Live showback — {data.period} (metered as you look)</h4>
            <SubscribeDialog
              apps={data.apps.filter((a) => !a.subscribed)}
              plans={data.plans.filter((p) => p.audience === "INTERNAL" && p.isActive)}
              onCreate={(b) => post({ op: "subscribe", ...b }, "Subscription created")}
            />
          </div>
          <div className="space-y-2">
            {data.projections.length === 0 && (
              <p className="text-sm text-muted-foreground">No active subscriptions yet.</p>
            )}
            {data.projections.map((p) => {
              const sub = data.subscriptions.find((s) => s.subId === p.subId);
              if (!sub) return null;
              const top = p.priced.lines.filter((l) => l.quantity > 0).slice(0, 3);
              return (
                <div key={p.subId} className="rounded-lg border border-border/50 px-3 py-2.5 flex flex-col lg:flex-row lg:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{sub.app.name}</p>
                      <Badge variant="outline" className="text-[10px]">{sub.plan.code}</Badge>
                      {p.overBudget && (
                        <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400">
                          over budget {bdt(p.budget || 0)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {top.map((l) => `${l.quantity.toLocaleString("en-US")} ${l.unit}`).join(" · ") || "no usage metered yet"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold">{bdt(p.priced.totalBdt)}</p>
                    <p className="text-[10px] text-muted-foreground">incl. ৳{p.priced.taxBdt} VAT</p>
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <InvoiceDraftDialog
                      period={data.period}
                      onGenerate={(appId, period) => post({ op: "generate_invoice", appId, period }, `Draft invoice generated for ${period}`)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Budgets are warnings, not caps — breaching one raises a BUDGET_BREACH fan-out in NOTIFY.
          </p>
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3">Plans</h4>
            <div className="space-y-2">
              {data.plans.map((p) => (
                <div key={p.planId} className="rounded-lg border border-border/50 px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{p.name}</p>
                    <Badge variant="outline" className="text-[10px]">{p.code}</Badge>
                    {p.audience === "EXTERNAL_RESERVED" && (
                      <Badge variant="outline" className="text-[10px] border-amber-600/40 text-amber-500">
                        <Lock className="w-3 h-3 mr-1" /> Firebase reserve
                      </Badge>
                    )}
                    {p.isDefault && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">default</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.note}</p>
                  <p className="text-xs mt-1.5">
                    <span className="text-foreground font-medium">{p.monthlyBaseBdt === 0 ? "No base" : `${bdt(p.monthlyBaseBdt)}/mo base`}</span>
                    {" · allowance: "}
                    {(p.inclApiCalls / 1_000_000).toFixed(1)}M calls · {(p.inclStorageMb / 1024).toFixed(0)} GB storage ·{" "}
                    {p.inclComputeHours} h compute · {(p.inclAiTokens / 1_000_000).toFixed(1)}M tokens
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p._count.subscriptions} app(s) on this plan</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h4 className="font-semibold mb-1">Rate card (over-allowance, BDT)</h4>
            <p className="text-xs text-muted-foreground mb-3">What one more unit costs beyond the plan allowance — rounded up, never under-counted.</p>
            <div className="space-y-1.5">
              {data.rateCard.map((r) => (
                <div key={r.metric} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{r.label}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{r.metric}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{bdt(r.rateBdt)}</p>
                    <p className="text-[10px] text-muted-foreground">per {r.per.toLocaleString("en-US")} {r.unit}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices */}
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold mb-3">Showback invoices</h4>
          <div className="space-y-2">
            {data.invoices.length === 0 && (
              <p className="text-sm text-muted-foreground">No invoices yet — generate a draft from the live meter above.</p>
            )}
            {data.invoices.map((inv) => (
              <InvoiceRowCard key={inv.invoiceId} inv={inv} onIssue={(id) => post({ op: "issue_invoice", invoiceId: id }, "Invoice issued — fan-out sent")} onPaid={(id) => post({ op: "invoice_action", invoiceId: id, action: "paid" }, "Invoice settled")} onVoid={(id) => post({ op: "invoice_action", invoiceId: id, action: "void" }, "Invoice voided")} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceDraftDialog({ period, onGenerate }: { period: string; onGenerate: (appId: string, period: string) => void }) {
  const [appId, setAppId] = useState("");
  const [per, setPer] = useState(period);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="w-3.5 h-3.5 mr-1" /> Invoice</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate showback draft</DialogTitle>
          <DialogDescription>
            Meters the live platform data for the period and prices it against the app&apos;s plan allowance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>App</Label>
            <AppPicker onPick={setAppId} />
          </div>
          <div>
            <Label>Period (YYYY-MM)</Label>
            <Input value={per} onChange={(e) => setPer(e.target.value)} placeholder={period} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!appId || !/^\d{4}-\d{2}$/.test(per)}
            onClick={() => {
              onGenerate(appId, per);
              setOpen(false);
            }}
          >
            Generate draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** App picker backed by the billing state (passed via closure-free fetch to keep it simple). */
function AppPicker({ onPick }: { onPick: (appId: string) => void }) {
  const q = useQuery({
    queryKey: ["billing-apps-picker"],
    queryFn: () => api<BillingState>("/api/v1/billing"),
  });
  const apps = (q.data?.ok ? q.data.data?.apps : null) || [];
  return (
    <Select onValueChange={onPick}>
      <SelectTrigger><SelectValue placeholder="Choose an app" /></SelectTrigger>
      <SelectContent>
        {apps.map((a) => (
          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SubscribeDialog({
  apps,
  plans,
  onCreate,
}: {
  apps: BillingState["apps"];
  plans: PlanRow[];
  onCreate: (b: Record<string, unknown>) => void;
}) {
  const [appId, setAppId] = useState("");
  const [planId, setPlanId] = useState("");
  const [budget, setBudget] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="w-3.5 h-3.5 mr-1" /> Subscribe app</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Subscribe an app to a plan</DialogTitle>
          <DialogDescription>Only INTERNAL plans can be activated — the Firebase reserve stays locked.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>App</Label>
            <Select onValueChange={setAppId}>
              <SelectTrigger><SelectValue placeholder="Choose an app" /></SelectTrigger>
              <SelectContent>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Plan</Label>
            <Select onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monthly showback budget (BDT, optional)</Label>
            <Input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 50000" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!appId || !planId}
            onClick={() => {
              onCreate({ appId, planId, budgetMonthlyBdt: budget ? Number(budget) : null });
              setOpen(false);
            }}
          >
            Subscribe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceRowCard({
  inv, onIssue, onPaid, onVoid,
}: {
  inv: InvoiceRow;
  onIssue: (id: string) => void;
  onPaid: (id: string) => void;
  onVoid: (id: string) => void;
}) {
  let lines: InvoiceLineRow[] = [];
  try {
    lines = JSON.parse(inv.lines) as InvoiceLineRow[];
  } catch {
    lines = [];
  }
  const priced = lines.filter((l) => l.costBdt > 0);

  return (
    <div className="rounded-lg border border-border/50 px-3 py-2.5 flex flex-col lg:flex-row lg:items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-mono text-sm text-primary">{inv.number}</p>
          <Badge variant="outline" className={`text-[10px] ${INV_STATUS_CLASS[inv.status] || ""}`}>{inv.status}</Badge>
          <Badge variant="outline" className="text-[10px]">{inv.mode}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {inv.app.name} · {inv.period} · issued {fmtDate(inv.issuedAt)}{inv.paidAt ? ` · paid ${fmtDate(inv.paidAt)}` : ""}
          {priced.length > 0 ? ` · ${priced.length} priced line(s)` : " · all within allowance"}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold">{bdt(inv.totalBdt)}</p>
        <p className="text-[10px] text-muted-foreground">base {bdt(inv.subtotalBdt)} + VAT {bdt(inv.taxBdt)}</p>
      </div>
      <div className="shrink-0 flex gap-2 flex-wrap">
        <LinesDialog inv={inv} lines={lines} />
        {inv.status === "DRAFT" && (
          <Button size="sm" variant="outline" onClick={() => onIssue(inv.invoiceId)}><Send className="w-3.5 h-3.5 mr-1" /> Issue</Button>
        )}
        {inv.status === "ISSUED" && (
          <>
            <Button size="sm" variant="outline" onClick={() => onPaid(inv.invoiceId)}><Banknote className="w-3.5 h-3.5 mr-1" /> Mark paid</Button>
            <Button size="sm" variant="ghost" onClick={() => onVoid(inv.invoiceId)}><Ban className="w-3.5 h-3.5 mr-1" /> Void</Button>
          </>
        )}
      </div>
    </div>
  );
}

function LinesDialog({ inv, lines }: { inv: InvoiceRow; lines: InvoiceLineRow[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Eye className="w-3.5 h-3.5 mr-1" /> Lines</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{inv.number} — {inv.app.name}</DialogTitle>
          <DialogDescription>
            {inv.period} · {inv.mode} · {inv.status} — quantities metered from real platform tables.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/60">
                <th className="py-2 pr-2">Metric</th>
                <th className="py-2 pr-2 text-right">Used</th>
                <th className="py-2 pr-2 text-right">Included</th>
                <th className="py-2 pr-2 text-right">Billable</th>
                <th className="py-2 pr-2 text-right">Rate</th>
                <th className="py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.metric} className="border-b border-border/40">
                  <td className="py-2 pr-2">
                    <p className="font-medium">{l.label}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{l.metric}</p>
                  </td>
                  <td className="py-2 pr-2 text-right font-mono">{l.quantity.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-2 text-right font-mono text-muted-foreground">{l.included.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-2 text-right font-mono">{l.billable.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-2 text-right text-muted-foreground">৳{l.rateBdt}/{l.per.toLocaleString("en-US")}</td>
                  <td className="py-2 text-right font-medium">{bdt(l.costBdt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
        <div className="flex justify-end gap-4 text-sm">
          <span className="text-muted-foreground">Base {bdt(inv.subtotalBdt)}</span>
          <span className="text-muted-foreground">VAT {bdt(inv.taxBdt)}</span>
          <span className="font-semibold">{bdt(inv.totalBdt)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================ DEV PORTAL */

function PortalTab() {
  const q = useQuery({
    queryKey: ["portal"],
    queryFn: () => api<PortalState>("/api/v1/portal"),
    refetchInterval: 30_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">DEV PORTAL — internal developer hub</h3>
        <p className="text-sm text-muted-foreground">
          For the owner&apos;s own team across the {data.integrations.length} apps: the real API catalog
          (generated from the live route surface) and per-app integration status. External onboarding stays locked.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Endpoints catalogued</p>
            <p className="text-2xl font-bold mt-2">{data.stats.endpoints}</p>
            <p className="text-xs text-muted-foreground mt-1">across {data.stats.endpointGroups} module groups</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Guides on file</p>
            <p className="text-2xl font-bold mt-2">{data.stats.docsTotal}</p>
            <p className="text-xs text-muted-foreground mt-1">{data.stats.docsInternal} internal · {data.stats.docsPublic} public</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Apps integrated</p>
            <p className="text-2xl font-bold mt-2">{data.integrations.filter((i) => i.activeKeys > 0).length}/{data.integrations.length}</p>
            <p className="text-xs text-muted-foreground mt-1">have active API keys</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Gate</p>
            <p className="text-2xl font-bold mt-2 flex items-center gap-2"><Lock className="w-5 h-5 text-amber-500" /> {data.mode}</p>
            <p className="text-xs text-muted-foreground mt-1">publishing enforced server-side</p>
          </CardContent>
        </Card>
      </div>

      {/* Integration status */}
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold mb-3">Per-app integration status</h4>
          <div className="grid gap-2 md:grid-cols-2">
            {data.integrations.map((i) => (
              <div key={i.appId} className="rounded-lg border border-border/50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{i.name}</p>
                  <Badge variant="outline" className="text-[10px]">{i.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> {i.activeKeys} keys</span>
                  <span className="inline-flex items-center gap-1"><Database className="w-3 h-3" /> {i.databases.length ? i.databases.join(", ") : "no db"}</span>
                  <span className="inline-flex items-center gap-1"><HardDrive className="w-3 h-3" /> {i.buckets} buckets · {i.objects} objects</span>
                  <span className="inline-flex items-center gap-1"><Boxes className="w-3 h-3" /> {i.workloads} workloads</span>
                  <span className="inline-flex items-center gap-1"><Rocket className="w-3 h-3" /> {i.liveDeploys} live deploys</span>
                  <span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> {i.gatewayHits.toLocaleString("en-US")} edge hits</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* API reference */}
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold mb-1">API reference — the real surface</h4>
          <p className="text-xs text-muted-foreground mb-3">Every entry exists in this control plane. One envelope everywhere: <code className="font-mono text-primary">{`{ok, data, error}`}</code>.</p>
          <div className="space-y-3">
            {data.apiRef.map((g) => (
              <div key={g.area} className="rounded-lg border border-border/50">
                <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{g.area}</p>
                  <Badge variant="outline" className="text-[10px]">P{g.phase}</Badge>
                  <span className="text-xs text-muted-foreground">{g.module}</span>
                </div>
                <div className="divide-y divide-border/40">
                  {g.entries.map((e) => (
                    <div key={`${e.method}-${e.path}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-1.5">
                      <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${METHOD_CLASS[e.method] || ""}`}>{e.method}</Badge>
                      <code className="text-xs font-mono text-foreground shrink-0">{e.path}</code>
                      <span className="text-xs text-muted-foreground min-w-0">{e.desc}</span>
                      <Badge variant="outline" className="text-[10px] sm:ml-auto shrink-0">{e.auth}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ DOCS */

function DocsTab() {
  const q = useQuery({
    queryKey: ["portal-docs"],
    queryFn: () => api<PortalState>("/api/v1/portal"),
    refetchInterval: 30_000,
  });
  const data = q.data?.ok ? q.data.data : null;
  const [selected, setSelected] = useState<string>("");

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  const docs = data.docs;
  const current: DocRow | null = docs.find((d) => d.docId === selected) || docs[0] || null;

  async function post(body: Record<string, unknown>, okTitle: string, allowFail = false) {
    const res = await api("/api/v1/portal", { method: "POST", body });
    if (res.ok) {
      toast({ title: okTitle });
      q.refetch();
    } else if (!allowFail) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    } else {
      // expected failure — the gate demonstrating itself
      toast({ title: "Gate held the line", description: res.error, variant: "destructive" });
      q.refetch();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold">DOCS engine — internal by default</h3>
          <p className="text-sm text-muted-foreground">
            Markdown docs stored in the control plane. Visibility <Badge variant="outline" className="text-[10px]">INTERNAL</Badge> is the
            default; PUBLIC requires the Firebase gate — enforced on the server, not the UI.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
          <DocEditDialog onSave={(b) => post({ op: "save_doc", ...b }, "Doc saved")} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="p-3">
            <ScrollArea className="max-h-[560px]">
              <div className="space-y-1">
                {docs.map((d) => (
                  <button
                    key={d.docId}
                    onClick={() => setSelected(d.docId)}
                    className={`w-full text-left rounded-lg px-3 py-2 transition-colors border ${
                      current?.docId === d.docId
                        ? "bg-primary/15 text-primary border-primary/25"
                        : "text-muted-foreground hover:bg-accent border-transparent"
                    }`}
                  >
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-[10px] mt-0.5 flex items-center gap-1.5">
                      <span>{d.category}</span>
                      {d.visibility === "PUBLIC" && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0">PUBLIC</Badge>
                      )}
                      {d.isSystem && <span className="text-[9px]">system</span>}
                    </p>
                  </button>
                ))}
                {docs.length === 0 && <p className="text-sm text-muted-foreground px-3 py-2">No docs yet.</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            {current ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h4 className="font-semibold">{current.title}</h4>
                    <p className="text-xs text-muted-foreground font-mono">/{current.slug} · updated {fmtDate(current.updatedAt)} by {current.updatedBy || "system"}</p>
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <DocEditDialog doc={current} onSave={(b) => post({ op: "save_doc", ...b }, "Doc updated")} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => post({ op: "toggle_public", docId: current.docId }, current.visibility === "PUBLIC" ? "Back to internal" : "Published — the gate allowed it", true)}
                    >
                      <Globe className="w-3.5 h-3.5 mr-1" />
                      {current.visibility === "PUBLIC" ? "Unpublish" : "Publish"}
                    </Button>
                    {!current.isSystem && (
                      <Button size="sm" variant="ghost" onClick={() => post({ op: "delete_doc", docId: current.docId }, "Doc deleted")}>
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/50 p-4 bg-card/60 text-sm leading-relaxed vortex-docs">
                  <Markdown
                    components={{
                      h1: (p) => <h1 className="text-lg font-bold mt-3 mb-2 first:mt-0" {...p} />,
                      h2: (p) => <h2 className="text-base font-semibold mt-4 mb-2" {...p} />,
                      h3: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5" {...p} />,
                      p: (p) => <p className="my-2 text-muted-foreground leading-relaxed" {...p} />,
                      ul: (p) => <ul className="list-disc pl-5 my-2 space-y-1 text-muted-foreground" {...p} />,
                      ol: (p) => <ol className="list-decimal pl-5 my-2 space-y-1 text-muted-foreground" {...p} />,
                      li: (p) => <li {...p} />,
                      code: (p) => <code className="font-mono text-xs text-primary" {...p} />,
                      pre: (p) => <pre className="rounded-lg border border-border/60 bg-background/80 p-3 my-2 overflow-x-auto text-xs font-mono text-foreground" {...p} />,
                      a: (p) => <a className="text-primary underline underline-offset-4" {...p} />,
                      strong: (p) => <strong className="text-foreground" {...p} />,
                    }}
                  >
                    {current.body}
                  </Markdown>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No doc selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DocEditDialog({ doc, onSave }: { doc?: DocRow; onSave: (b: Record<string, unknown>) => void }) {
  const [slug, setSlug] = useState(doc?.slug || "");
  const [title, setTitle] = useState(doc?.title || "");
  const [category, setCategory] = useState(doc?.category || "GUIDES");
  const [body, setBody] = useState(doc?.body || "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {doc ? <><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</> : <><Plus className="w-3.5 h-3.5 mr-1" /> New doc</>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc ? `Edit — ${doc.title}` : "New doc"}</DialogTitle>
          <DialogDescription>Markdown body. New docs always start INTERNAL.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-guide" disabled={!!doc?.isSystem && doc.slug === doc.slug ? false : false} />
            </div>
            <div className="sm:col-span-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How to …" />
            </div>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GET_STARTED">GET_STARTED</SelectItem>
                <SelectItem value="API_REFERENCE">API_REFERENCE</SelectItem>
                <SelectItem value="GUIDES">GUIDES</SelectItem>
                <SelectItem value="POLICY">POLICY</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Body (markdown)</Label>
            <textarea
              className="w-full h-56 rounded-lg border border-border/60 bg-background/80 p-3 text-sm font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the guide…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !slug || !title || body.trim().length < 20}
            onClick={() => {
              setBusy(true);
              onSave({ docId: doc?.docId, slug, title, category, body });
              setBusy(false);
              setOpen(false);
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save doc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================ GATE */

function GateTab() {
  const q = useQuery({
    queryKey: ["portal-gate"],
    queryFn: () => api<PortalState>("/api/v1/portal"),
  });
  const data = q.data?.ok ? q.data.data : null;
  const [testing, setTesting] = useState(false);
  const gateOpen = data?.mode !== "LOCKED";

  async function testGate() {
    if (!data) return;
    const policyDoc = data.docs.find((d) => d.slug === "firebase-mode-policy") || data.docs[0];
    if (!policyDoc) return;
    setTesting(true);
    const res = await api("/api/v1/portal", { method: "POST", body: { op: "toggle_public", docId: policyDoc.docId } });
    setTesting(false);
    if (!res.ok) {
      toast({ title: "Gate held (HTTP 423)", description: res.error, variant: "destructive" });
      q.refetch();
    } else if (gateOpen) {
      toast({ title: "Publish succeeded", description: "The gate is OPEN — visibility toggled. Phase 8 made this legal." });
      q.refetch();
    } else {
      toast({ title: "Unexpected: the gate is open", description: "future.firebase_mode is no longer LOCKED." });
    }
  }

  if (!data) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      <Card className={gateOpen ? "border-emerald-600/40" : "border-amber-600/30"}>
        <CardContent className="p-6">
          <div className="flex items-start gap-4 flex-col md:flex-row md:items-center justify-between">
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${gateOpen ? "bg-emerald-500/10 border-emerald-600/30" : "bg-amber-500/10 border-amber-600/30"}`}>
                {gateOpen ? <Unlock className="w-6 h-6 text-emerald-500" /> : <Lock className="w-6 h-6 text-amber-500" />}
              </div>
              <div>
                <h3 className="text-lg font-semibold">Firebase Mode: <span className={gateOpen ? "text-emerald-500" : "text-amber-500"}>{data.mode}</span></h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                  {gateOpen ? (
                    <>
                      The owner flipped the gate — the Phase 7 reserve became <span className="text-foreground">VORTEX AS A SERVICE (Phase 8)</span>.
                      Public docs publishing now succeeds, EXTERNAL plans activate, and the public SDK surface is live at
                      <code className="font-mono text-xs text-primary"> /api/vaas/v1</code>. The same server-side enforcement
                      still guards the switch: re-locking here closes all of it again, instantly.
                    </>
                  ) : (
                    <>
                      Phase 7 is built and live — <span className="text-foreground">internally</span>. The BILLING, portal and docs
                      engines serve the owner&apos;s apps today. What stays locked is everything that would make VORTEX public:
                      external developers, public docs, charged plans. That is the owner&apos;s standing decision, enforced on the
                      server (<code className="font-mono text-xs text-primary">future.firebase_mode = LOCKED</code>), audited on every attempt.
                    </>
                  )}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={testGate} disabled={testing}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {gateOpen ? "Toggle public visibility" : "Test the publish gate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Shipped live in Phase 7 (internal)</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><ReceiptText className="w-4 h-4 text-primary shrink-0 mt-0.5" /> BILLING: live metering of real platform usage, BDT rate card, monthly showback invoices, budget warnings with NOTIFY fan-out.</li>
              <li className="flex gap-2"><Blocks className="w-4 h-4 text-primary shrink-0 mt-0.5" /> DEV PORTAL: real API catalog ({data.stats.endpoints} endpoints), per-app integration status for the owner&apos;s team.</li>
              <li className="flex gap-2"><BookOpen className="w-4 h-4 text-primary shrink-0 mt-0.5" /> DOCS engine: markdown guides in the control plane, {data.stats.docsTotal} seeded, editable.</li>
              <li className="flex gap-2"><Lock className="w-4 h-4 text-primary shrink-0 mt-0.5" /> The gate: publish attempts rejected with HTTP 423 while LOCKED — forward compatibility without a rewrite.</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4 text-amber-500" /> {gateOpen ? "What the open gate unlocked (Phase 8)" : "Stays locked (owner decision)"}</h4>
            {gateOpen ? (
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><Unlock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> Public developer signup via the VaaS SDK surface — still one config flip away from closing.</li>
                <li className="flex gap-2"><Unlock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> EXTERNAL plans (VAAS_FREE / VAAS_PRO) are now active — the billing pipeline was already here.</li>
                <li className="flex gap-2"><Unlock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> The VaaS quickstart and comparison docs publish PUBLIC.</li>
                <li className="flex gap-2"><ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" /> The control plane stays private: this dashboard, the owner&apos;s apps and NEXSEVA data residency are unchanged.</li>
              </ul>
            ) : (
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>No public signup — accounts are created by the owner only.</li>
                <li>No third-party developers: the ecosystem serves the owner&apos;s 46+ apps, nothing else.</li>
                <li>No external charges: EXTERNAL_* plans exist as reserve rows and refuse activation.</li>
                <li>No public docs: visibility cannot leave INTERNAL while the gate is LOCKED.</li>
                <li>NEXSEVA data-localization posture stays fully internal — nothing leaves the ecosystem.</li>
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground mt-4 border-t border-border/60 pt-3">
              {gateOpen ? (
                <>The gate lives in <code className="font-mono text-primary">VaaS (P8)</code> — flip it back to LOCKED and every public door closes at once, no deploy needed.</>
              ) : (
                <>If the owner ever changes their mind: flip <code className="font-mono text-primary">future.firebase_mode</code> and the
                reserve becomes an offering — no rewrite, no migration. Until then, it stays a locked door with the keys labelled.</>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
