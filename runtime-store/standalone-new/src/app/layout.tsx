import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import LockTokenBridge from "@/components/cloud-agent/LockTokenBridge";
import UpdateNotifier from "@/components/cloud-agent/UpdateNotifier";
import ChunkGuard from "@/components/cloud-agent/ChunkGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vortex Cloud Agent — AI App Builder (CloudAgent)",
  description:
    "Vortex Cloud Agent is the AI app builder where one prompt deploys a coordinated swarm of AI agents that plans, codes, reviews and ships real software — real terminal, real exports, real deploys.",
  keywords: ["Vortex", "Cloud Agent", "IDE", "AI coding", "Next.js", "Monaco", "PWA"],
  authors: [{ name: "Vortex CloudAgent" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Vortex CloudAgent", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/icon.svg",
    apple: "/builder-icon-180.png",
  },
  openGraph: {
    title: "Vortex CloudAgent",
    description: "Personal AI Cloud App Builder — VS Code + Replit + AI Agent + Cloud Terminal + Flutter Builder in one.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        {/* v147 — clears stale-chunk auto-reload guards 12s after a healthy
            load so every future restart error auto-recovers again. */}
        <ChunkGuard />
        {/* v117.2 — "New version available — tap to update" banner on every
            page; fires when a deploy changes BUILD_ID or the SW upgrades. */}
        <UpdateNotifier />
        {/* v25.1 — embedded-preview fallback: token header channel for browsers
            that drop the session cookie in cross-site iframes */}
        <LockTokenBridge />
        {/* v25 — register the builder PWA service worker (installable app) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw-builder.js',{updateViaCache:'none'}).then(function(r){return r.update()}).catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
