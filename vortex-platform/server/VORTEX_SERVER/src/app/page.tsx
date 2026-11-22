"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/components/vortex/client";
import Providers from "@/components/vortex/providers";
import VortexLogin, { VortexMark } from "@/components/vortex/login";
import Dashboard from "@/components/vortex/dashboard";
import DevConsole from "@/components/vortex/devconsole";

type Me = { user: { id: string; email: string; name: string; role: string } };

function VortexApp() {
  // "owner" = private control plane behind VORTEX ID; "console" = public VaaS developer console
  const [mode, setMode] = useState<"owner" | "console">("owner");
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/v1/me"),
  });

  if (mode === "console") {
    return <DevConsole onExit={() => setMode("owner")} />;
  }

  if (meQuery.isPending) {
    return (
      <div className="min-h-screen vortex-bg flex flex-col items-center justify-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center animate-pulse">
          <VortexMark className="w-8 h-8 text-primary" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to VORTEX CORE…
        </div>
      </div>
    );
  }

  const user = meQuery.data?.data?.user;

  if (!meQuery.data?.ok || !user) {
    return (
      <VortexLogin
        onAuthed={() => {
          meQuery.refetch();
        }}
        onOpenConsole={() => setMode("console")}
      />
    );
  }

  return <Dashboard userEmail={user.email} onLogout={refetchAfterLogout(meQuery.refetch)} />;
}

function refetchAfterLogout(refetch: () => void) {
  return () => {
    void api("/api/v1/auth/logout", { method: "POST" }).then(() => refetch());
  };
}

export default function VortexControlPlane() {
  return (
    <Providers>
      <VortexApp />
    </Providers>
  );
}
