import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/vortex/seed";
import {
  sdkRateOk,
  resolveCaller,
  developerSignup,
  developerLogin,
  developerFromToken,
  sdkSignup,
  sdkLogin,
  sdkOtpRequest,
  sdkOtpVerify,
  sdkMe,
  sdkSignOut,
  docAdd,
  docGet,
  docList,
  docUpdate,
  docDelete,
  docBatch,
  vaasUpload,
  vaasDownload,
  vaasListFiles,
  vaasDeleteFile,
  rtPublishInternal,
  rtRecent,
  invokeFunction,
  projectBucket,
  meter,
  ensureCollection,
  devProjectList,
  devProjectCreate,
  devProjectUsage,
  devRotateKeys,
  cfgFetch,
  cfgSet,
  pushRegister,
  pushSend,
  analyticsLog,
  analyticsSummary,
  crashReport,
  crashList,
  devFnDeploy,
  devFnList,
  devFnDelete,
  devFnInvoke,
  vaasTick,
  sdkResetPassword,
  sdkSetClaims,
} from "@/lib/vortex/vaas";
import { rtSubscribe, presenceOnline, presenceOffline, presenceList } from "@/lib/vortex/rt-hub";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/vortex/crypto";
import { writeAudit } from "@/lib/vortex/audit";

/**
 * VAAS PUBLIC SDK SURFACE — /api/vaas/v1/*
 *
 * No dashboard session. The project is resolved from the publishable
 * CLIENT key header (x-vx-key); end-users carry their idToken as
 * Authorization: Bearer vxt_…. Rules are enforced SERVER-SIDE.
 *
 *   GET  /api/vaas/v1/health                     → config bootstrap (initializeApp)
 *   POST /api/vaas/v1/dev/signup | dev/login     → developer console accounts
 *   GET  /api/vaas/v1/dev/me                     → developer session introspection
 *   GET  /api/vaas/v1/dev/projects               → own projects + usage (dev token)
 *   POST /api/vaas/v1/dev/projects               → create own project (dev token)
 *   GET  /api/vaas/v1/dev/projects/:id/usage     → per-project usage + price
 *   POST /api/vaas/v1/dev/projects/:id/rotate-keys → re-issue CLIENT+ADMIN
 *   POST /api/vaas/v1/auth/signup|login|otp-request|otp-verify|signout
 *   GET  /api/vaas/v1/auth/me
 *   GET  /api/vaas/v1/data/:collection           → query (?where=&contains=&orderBy=&limit=&skip=)
 *   POST /api/vaas/v1/data/:collection           → add doc {data}
 *   POST /api/vaas/v1/data/batch                 → ATOMIC batch {ops:[{op, collection, docId?, data?}]}
 *   GET  /api/vaas/v1/data/:collection/:docId    → get doc
 *   PATCH/PUT /api/vaas/v1/data/:collection/:docId
 *   DELETE /api/vaas/v1/data/:collection/:docId
 *   POST /api/vaas/v1/storage/upload             → {path, contentB64, mime}
 *   GET  /api/vaas/v1/storage/list | storage/file?id=|path=
 *   DELETE /api/vaas/v1/storage/file?id=
 *   POST /api/vaas/v1/rt/publish                 → {channel, type, payload}
 *   POST /api/vaas/v1/rt/presence                → heartbeat {channel} (or auto on SSE connect)
 *   GET  /api/vaas/v1/rt/presence?channel=       → who is online now
 *   GET  /api/vaas/v1/rt/stream?channel=         → TRUE PUSH (SSE, onSnapshot counterpart)
 *   GET  /api/vaas/v1/rt/events?channel=         → polling fallback
 *   POST /api/vaas/v1/fn/:name/invoke            → {payload}
 *   POST /api/vaas/v1/collections                → ADMIN key: create collection
 *   GET  /api/vaas/v1/config                     → Remote Config fetch (parsed values + version)
 *   POST /api/vaas/v1/config                     → ADMIN key: set entries
 *   POST /api/vaas/v1/push/register              → device token registry {token, platform}
 *   POST /api/vaas/v1/push/send                  → ADMIN key: {title, body, uid?|channel?, data?}
 *   POST /api/vaas/v1/analytics/event            → log {name, params}
 *   GET  /api/vaas/v1/analytics/summary?days=    → ADMIN key: aggregates
 *   POST /api/vaas/v1/crash/report               → crashlytics ingest {message, stack, appVersion}
 *   GET  /api/vaas/v1/tick                       → localhost+secret: scheduler tick
 *   GET/POST/DELETE /api/vaas/v1/dev/projects/:id/functions[...] → deploy/list/delete/invoke
 *   GET  /api/vaas/v1/dev/projects/:id/crashes   → crashlytics console list
 */

