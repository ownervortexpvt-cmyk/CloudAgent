"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Flame, Lock, ListChecks, Unlock } from "lucide-react";
import { PHASES } from "../client";

type PhaseStat = { phase: number; total: number; done: number; pct: number };

/**
 * Roadmap — the locked 8-phase plan, fully shipped.
 * Phase 8 (VaaS) is the public face: Firebase's father, live and NEXA-wired.
 */
export default function RoadmapView({ services }: { services: PhaseStat[] }) {
  const byPhase = (p: number) => services.find((s) => s.phase === p);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Build Roadmap</h3>
        <p className="text-sm text-muted-foreground">
          The locked 8-phase plan. Dependencies flow downward: each phase builds on the one before it.
        </p>
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => {
          const stat = byPhase(p);
          const meta = PHASES[p];
          const isGate = p === 7;
          const isVaas = p === 8;
          return (
            <Card key={p} className={isVaas ? "border-emerald-600/40" : isGate ? "border-amber-600/30" : ""}>
              <CardContent className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isVaas ? (
                        <Flame className="w-4 h-4 text-emerald-500" />
                      ) : isGate ? (
                        <Unlock className="w-4 h-4 text-amber-500" />
                      ) : (
                        <ListChecks className="w-4 h-4 text-primary" />
                      )}
                      <h4 className="font-medium">{meta?.label}</h4>
                      {isGate && (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                          SHIPPED — LIVE (INTERNAL)
                        </Badge>
                      )}
                      {stat && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {stat.done}/{stat.total} online
                        </Badge>
                      )}
                      {isGate && (
                        <Badge variant="outline" className="text-[10px] border-amber-600/40 text-amber-500">
                          GATE: OPEN (Phase 8)
                        </Badge>
                      )}
                      {isVaas && (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                          SHIPPED — LIVE (PUBLIC)
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{meta?.desc}</p>
                  </div>
                  {stat && (
                    <div className="w-full lg:w-48 shrink-0">
                      <Progress value={stat.pct} className="h-2" />
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">{stat.pct}%</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-emerald-600/40">
        <CardContent className="p-5">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Flame className="w-4 h-4 text-emerald-500" /> Phase 8 — VORTEX AS A SERVICE (the Firebase&apos;s father)</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The owner flipped the reserve: VORTEX is now a public multi-tenant Backend-as-a-Service. Developers
            self-register, provision projects with CLIENT/ADMIN keys, and consume end-user auth (password + OTP over
            real MAIL), a Firestore-style doc DB with server-side rules, storage on real 3×-replica buckets, socket.io
            realtime and sandboxed cloud functions — the drop-in SDK lives at
            <code className="font-mono text-[10px] text-primary mx-1">/vortex-sdk.js</code>
            and NEXA provisions whole backends in one call. Every SDK call is metered into BDT plans. Re-locking the
            gate (VaaS → gate) closes the public doors again instantly — the switch is still server-enforced.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
