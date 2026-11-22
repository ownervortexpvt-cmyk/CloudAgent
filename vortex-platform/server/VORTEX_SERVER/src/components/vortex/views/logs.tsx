"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, ScrollText } from "lucide-react";
import { api, type AuditRow, fmtDate } from "../client";
import MailView from "./mail";

export default function LogsView({ onChanged = () => {} }: { onChanged?: () => void }) {
  return (
    <Tabs defaultValue="mail" className="w-full">
      <TabsList>
        <TabsTrigger value="mail" className="gap-2">
          <Mail className="w-4 h-4" /> Mail Center
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-2">
          <ScrollText className="w-4 h-4" /> Audit Trail
        </TabsTrigger>
      </TabsList>

      <TabsContent value="mail" className="mt-4">
        <MailView onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="audit" className="mt-4">
        <AuditTab />
      </TabsContent>
    </Tabs>
  );
}

function AuditTab() {
  const auditQuery = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ logs: AuditRow[]; count: number }>("/api/v1/audit?take=100"),
  });
  const logs = auditQuery.data?.ok ? auditQuery.data.data?.logs ?? null : null;
  const count = auditQuery.data?.ok ? auditQuery.data.data?.count ?? 0 : 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Append-only. {count} event{count === 1 ? "" : "s"} recorded since bootstrap.
      </p>
      {!logs && (
        <div className="grid gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[28rem] overflow-y-auto vortex-scroll">
            {logs?.map((l) => (
              <div
                key={l.id}
                className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3 border-b border-border/40 last:border-0 text-xs"
              >
                <code className="font-mono text-primary w-40 shrink-0">{l.action}</code>
                <span className="text-muted-foreground flex-1 min-w-0 truncate">
                  {l.actor} → {l.resource}
                  {l.detail ? ` · ${l.detail}` : ""}
                </span>
                <span className="text-muted-foreground/70 shrink-0">
                  {l.ip || "—"} · {fmtDate(l.createdAt)}
                </span>
              </div>
            ))}
            {logs && logs.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">No events yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