type Ctx = { params: Promise<{ vx: string[] }> };

function vxOk(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, ...(data as object) }, { status });
}
function vxFail(error: string, status = 400, code?: number) {
  return NextResponse.json({ ok: false, error, code: code ?? status }, { status });
}

function statusOf(res: Record<string, unknown>, fallback: number): number {
  const c = (res as { code?: number }).code;
  return typeof c === "number" ? c : fallback;
}

/** localhost+secret gate for the scheduler tick. Secret comes from the
 *  VX_TICK_SECRET env OR the .tick-secret file (survives watchdog restarts). */
function tickAllowed(req: Request): boolean {
  let secret = process.env.VX_TICK_SECRET || "";
  if (!secret) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      // standalone chdir's into .next/standalone — resolve from cwd or source dir
      const candidates = [
        path.join(process.cwd(), ".tick-secret"),
        path.join(process.cwd(), "../../.tick-secret"),
        path.join(process.cwd(), "../../../.tick-secret"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          secret = fs.readFileSync(p, "utf8").trim();
          break;
        }
      }
    } catch {
      /* no file — env only */
    }
  }
  if (!secret) return false;
  // v147 — accept the secret via x-vx-tick header OR ?secret= query param
  // (system cron / EventSource-style pingers cannot always set headers).
  const provided = req.headers.get("x-vx-tick") || new URL(req.url).searchParams.get("secret") || "";
  if (provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/**
 * TRUE REALTIME PUSH — SSE stream (Firebase onSnapshot counterpart).
 * Subscribes to the in-process hub; presence is auto-managed on connect/disconnect.
 *   GET /api/vaas/v1/rt/stream?channel=a,b   (comma-separated; empty = all project channels)
 *   &since=<eventId|epochMs|iso>             replay history first, live after
 */
function rtStreamHandler(
  req: Request,
  caller: { project: { id: string; projectId: string; name: string; slug: string }; user: { uid: string } | null },
  project: { id: string; projectId: string; rtEnabled: boolean }
): Response {
  const url = new URL(req.url);
  const channels = (url.searchParams.get("channel") || "")
    .split(",")
    .map((s) => s.trim().slice(0, 80))
    .filter(Boolean);
  const since = url.searchParams.get("since") || "";
  const clientId = `sse_${Math.random().toString(36).slice(2, 10)}`;
  const encoder = new TextEncoder();
  const primaryChannel = channels[0] || "presence";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ projectId: project.projectId, channels, clientId, uid: caller.user?.uid || null, transport: "sse" })}\n\n`);

      // presence: connect = online (Firebase needs onDisconnect() hacks — VORTEX does it natively)
      presenceOnline(project.id, primaryChannel, clientId, caller.user?.uid ?? null, { via: "sse" });
      void rtPublishInternal({
        projectId: project.projectId,
        channel: primaryChannel,
        type: "presence",
        payload: { clientId, uid: caller.user?.uid || null, online: true },
        emittedBy: "system",
      }).catch(() => undefined);

      // live push — in-process, sub-millisecond
      const unsub = rtSubscribe((msg) => {
        if (msg.projectDbId !== project.id) return;
        if (channels.length > 0 && !channels.includes(msg.channel)) return;
        send(`event: vx\ndata: ${JSON.stringify({ channel: msg.channel, type: msg.type, payload: msg.payload, eventId: msg.eventId, at: msg.at, emittedBy: msg.emittedBy })}\n\n`);
      });

      // history replay when ?since= is given (client dedupes by eventId)
      if (since) {
        const sinceMs = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
        if (Number.isFinite(sinceMs)) {
          void db.vxRealtimeEvent
            .findMany({
              where: {
                projectId: project.id,
                createdAt: { gte: new Date(sinceMs) },
                ...(channels.length > 0 ? { channel: { in: channels } } : {}),
              },
              orderBy: { createdAt: "asc" },
              take: 50,
            })
            .then((rows) => {
              for (const r of rows) {
                send(`event: vx\ndata: ${JSON.stringify({ channel: r.channel, type: r.type, payload: JSON.parse(r.payloadJson || "{}"), eventId: r.eventId, at: r.createdAt.toISOString(), emittedBy: r.emittedBy, replay: true })}\n\n`);
              }
            })
            .catch(() => undefined);
        }
      }

      const ping = setInterval(() => send(`: ping ${Date.now()}\n\n`), 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsub();
        presenceOffline(project.id, primaryChannel, clientId);
        void rtPublishInternal({
          projectId: project.projectId,
          channel: primaryChannel,
          type: "presence",
          payload: { clientId, uid: caller.user?.uid || null, online: false },
          emittedBy: "system",
        }).catch(() => undefined);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { vx } = await ctx.params;
  const [seg, collection, docId] = vx;

  // scheduler tick — localhost+secret only, runs WITHOUT any dashboard being open
  if (seg === "tick") {
    if (!tickAllowed(req)) return vxFail("Tick denied", 403);
    const res = await vaasTick();
    return vxOk(res);
  }

  await ensureSeeded();

  // developer email verification (link from the welcome mail)
  if (seg === "dev" && collection === "verify") {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (token.length < 20) return vxFail("Invalid token");
    const dev = await db.developer.findFirst({ where: { verifyTokenHash: sha256(token) } });
    if (!dev) return vxFail("Invalid or used verification token", 404);
    await db.developer.update({ where: { id: dev.id }, data: { emailVerified: true, verifyTokenHash: null } });
    await writeAudit({ actor: `dev:${dev.devId}`, action: "VAAS_DEV_VERIFIED", resource: `dev:${dev.devId}`, detail: dev.email });
    return vxOk({ verified: dev.email });
  }

  // developer console routes — dev Bearer token, NO project CLIENT key required
  if (seg === "dev") {
    const dev = await developerFromToken(req);
    if (!dev) return vxFail("Invalid developer token", 401);
    if (collection === "me") {
      const projects = await db.vxProject.findMany({ where: { developerId: dev.id }, orderBy: { createdAt: "asc" } });
      return vxOk({
        dev: { devId: dev.devId, email: dev.email, name: dev.name, plan: dev.plan, emailVerified: dev.emailVerified },
        projects: projects.map((p) => ({ projectId: p.projectId, name: p.name, slug: p.slug, status: p.status, region: p.region, viaNexa: p.viaNexa })),
      });
    }
    if (collection === "projects") {
      if (!docId) {
        const res = await devProjectList(dev);
        return vxOk(res);
      }
      if (vx[3] === "usage") {
        const res = await devProjectUsage(dev, docId);
        return "error" in res ? vxFail(res.error, 404) : vxOk(res);
      }
      if (vx[3] === "functions") {
        const res = await devFnList(dev, docId);
        return "error" in res ? vxFail(res.error, 404) : vxOk(res);
      }
      if (vx[3] === "crashes") {
        const url = new URL(req.url);
        const resolved = url.searchParams.get("resolved");
        const res = await crashList(dev, docId, { resolved: resolved === "true" ? true : resolved === "false" ? false : undefined });
        return "error" in res ? vxFail(res.error, 404) : vxOk(res);
      }
    }
    return vxFail("Unknown dev route");
  }

  // SSE (EventSource) cannot send custom headers — allow ?key= as the publishable
  // CLIENT key carrier for GET streams (mirrors firebase apiKey-in-URL semantics).
  let authReq: Request = req;
  const qkey = new URL(req.url).searchParams.get("key") || "";
  if (qkey && !req.headers.get("x-vx-key")) {
    const h = new Headers(req.headers);
    h.set("x-vx-key", qkey);
    authReq = new Request(req.url, { method: "GET", headers: h });
  }
  const caller = await resolveCaller(authReq);
  if (!caller) return vxFail("Missing or invalid x-vx-key — pass your project CLIENT key", 401);
  await meter(caller.project.id, "VAAS_API", 1);

  switch (seg) {
    case "health": {
      const project = await db.vxProject.findUnique({ where: { id: caller.project.id } });
      if (!project) return vxFail("Project unavailable", 410);
      const bucket = await projectBucket(caller.project.id);
      const cols = await db.vxCollection.findMany({ where: { projectId: caller.project.id }, select: { name: true, readRule: true, writeRule: true } });
      return vxOk({
        config: {
          projectId: project.projectId,
          name: project.name,
          region: project.region,
          authEnabled: project.authEnabled,
          realtimeEnabled: project.rtEnabled,
          functionsEnabled: project.fnEnabled,
          storageBucket: bucket?.name || null,
        },
        collections: cols,
        status: project.status,
      });
    }

    case "data": {
      if (!collection) return vxFail("Collection required");
      const url = new URL(req.url);
      const query = {
        where: parseJsonParam(url.searchParams.get("where")),
        contains: parseJsonParam(url.searchParams.get("contains")),
        orderBy: url.searchParams.get("orderBy") || undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        skip: url.searchParams.get("skip") ? Number(url.searchParams.get("skip")) : undefined,
      };
      if (docId) {
        const res = await docGet({ caller, collection, docId });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 404)) : vxOk(res);
      }
      const res = await docList({ caller, collection, query });
      return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res);
    }

    case "storage": {
      if (collection === "list") {
        const res = await vaasListFiles(caller);
        return "error" in res && res.error ? vxFail(res.error) : vxOk(res);
      }
      if (collection === "file") {
        const url = new URL(req.url);
        const res = await vaasDownload({ caller, fileId: url.searchParams.get("id") || undefined, path: url.searchParams.get("path") || undefined });
        if ("error" in res && res.error) return vxFail(res.error, statusOf(res, 404));
        if (!("bytes" in res)) return vxFail("Download failed", 500);
        return new NextResponse(new Uint8Array(res.bytes), {
          headers: {
            "Content-Type": res.file.mime || "application/octet-stream",
            "X-Vx-File-Id": res.file.fileId,
            "X-Vx-Checksum": res.file.checksum,
            "Content-Length": String(res.bytes.length),
          },
        });
      }
      return vxFail("Unknown storage route");
    }

    case "rt": {
      const project = await db.vxProject.findUnique({ where: { id: caller.project.id } });
      if (!project?.rtEnabled) return vxFail("Realtime disabled for this project", 403);
      if (collection === "events") {
        const url = new URL(req.url);
        const events = await rtRecent(caller.project.id, url.searchParams.get("channel") || undefined);
        return vxOk({ events });
      }
      if (collection === "stream") {
        return rtStreamHandler(req, caller, project);
      }
      if (collection === "presence") {
        const url = new URL(req.url);
        const channel = (url.searchParams.get("channel") || "presence").trim().slice(0, 80);
        const list = presenceList(project.id, channel);
        return vxOk({ channel, ...list, ttlMs: 70000 });
      }
      return vxFail("Unknown realtime route");
    }

    case "config": {
      const res = await cfgFetch(caller);
      return vxOk(res);
    }

    case "analytics": {
      if (collection === "summary") {
        if (caller.key.kind !== "ADMIN") return vxFail("ADMIN secret key required (vxa_…)", 403);
        const url = new URL(req.url);
        const res = await analyticsSummary({ projectId: caller.project.id, days: Number(url.searchParams.get("days") || 7) });
        return vxOk(res);
      }
      return vxFail("Use GET /api/vaas/v1/analytics/summary?days=7");
    }

    case "auth": {
      // v145 FIX — GET /auth/me was documented but the GET switch had no case
      // (POST-only before) → sdk.auth().me() 404'd. Root-fix: proper GET route.
      if (collection === "me") {
        const res = await sdkMe(caller);
        return "error" in res && res.error ? vxFail(res.error, 401) : vxOk(res);
      }
      return vxFail(`Unknown auth GET route "${collection || ""}"`);
    }

    default:
      return vxFail(`Unknown route /api/vaas/v1/${vx.join("/")}`, 404);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  await ensureSeeded();
  const { vx } = await ctx.params;
  const [seg, a, b, c] = vx;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const ua = req.headers.get("user-agent");

  // v147 — POST /tick for system cron pingers (GET already supported).
  if (seg === "tick") {
    if (!tickAllowed(req)) return vxFail("Tick denied", 403);
    return vxOk(await vaasTick());
  }

  // Developer console — signup/login need no project key; projects/* need the dev token
  if (seg === "dev") {
    if (a === "signup" || a === "login") {
      const rate = sdkRateOk(req, `dev:${a}`);
      if (!rate.ok) return vxFail("Rate limit exceeded — slow down", 429);
      let body: Record<string, string>;
      try {
        body = (await req.json()) as Record<string, string>;
      } catch {
        return vxFail("Invalid JSON body");
      }
      if (a === "signup") {
        const res = await developerSignup({ email: body.email || "", password: body.password || "", name: body.name || "", ip });
        return "error" in res ? vxFail(res.error, 403) : vxOk(res, 201);
      }
      const res = await developerLogin({ email: body.email || "", password: body.password || "", ip, ua });
      return "error" in res ? vxFail(res.error, 401) : vxOk(res);
    }
    if (a === "projects") {
      const dev = await developerFromToken(req);
      if (!dev) return vxFail("Invalid developer token", 401);
      const rate = sdkRateOk(req, `dev:${dev.devId}`);
      if (!rate.ok) return vxFail("Rate limit exceeded — slow down", 429);
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (!b) {
        const name = String(body.name || "").trim();
        if (!name) return vxFail("Project name is required");
        const rawCols = Array.isArray(body.collections) ? (body.collections as unknown[]) : [];
        const collections = rawCols
          .map((c) => (typeof c === "string" ? { name: c } : (c as { name?: string; read?: string; write?: string })))
          .filter((c) => typeof c?.name === "string" && c.name.trim().length > 0)
          .map((c) => ({ name: String(c.name).trim(), read: c.read, write: c.write }));
        const res = await devProjectCreate(dev, { name, collections });
        return "error" in res ? vxFail(res.error, 409) : vxOk(res, 201);
      }
      if (c === "rotate-keys") {
        const res = await devRotateKeys(dev, b);
        return "error" in res ? vxFail(res.error, 404) : vxOk(res);
      }
      if (c === "functions") {
        if (!vx[4]) {
          // deploy (or redeploy) a cloud function — Firebase `functions deploy` counterpart
          const res = await devFnDeploy(dev, b, {
            name: String(body.name || ""),
            trigger: String(body.trigger || "HTTP"),
            eventConfig: (body.eventConfig && typeof body.eventConfig === "object" ? body.eventConfig : undefined) as Record<string, unknown> | undefined,
            code: String(body.code || ""),
          });
          return "error" in res ? vxFail(res.error, statusOf(res, 400)) : vxOk(res, 201);
        }
        if (vx[5] === "invoke") {
          // test-run from the console — invokeFunction results carry error:null on success
          const res = await devFnInvoke(dev, b, String(vx[4]), body.payload ?? body);
          return res && (res as { error?: unknown }).error ? vxFail(String((res as { error: unknown }).error), statusOf(res as Record<string, unknown>, 404)) : vxOk(res);
        }
      }
      return vxFail("Unknown dev projects route");
    }
    return vxFail("Unknown dev route");
  }

  const caller = await resolveCaller(req);
  if (!caller) return vxFail("Missing or invalid x-vx-key — pass your project CLIENT key", 401);
  const rate = sdkRateOk(req, caller.project.projectId);
  if (!rate.ok) return vxFail("Rate limit exceeded — slow down", 429);
  await meter(caller.project.id, "VAAS_API", 1);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  switch (seg) {
    case "auth": {
      const project = await db.vxProject.findUnique({ where: { id: caller.project.id } });
      if (!project?.authEnabled && a !== "me" && a !== "signout") return vxFail("Auth is disabled for this project", 403);
      switch (a) {
        case "signup": {
          const res = await sdkSignup({ caller, email: String(body.email || ""), password: String(body.password || ""), displayName: body.displayName ? String(body.displayName) : undefined, ip, ua });
          return "error" in res ? vxFail(res.error, 403) : vxOk(res, 201);
        }
        case "login": {
          const res = await sdkLogin({ caller, email: String(body.email || ""), password: String(body.password || ""), ip, ua });
          return "error" in res ? vxFail(res.error, 401) : vxOk(res);
        }
        case "otp-request": {
          const res = await sdkOtpRequest({ caller, email: String(body.email || ""), purpose: body.purpose === "PASSWORD_RESET" ? "PASSWORD_RESET" : "USER_LOGIN" });
          return "error" in res ? vxFail(res.error) : vxOk(res);
        }
        case "reset-password": {
          // v147 — Firebase sendPasswordResetEmail + confirmPasswordReset counterpart
          const res = await sdkResetPassword({ caller, email: String(body.email || ""), code: String(body.code || ""), newPassword: String(body.newPassword || ""), ip, ua });
          return "error" in res ? vxFail(res.error, statusOf(res, 401)) : vxOk(res);
        }
        case "set-claims": {
          // v147 — Firebase setCustomUserClaims counterpart (ADMIN key only)
          const res = await sdkSetClaims({ caller, uid: String(body.uid || ""), claims: (body.claims && typeof body.claims === "object" ? body.claims : {}) as Record<string, unknown> });
          return "error" in res ? vxFail(res.error, statusOf(res, 403)) : vxOk(res);
        }
        case "otp-verify": {
          const res = await sdkOtpVerify({ caller, email: String(body.email || ""), code: String(body.code || ""), ip, ua });
          return "error" in res ? vxFail(res.error, 401) : vxOk(res);
        }
        case "me": {
          const res = await sdkMe(caller);
          return "error" in res && res.error ? vxFail(res.error, 401) : vxOk(res);
        }
        case "signout": {
          const authHeader = req.headers.get("authorization") || "";
          const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
          const res = await sdkSignOut(caller, token);
          return vxOk(res);
        }
        default:
          return vxFail(`Unknown auth route "${a}"`);
      }
    }

    case "data": {
      if (!a) return vxFail("Collection required");
      if (a === "batch") {
        const ops = Array.isArray(body.ops) ? (body.ops as never[]) : [];
        const res = await docBatch({ caller, ops, ip });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 400)) : vxOk(res, 200);
      }
      const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
      if (b === "update") {
        const res = await docUpdate({ caller, collection: a, docId: String(body.docId || ""), data, patch: true, ip });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res);
      }
      const res = await docAdd({ caller, collection: a, data, ip });
      return "error" in res && res.error ? vxFail(res.error, 403) : vxOk({ doc: res, id: (res as { id?: string }).id }, 201);
    }

    case "storage": {
      if (a === "upload") {
        const res = await vaasUpload({ caller, path: String(body.path || ""), contentB64: String(body.contentB64 || ""), mime: body.mime ? String(body.mime) : undefined, ownerUid: caller.user?.uid ?? null });
        return "error" in res && res.error ? vxFail(res.error, 403) : vxOk(res, 201);
      }
      if (a === "delete") {
        const res = await vaasDeleteFile({ caller, fileId: String(body.fileId || "") });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 404)) : vxOk(res);
      }
      return vxFail(`Unknown storage route "${a}"`);
    }

    case "rt": {
      const project = await db.vxProject.findUnique({ where: { id: caller.project.id } });
      if (!project?.rtEnabled) return vxFail("Realtime disabled for this project", 403);
      if (a === "publish") {
        const res = await rtPublishInternal({
          projectId: caller.project.projectId,
          channel: String(body.channel || ""),
          type: String(body.type || "custom"),
          payload: (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>,
          emittedBy: caller.user ? `sdk:${caller.user.uid}` : "sdk",
        });
        return "error" in res && res.error ? vxFail(res.error, 403) : vxOk(res, 201);
      }
      if (a === "presence") {
        const channel = String(body.channel || "presence").trim().slice(0, 80);
        const clientId = String(body.clientId || caller.user?.uid || `anon:${ip}`).slice(0, 80);
        presenceOnline(project.id, channel, clientId, caller.user?.uid ?? null, { ua: ua?.slice(0, 120) });
        const list = presenceList(project.id, channel);
        return vxOk({ channel, clientId, ...list });
      }
      return vxFail(`Unknown realtime route "${a}"`);
    }

    case "config": {
      const entries = Array.isArray(body.entries) ? body.entries : [body];
      const res = await cfgSet({ caller, entries: entries as { key: string; value: unknown; valueType?: string; description?: string }[] });
      return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res, 201);
    }

    case "push": {
      if (a === "register") {
        const res = await pushRegister({ caller, token: String(body.token || ""), platform: body.platform ? String(body.platform) : undefined, uid: body.uid ? String(body.uid) : null });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 400)) : vxOk(res, 201);
      }
      if (a === "send") {
        const res = await pushSend({
          caller,
          title: String(body.title || ""),
          body: String(body.body || ""),
          data: (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>,
          uid: body.uid ? String(body.uid) : undefined,
          channel: body.channel ? String(body.channel) : undefined,
        });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res, 200);
      }
      return vxFail(`Unknown push route "${a}"`);
    }

    case "analytics": {
      if (a === "event") {
        const res = await analyticsLog({ caller, name: String(body.name || ""), params: (body.params && typeof body.params === "object" ? body.params : {}) as Record<string, unknown> });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 400)) : vxOk(res, 201);
      }
      return vxFail(`Unknown analytics route "${a}"`);
    }

    case "crash": {
      if (a === "report") {
        const res = await crashReport({
          caller,
          message: String(body.message || ""),
          stack: body.stack ? String(body.stack) : undefined,
          appVersion: body.appVersion ? String(body.appVersion) : undefined,
          platform: body.platform ? String(body.platform) : undefined,
        });
        return "error" in res && res.error ? vxFail(res.error, statusOf(res, 400)) : vxOk(res, 201);
      }
      return vxFail(`Unknown crash route "${a}"`);
    }

    case "fn": {
      if (!a || b !== "invoke") return vxFail("Use POST /api/vaas/v1/fn/:name/invoke");
      const fn = await db.vxFunction.findUnique({ where: { projectId_name: { projectId: caller.project.id, name: a } } });
      if (!fn || fn.status !== "ACTIVE") return vxFail(`Function "${a}" not found or disabled`, 404);
      const project = await db.vxProject.findUnique({ where: { id: caller.project.id } });
      if (!project?.fnEnabled) return vxFail("Functions disabled for this project", 403);
      const res = await invokeFunction({ fn, trigger: "HTTP", payload: (body.payload ?? body) as Record<string, unknown>, user: caller.user });
      return vxOk(res, res.status === "ERROR" ? 500 : 200);
    }

    case "collections": {
      if (caller.key.kind !== "ADMIN") return vxFail("ADMIN secret key required (vxa_…)", 403);
      const name = String(body.name || a || "");
      if (!name) return vxFail("Collection name required");
      const read = ["public", "auth", "owner", "admin"].includes(String(body.read || "")) ? String(body.read) : undefined;
      const write = ["public", "auth", "owner", "admin"].includes(String(body.write || "")) ? String(body.write) : undefined;
      const col = await ensureCollection(caller.project.id, name, { read, write });
      return vxOk({ collection: { name: col.name, readRule: col.readRule, writeRule: col.writeRule } }, 201);
    }

    default:
      return vxFail(`Unknown route /api/vaas/v1/${vx.join("/")}`, 404);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { vx } = await ctx.params;
  const [seg, collection, docId] = vx;
  if (seg !== "data" || !collection || !docId) return vxFail("Use PATCH /api/vaas/v1/data/:collection/:docId");
  const caller = await resolveCaller(req);
  if (!caller) return vxFail("Missing or invalid x-vx-key", 401);
  const rate = sdkRateOk(req, caller.project.projectId);
  if (!rate.ok) return vxFail("Rate limit exceeded", 429);
  await meter(caller.project.id, "VAAS_API", 1);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return vxFail("Invalid JSON body");
  }
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const res = await docUpdate({ caller, collection, docId, data, patch: true, ip: "local" });
  return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { vx } = await ctx.params;
  const [seg, collection, docId] = vx;
  if (seg !== "data" || !collection || !docId) return vxFail("Use PUT /api/vaas/v1/data/:collection/:docId");
  const caller = await resolveCaller(req);
  if (!caller) return vxFail("Missing or invalid x-vx-key", 401);
  await meter(caller.project.id, "VAAS_API", 1);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return vxFail("Invalid JSON body");
  }
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
  const res = await docUpdate({ caller, collection, docId, data, patch: false, ip: "local" });
  return "error" in res && res.error ? vxFail(res.error, statusOf(res, 403)) : vxOk(res);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { vx } = await ctx.params;
  const [seg, collection, docId] = vx;

  // dev console — delete an own cloud function
  if (seg === "dev" && collection === "projects" && docId && vx[3] === "functions" && vx[4]) {
    const dev = await developerFromToken(req);
    if (!dev) return vxFail("Invalid developer token", 401);
    const res = await devFnDelete(dev, docId, String(vx[4]));
    return "error" in res ? vxFail(res.error, statusOf(res, 404)) : vxOk(res);
  }

  await ensureSeeded();
  const caller = await resolveCaller(req);
  if (!caller) return vxFail("Missing or invalid x-vx-key", 401);
  const rate = sdkRateOk(req, caller.project.projectId);
  if (!rate.ok) return vxFail("Rate limit exceeded", 429);
  await meter(caller.project.id, "VAAS_API", 1);

  if (seg === "data" && collection && docId) {
    const res = await docDelete({ caller, collection, docId, ip: "local" });
    return "error" in res && res.error ? vxFail(res.error, statusOf(res, 404)) : vxOk(res);
  }
  if (seg === "storage" && collection === "file") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const res = await vaasDeleteFile({ caller, fileId: id });
    return "error" in res && res.error ? vxFail(res.error, statusOf(res, 404)) : vxOk(res);
  }
  return vxFail("Unknown route", 404);
}

function parseJsonParam(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
