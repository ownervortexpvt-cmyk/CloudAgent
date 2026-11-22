/**
 * v123 — REAL-TIME COLLABORATION BUS ("2+ jon mile ek app banabe")
 *
 * The platform deliberately avoids socket.io (terminals use HTTP polling —
 * it survives every proxy without WebSocket upgrade pain). Collaboration
 * follows the same proven pattern:
 *
 *   - PRESENCE: every open editor heartbeats /collab/sync every ~6s with
 *     { user, tab } → the bus keeps a 25s-fresh peer list per project.
 *   - EVENTS: file saves (API layer) publish { path, byUser, action } into a
 *     per-project ring buffer (200 events, 5-min TTL). Clients poll sync and
 *     toast + refresh when someone else touched their files.
 *
 * Everything is in-memory per process — presence/events are ephemeral by
 * nature; membership (who MAY join) lives in the ProjectCollaborator table.
 */

export interface Peer { userId: string; name: string; email: string; tab: string; at: number; color: string }
export type CollabAction = 'save' | 'create' | 'delete' | 'rename'
export interface CollabEvent { id: number; path: string; action: CollabAction; byUserId: string; byName: string; at: number }

const PEER_TTL_MS = 25_000
const EVENT_TTL_MS = 5 * 60_000
const EVENT_MAX = 200

const PEER_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444', '#84cc16', '#f97316']

type BusShape = {
  peers: Map<string, Map<string, Peer>>        // projectId → userId → peer
  events: Map<string, CollabEvent[]>           // projectId → ring buffer
  eventSeq: number
}
const g = globalThis as unknown as { __caCollab?: BusShape }

function bus(): BusShape {
  if (!g.__caCollab) g.__caCollab = { peers: new Map(), events: new Map(), eventSeq: 0 }
  return g.__caCollab
}

function colorFor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]
}

/** Heartbeat: register/refresh a peer, prune stale ones. */
export function beat(projectId: string, peer: { userId: string; name: string; email: string; tab: string }): Peer[] {
  const b = bus()
  if (!b.peers.has(projectId)) b.peers.set(projectId, new Map())
  const room = b.peers.get(projectId)!
  const now = Date.now()
  for (const [uid, p] of room) if (now - p.at > PEER_TTL_MS) room.delete(uid)
  room.set(peer.userId, { ...peer, at: now, color: colorFor(peer.userId) })
  return [...room.values()]
}

/** Publish a file event (called by the file-save APIs). Never throws. */
export function publishEvent(projectId: string, ev: { path: string; action: CollabAction; byUserId: string; byName: string }) {
  try {
    const b = bus()
    b.eventSeq++
    const list = b.events.get(projectId) || []
    list.push({ id: b.eventSeq, ...ev, at: Date.now() })
    b.events.set(projectId, list.slice(-EVENT_MAX))
  } catch { /* collaboration must never break a save */ }
}

/** Pull events after `since` (event id), pruned. */
export function eventsSince(projectId: string, since: number): CollabEvent[] {
  const b = bus()
  const list = (b.events.get(projectId) || []).filter((e) => e.id > since && Date.now() - e.at < EVENT_TTL_MS)
  return list
}

/** Highest event id ever issued for this project — the client's cursor target. */
export function lastEventId(projectId: string): number {
  const b = bus()
  const list = b.events.get(projectId) || []
  return list.length ? list[list.length - 1].id : 0
}

export function dropPeer(projectId: string, userId: string) {
  bus().peers.get(projectId)?.delete(userId)
}
