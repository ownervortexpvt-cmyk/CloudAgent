import { createServer } from "http";
import { Server } from "socket.io";
import { spawn } from "child_process";
import { connect } from "net";

// ---- platform bootstrap: keep the Next dev server alive (Phase 8 ops) ----
// start.sh launches the web server ONCE at boot with no supervisor; when the
// runtime recycles stray processes the site dies with it. vx-realtime is a
// boot-time process, so a server spawned from here inherits that immunity.
// Guarded: no-op whenever port 3000 is already serving (idempotent on --hot reloads).
async function port3000Up(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(3000, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    setTimeout(() => {
      s.destroy();
      resolve(false);
    }, 1500);
  });
}

void (async () => {
  if (await port3000Up()) return;
  console.log("[vx-realtime] port 3000 down — spawning the Next dev server (bootstrap guard)");
  const child = spawn("bun", ["run", "dev"], {
    cwd: "/home/z/my-project",
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
})();

/**
 * VORTEX VaaS REALTIME (Phase 8) — socket.io fan-out for VxRealtimeEvent.
 *
 * Two listeners:
 *   :3005  socket.io (path "/", Caddy: /?XTransformPort=3005)
 *          vx:subscribe {projectId, channel?} → joins rooms p:<pid> / p:<pid>:c:<ch>
 *          emits `vx:event` envelopes
 *   :3006  raw HTTP (internal, control plane only):
 *          GET  /health → liveness for MONITOR probes
 *          POST /emit   → the Next control plane publishes a persisted
 *                         VxRealtimeEvent row here (best-effort)
 */

const WS_PORT = Number(process.env.VX_REALTIME_PORT || 3005);
const HTTP_PORT = Number(process.env.VX_REALTIME_HTTP_PORT || 3006);

let clients = 0;

// ---- raw internal door (emit + health) — no socket.io interception ----
const raw = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/emit") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const evt = JSON.parse(body) as { projectId: string; channel: string; type: string; payload?: unknown; eventId: string; at: string };
        if (!evt?.projectId || !evt?.channel) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "projectId and channel required" }));
          return;
        }
        const envelope = {
          eventId: evt.eventId,
          projectId: evt.projectId,
          channel: evt.channel,
          type: evt.type,
          payload: evt.payload ?? {},
          at: evt.at || new Date().toISOString(),
        };
        // rooms: project-wide + channel-scoped
        io.to(`p:${evt.projectId}`).to(`p:${evt.projectId}:c:${evt.channel}`).emit("vx:event", envelope);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, delivered: clients }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad json" }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vx-realtime", uptimeSec: Math.round(process.uptime()), clients }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

raw.listen(HTTP_PORT, () => {
  console.log(`[vx-realtime] raw door (emit/health) on :${HTTP_PORT}`);
});

// ---- socket.io door (path "/" — Caddy forwards /?XTransformPort=3005 here) ----
const io = new Server(createServer(), {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  clients += 1;
  socket.on("disconnect", () => (clients = Math.max(0, clients - 1)));
  socket.on("vx:subscribe", (data: { projectId?: string; channel?: string }) => {
    if (!data?.projectId) return;
    if (data.channel) socket.join(`p:${data.projectId}:c:${data.channel}`);
    else socket.join(`p:${data.projectId}`);
    socket.emit("vx:subscribed", { projectId: data.projectId, channel: data.channel || null });
  });
  socket.on("vx:unsubscribe", (data: { projectId?: string; channel?: string }) => {
    if (!data?.projectId) return;
    if (data.channel) socket.leave(`p:${data.projectId}:c:${data.channel}`);
    else socket.leave(`p:${data.projectId}`);
  });
  socket.on("vx:ping", () => socket.emit("vx:pong", { at: new Date().toISOString() }));
});

io.engine.on("connection", () => (clients = Math.max(clients, 1)));

const wsServer = (io as unknown as { httpServer: ReturnType<typeof createServer> }).httpServer;
wsServer.listen(WS_PORT, () => {
  console.log(`[vx-realtime] socket.io on :${WS_PORT} (path /) — rooms p:<projectId>[:c:<channel>]`);
});
