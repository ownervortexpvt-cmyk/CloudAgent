"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { BrainCircuit, Loader2, Play, Coins, Gauge, Zap, Power } from "lucide-react";
import { api, fmtAgo, type AiState } from "../client";

const STATUS_CLASS: Record<string, string> = {
  READY: "border-emerald-500/40 text-emerald-400",
  LOADING: "border-sky-500/40 text-sky-400",
  OFFLINE: "border-border text-muted-foreground",
};

export default function AiView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["ai"],
    queryFn: () => api<AiState>("/api/v1/ai"),
    refetchInterval: 10_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function post(body: Record<string, unknown>, okTitle: string) {
    const res = await api("/api/v1/ai", { method: "POST", body });
    if (res.ok) {
      toast({ title: okTitle });
      reload();
      return res;
    } else {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
      return res;
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">AI INFRASTRUCTURE — model serving for NEXA</h3>
        <p className="text-sm text-muted-foreground">
          The proprietary registry: vortex-nano / mini / pro served from the runtime node with q4
          quantization. Every inference job is app-bound and token usage is counted per app — the
          groundwork for the Phase 7 BILLING reserve, never public.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Models ready</p>
              <BrainCircuit className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">
              {data.stats.modelsReady}
              <span className="text-sm text-muted-foreground font-normal">/{data.stats.modelsTotal}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">q4_KM on the serving node</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Jobs (24h)</p>
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.jobs24h}</p>
            <p className="text-xs text-muted-foreground mt-1">inference completions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Tokens in / out</p>
              <Coins className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{((data.stats.tokensIn + data.stats.tokensOut) / 1_000_000).toFixed(2)}M</p>
            <p className="text-xs text-muted-foreground mt-1">
              {(data.stats.tokensIn / 1000).toFixed(0)}K in · {(data.stats.tokensOut / 1000).toFixed(0)}K out
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Serving for</p>
              <Gauge className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">NEXA</p>
            <p className="text-xs text-muted-foreground mt-1">builder + internal tooling only</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Models */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3">Model registry</h4>
            <div className="space-y-2">
              {data.models.map((m) => (
                <div key={m.id} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.paramsB} · {m.contextK}K ctx · {m.quant}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_CLASS[m.status] || ""}`}>{m.status}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Requests</p>
                      <p className="font-mono">{m.requests.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tokens</p>
                      <p className="font-mono">{((m.tokensIn + m.tokensOut) / 1000).toFixed(0)}K</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Avg latency</p>
                      <p className="font-mono">{m.avgLatencyMs || "—"}{m.avgLatencyMs ? " ms" : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <p className="text-[10px] text-muted-foreground truncate">
                      {m.endpoint ? m.endpoint.replace("http://", "") : "no endpoint"}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => post({ op: "toggle", modelId: m.modelId }, `Model ${m.status === "READY" ? "taken offline" : m.status === "OFFLINE" ? "loading… (ready in ~8s)" : "forced ready"}`)}
                    >
                      <Power className="w-3.5 h-3.5 mr-1" />
                      {m.status === "READY" ? "Offline" : m.status === "OFFLINE" ? "Load" : "Cancel load"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Playground + jobs */}
        <div className="lg:col-span-3 space-y-4">
          <PlaygroundCard models={data.models} apps={data.apps} onInfer={(b) => post({ op: "infer", ...b }, "Inference done")} />

          <Card>
            <CardContent className="p-5">
              <h4 className="font-semibold mb-3">Job feed</h4>
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-3">
                  {data.jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet — run one above.</p>}
                  {data.jobs.map((j) => (
                    <div key={j.id} className="rounded-lg border border-border/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-primary truncate">{j.model.name}</p>
                          <p className="text-sm truncate">{j.prompt}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-muted-foreground">{fmtAgo(j.createdAt)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {j.tokensIn}→{j.tokensOut} tok{j.latencyMs ? ` · ${j.latencyMs}ms` : ""}
                          </p>
                        </div>
                      </div>
                      {j.app && <p className="text-[10px] text-muted-foreground mt-1">app: {j.app.name}</p>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PlaygroundCard({
  models,
  apps,
  onInfer,
}: {
  models: AiState["models"];
  apps: AiState["apps"];
  onInfer: (b: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
}) {
  const ready = models.filter((m) => m.status === "READY");
  const [modelId, setModelId] = useState(ready[0]?.modelId || "");
  const [appId, setAppId] = useState("none");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ output: string; tokensIn: number; tokensOut: number; latencyMs: number } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const res = await onInfer({ modelId, prompt, appId: appId === "none" ? null : appId });
    setBusy(false);
    if (res.ok && res.data) {
      const d = res.data as { output: string; tokensIn: number; tokensOut: number; latencyMs: number };
      setResult(d);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h4 className="font-semibold">Inference playground (internal only)</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger aria-label="Model">
                <SelectValue placeholder={ready.length === 0 ? "no model ready" : "pick a model"} />
              </SelectTrigger>
              <SelectContent>
                {ready.map((m) => (
                  <SelectItem key={m.modelId} value={m.modelId}>
                    {m.name} ({m.paramsB})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Calling app</Label>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger aria-label="Calling app">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">control plane (owner)</SelectItem>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-prompt">Prompt</Label>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Draft the citizen grievance flow for NEXSEVA — keep every field inside the ecosystem"
          />
        </div>
        <Button className="w-full" onClick={run} disabled={busy || ready.length === 0 || !prompt.trim()}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Run inference
        </Button>
        {result && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>
                {result.tokensIn} in → {result.tokensOut} out · {result.latencyMs} ms
              </span>
              <span>job done</span>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono">{result.output}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
