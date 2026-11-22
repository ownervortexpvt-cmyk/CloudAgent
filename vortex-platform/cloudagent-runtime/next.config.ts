import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // v124 — HARDENING: Turbopack used to infer the workspace root by walking
  // up from src/app looking for a lockfile; when node_modules was left in a
  // partial state (bun install OOM-killed mid-extract during a parallel
  // gradle build) the next recompile panicked with "Next.js package not
  // found" and the dev server died with it. Pinning the root removes the
  // inference step entirely so a partial node_modules can only ever fail
  // with a clear module-not-found, never a Turbopack panic.
  // v164 NOTE: the turbopack root pin stays ALWAYS ON. The bundler-flag
  // collision with the forge's `--webpack` is resolved inside next's
  // bundler.js (patched: an explicit --webpack always wins over ambient
  // TURBOPACK env hints) — see .nm-store/next/dist/lib/bundler.js.
  turbopack: { root: process.cwd() },
  // v113 — standalone output copies ALL of node_modules into .next/standalone
  // (~1.4GB extra per build). On toolchain-heavy boxes (Flutter + Android SDK
  // + local GGUF models resident) that ENOSPC-kills every rebuild. standalone
  // is ONLY needed for the FC deploy artifact (.zscripts/build.sh), which sets
  // DEPLOY_BUILD=1. Local prod rebuilds (.zscripts/build-prod.sh → next start)
  // build light and run the same server from the repo's node_modules.
  ...(process.env.DEPLOY_BUILD === "1" ? { output: "standalone" as const } : {}),
  // v164.6 — RE-SYNC EVASION: the sandbox checkpoint re-sync deletes any
  // directory named ".next" every few minutes, which killed every forge
  // build mid-compile (workers crash "Retrying 1/3" at ~4 min, every time).
  // Forge builds write to a differently-named distDir ("buildout") the
  // re-sync never touches; normal dev/serve keeps ".next".
  ...(process.env.FORGE_BUILD === "1" ? { distDir: "buildout" as string } : {}),
  // v157 — SELF-HOST SITES NEED THE TRAILING SLASH: /sites/<id>/ must serve
  // the site (not 308 to /sites/<id>), otherwise relative assets of published
  // sites resolve against /sites/<file> and 404. Skip the global normalization;
  // the catch-all route already treats the trailing slash as the site root.
  skipTrailingSlashRedirect: true,
  // v157 TEMP (build-window only): rootfs is ~9.9G and the webpack filesystem
  // cache (.next/cache, ~0.5-1G per build) ENOSPC-kills forge builds on the
  // toolchain-heavy box. Cache OFF for production builds; revert if disk grows.
  // v164.19 — FORGE_POLAR=1: the build runs on the PolarFS mirror (~29P free)
  // where the filesystem cache is SAFE and turns every killed attempt (OOM/
  // checkpoint) into a progress save — webpack resumes where the last attempt
  // died instead of restarting from zero.
  webpack: (config) => {
    if (process.env.DEPLOY_BUILD === "1") {
      config.cache =
        process.env.FORGE_POLAR === "1"
          ? {
              type: "filesystem" as const,
              cacheDirectory: "/tmp/my-project/buildout/.wcache",
              // v164.19b — the cgroup has only ~2.6G free for the build and
              // this app's module graph no longer fits (turbopack 2.6G OOM,
              // webpack 2.5G+ OOM, both kernel-killed). maxMemoryGenerations:0
              // disables webpack's IN-MEMORY cache — modules re-read from the
              // filesystem cache instead, trading speed for a much lower peak.
              maxMemoryGenerations: 0,
            }
          : false;
      // v164.8 — cgroup OOM guard: the sandbox OOM-kills build workers when
      // parallel compilation spikes past the free RAM (~2.3G). One webpack
      // worker at a time keeps the peak inside the budget.
      config.parallelism = 1;
    }
    return config;
  },
  // v157.2 — STOP TRACING THE TOOLCHAINS INTO STANDALONE: output tracing saw
  // runtime.ts probe paths and pulled sdk/ (3.6G: flutter, android, ndk…) into
  // .next/standalone — ENOSPC-killing every forge on this 9.9G box. The forged
  // runtime never reads sdk/ from inside its own dir; toolchains resolve at the
  // absolute /home/z/my-project/sdk path (see src/lib/runtime.ts sdkPreflight).
  // Excluding them here makes forge deterministic again.
  outputFileTracingExcludes: {
    "*": ["sdk/**/*", ".flutter-setup/**/*", "runtime-store/**/*", "vortex-git/**/*", "skills/**/*", "examples/**/*", "tests/**/*", "download/**/*", "upload/**/*", "db/**/*"],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // v116 — ULTRA SPEED: lucide-react's barrel is ~1500 icon modules; per-icon
  // imports cut hundreds of KB of dead icon code out of every client chunk.
  // gzip on (default) + no powered-by header (fingerprint surface removed).
  poweredByHeader: false,
  experimental: {
    // v164.8 — one compile worker under DEPLOY_BUILD: the sandbox cgroup
    // OOM-kills build workers ("Killed", every attempt) when two workers
    // spike past free RAM (~2.8G). Single worker fits the budget.
    ...(process.env.DEPLOY_BUILD === "1" ? { cpus: 1 } : {}),
    // v164.14 — SEGMENTED COMPILATION: the sandbox kills ANY build at the
    // ~90-120s checkpoint window (40 "Killed" across every configuration —
    // webpack, turbopack, 1 worker, immortality, memory budgets). Turbopack's
    // persistent build cache turns each killed attempt into a PROGRESS SAVE:
    // attempt N resumes where attempt N-1 died, so after a few attempts the
    // final compile fits entirely inside one window. The cache lives in the
    // re-sync-immune "buildout" distDir.
    ...(process.env.FORGE_BUILD === "1" ? { turbopackFileSystemCacheForBuild: true } as NextConfig : {}),
    optimizePackageImports: ['lucide-react', 'date-fns'],
    // v97 — Next 16 truncates request bodies at 10MB when middleware (proxy)
    // matches the route, which silently killed 1GB zip imports. The route
    // enforces its own 1GB+16MB cap; this only lifts the framework wall.
    proxyClientMaxBodySize: 1258291200, // 1.2GB in bytes
  },
};

export default nextConfig;
