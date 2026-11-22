/**
 * VORTEX Realtime Hub — v145
 *
 * In-process pub/sub core for TRUE realtime push (Firebase onSnapshot counterpart).
 * The VaaS gateway runs as ONE Next.js standalone process, so a module-level
 * EventEmitter is shared by every request: SSE streams subscribe here and
 * rtPublishInternal() publishes here → sub-millisecond fan-out, zero polling.
 *
 * Also owns PRESENCE: SSE connect marks a client online, disconnect marks it
 * offline (Firebase needs onDisconnect() tricks — VORTEX does it natively).
 */

import { EventEmitter } from "node:events";

export type RtMsg = {
  projectId: string; // vxproj_… (public id)
  projectDbId: string; // internal cuid
  channel: string;
  type: string;
  payload: unknown;
  eventId: string;
  at: string;
  emittedBy?: string;
};

type PresenceEntry = { clientId: string; uid: string | null; ts: number; meta?: Record<string, unknown> };

type HubGlobal = typeof globalThis & {
  __vxRtHub?: EventEmitter;
  __vxPresence?: Map<string, Map<string, PresenceEntry>>; // `${projectDbId}::${channel}` → clients
};

const g = globalThis as HubGlobal;

/** Singleton hub — survives route-handler module reloads within the process. */
export const rtHub: EventEmitter = g.__vxRtHub ?? new EventEmitter();
rtHub.setMaxListeners(0);
g.__vxRtHub = rtHub;

/** presence map singleton (same process). */
const presence: Map<string, Map<string, PresenceEntry>> = g.__vxPresence ?? new Map();
g.__vxPresence = presence;

export function rtEmit(msg: RtMsg): void {
  rtHub.emit("vx", msg);
}

export function rtSubscribe(fn: (msg: RtMsg) => void): () => void {
  rtHub.on("vx", fn);
  return () => rtHub.off("vx", fn);
}

const PRESENCE_TTL_MS = 70_000; // online = seen in the last 70s

function presenceKey(projectDbId: string, channel: string) {
  return `${projectDbId}::${channel}`;
}

/** Mark a client online (SSE connect or explicit heartbeat). */
export function presenceOnline(
  projectDbId: string,
  channel: string,
  clientId: string,
  uid: string | null,
  meta?: Record<string, unknown>
): void {
  const key = presenceKey(projectDbId, channel);
  let map = presence.get(key);
  if (!map) {
    map = new Map();
    presence.set(key, map);
  }
  map.set(clientId, { clientId, uid, ts: Date.now(), meta });
}

/** Mark a client offline (SSE disconnect). Returns true when a real removal happened. */
export function presenceOffline(projectDbId: string, channel: string, clientId: string): boolean {
  const map = presence.get(presenceKey(projectDbId, channel));
  if (!map) return false;
  const had = map.delete(clientId);
  if (map.size === 0) presence.delete(presenceKey(projectDbId, channel));
  return had;
}

/** Distinct online users/clients for a channel. Sweeps TTL-expired entries. */
export function presenceList(
  projectDbId: string,
  channel: string
): { online: number; clients: { clientId: string; uid: string | null; sinceMs: number; meta?: Record<string, unknown> }[] } {
  const map = presence.get(presenceKey(projectDbId, channel));
  if (!map) return { online: 0, clients: [] };
  const now = Date.now();
  const clients: { clientId: string; uid: string | null; sinceMs: number; meta?: Record<string, unknown> }[] = [];
  for (const [cid, e] of map) {
    if (now - e.ts > PRESENCE_TTL_MS) {
      map.delete(cid);
      continue;
    }
    clients.push({ clientId: cid, uid: e.uid, sinceMs: now - e.ts, meta: e.meta });
  }
  return { online: clients.length, clients };
}

/** Called from the vaas ticker to expire stale presence without a listener. */
export function presenceSweep(): void {
  const now = Date.now();
  for (const [key, map] of presence) {
    for (const [cid, e] of map) if (now - e.ts > PRESENCE_TTL_MS) map.delete(cid);
    if (map.size === 0) presence.delete(key);
  }
}

export const RT_PRESENCE_TTL_MS = PRESENCE_TTL_MS;
