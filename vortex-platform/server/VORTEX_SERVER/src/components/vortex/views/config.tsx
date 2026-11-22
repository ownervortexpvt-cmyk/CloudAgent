"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, Settings2, Globe, Boxes, Server, Terminal, ExternalLink } from "lucide-react";
import { api, type ConfigRow } from "../client";
// v151 — ecosystem i18n (English default / বাংলা / হিন্দী) + one-platform shortcuts
import { useLang } from "@/lib/i18n";
import { platformLinks } from "@/lib/platform-links";

export default function ConfigView({ onChanged }: { onChanged: () => void }) {
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => api<{ configs: ConfigRow[] }>("/api/v1/config"),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const configsRaw = configQuery.data?.ok ? configQuery.data.data?.configs ?? null : null;
  const configs = configsRaw ? configsRaw.filter((c) => c.key !== "core.seeded") : null;
  const allConfigs = configsRaw ?? [];

  const reload = () => {
    configQuery.refetch();
    onChanged();
  };

  async function save(c: ConfigRow) {
    setBusyKey(c.key);
    const res = await api("/api/v1/config", {
      method: "PUT",
      body: { key: c.key, value: drafts[c.key] ?? c.value },
    });
    setBusyKey(null);
    if (!res.ok) {
      toast({ title: "Save failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: c.key });
    reload();
  }

  const categories = [...new Set(allConfigs.map((c) => c.category).filter((k) => k !== "dev" || configs?.some((c) => c.category === "dev")))];

  // v151 — ecosystem language + one-platform shortcuts
  const { t } = useLang();
  const links = platformLinks();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">{t("config.title")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("config.subtitle")}
        </p>
      </div>

      {/* v151 — ONE platform, four modules: one-tap navigation between them */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> {t("shortcuts.title")}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">{t("shortcuts.hint")}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Button variant="outline" className="h-auto py-2.5" onClick={() => window.open(links.website, "_blank")}>
              <span className="flex flex-col items-center text-center w-full gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Globe className="w-4 h-4" />{t("shortcuts.website")}<ExternalLink className="w-3 h-3 opacity-50" /></span>
                <span className="text-[11px] text-muted-foreground font-normal">{t("shortcuts.websiteDesc")}</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto py-2.5" onClick={() => window.open(links.server, "_blank")}>
              <span className="flex flex-col items-center text-center w-full gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Server className="w-4 h-4" />{t("shortcuts.server")}<ExternalLink className="w-3 h-3 opacity-50" /></span>
                <span className="text-[11px] text-muted-foreground font-normal">{t("shortcuts.serverDesc")}</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto py-2.5" onClick={() => window.open(links.appverse, "_blank")}>
              <span className="flex flex-col items-center text-center w-full gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Boxes className="w-4 h-4" />{t("shortcuts.appverse")}<ExternalLink className="w-3 h-3 opacity-50" /></span>
                <span className="text-[11px] text-muted-foreground font-normal">{t("shortcuts.appverseDesc")}</span>
              </span>
            </Button>
            <Button variant="outline" className="h-auto py-2.5" onClick={() => window.open(links.agent, "_blank")}>
              <span className="flex flex-col items-center text-center w-full gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Terminal className="w-4 h-4" />{t("shortcuts.agent")}<ExternalLink className="w-3 h-3 opacity-50" /></span>
                <span className="text-[11px] text-muted-foreground font-normal">{t("shortcuts.agentDesc")}</span>
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {!configs && (
        <div className="grid gap-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat} className="space-y-2">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-medium capitalize tracking-wide">{cat}</h4>
          </div>
          <div className="grid gap-2">
            {configs
              ?.filter((c) => c.category === cat)
              .map((c) => (
                <Card key={c.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono text-xs text-primary">{c.key}</code>
                          {c.isSecret && (
                            <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-400">
                              SECRET
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{c.description}</p>
                        {c.updatedBy && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            last edited by {c.updatedBy}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 w-full lg:w-auto">
                        <Input
                          aria-label={`Value for ${c.key}`}
                          value={drafts[c.key] ?? c.value}
                          onChange={(e) => setDrafts({ ...drafts, [c.key]: e.target.value })}
                          className="font-mono text-xs h-9 min-w-0 flex-1 lg:w-72"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => save(c)}
                          disabled={busyKey === c.key || (drafts[c.key] ?? "") === c.value}
                        >
                          {busyKey === c.key ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          <span className="ml-1.5 hidden sm:inline">{busyKey === c.key ? t("config.saving") : t("config.save")}</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
