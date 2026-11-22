"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Bell, Globe, Boxes, BrainCircuit } from "lucide-react";
import MailView from "./mail";
import NotifyView from "./notify";
import CdnView from "./cdn";
import ComputeView from "./compute";
import AiView from "./ai";

/**
 * Phase 6 — Expansion. MAIL + NOTIFY + CDN + COMPUTE + AI INFRA.
 * One nav entry, five live modules.
 */
export default function ExpansionView({ onChanged }: { onChanged: () => void }) {
  return (
    <Tabs defaultValue="mail" className="w-full">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="mail" className="gap-2">
          <Mail className="w-4 h-4" /> MAIL
        </TabsTrigger>
        <TabsTrigger value="notify" className="gap-2">
          <Bell className="w-4 h-4" /> NOTIFY
        </TabsTrigger>
        <TabsTrigger value="cdn" className="gap-2">
          <Globe className="w-4 h-4" /> CDN
        </TabsTrigger>
        <TabsTrigger value="compute" className="gap-2">
          <Boxes className="w-4 h-4" /> COMPUTE
        </TabsTrigger>
        <TabsTrigger value="ai" className="gap-2">
          <BrainCircuit className="w-4 h-4" /> AI INFRA
        </TabsTrigger>
      </TabsList>
      <TabsContent value="mail" className="mt-4">
        <MailView onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="notify" className="mt-4">
        <NotifyView onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="cdn" className="mt-4">
        <CdnView onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="compute" className="mt-4">
        <ComputeView onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="ai" className="mt-4">
        <AiView onChanged={onChanged} />
      </TabsContent>
    </Tabs>
  );
}
