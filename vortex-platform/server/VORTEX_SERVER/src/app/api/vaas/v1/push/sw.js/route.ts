/**
 * v147 — Drop-in Service Worker for VORTEX Web Push.
 *
 * Served UNAUTHENTICATED so ANY VaaS app can register it with one line:
 *
 *   const reg = await navigator.serviceWorker.register('/api/vaas/v1/push/sw.js')
 *   const sub = await reg.pushManager.subscribe({
 *     userVisibleOnly: true,
 *     applicationServerKey: vapidPublicKeyB64url, // GET /api/vaas/v1/push/vapid-public?projectId=…
 *   })
 *   await fetch('/api/vaas/v1/push/register', { method: 'POST',
 *     headers: { Authorization: 'Bearer <client-key>', 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ token: JSON.stringify(sub.toJSON()), platform: 'web-push' }) })
 *
 * The push event payload is produced by pushSend ({title, body, data}) — no
 * per-project configuration is needed here, so one worker serves all apps.
 * Self-hosted and STANDARD (RFC 8290/8291) — no Google/FCM involved.
 */
const SW_JS = `// VORTEX Web Push service worker (self-hosted, standard Web Push protocol)
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch { d = { title: 'Notification', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Notification', {
    body: d.body || '',
    icon: d.icon || undefined,
    badge: d.badge || undefined,
    tag: d.tag || undefined,
    data: d.data || {},
    requireInteraction: !!d.requireInteraction,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        try { if (url && url !== '/') await c.navigate(url); } catch {}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
`;

export async function GET() {
  return new Response(SW_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Service-Worker-Allowed": "/",
      "X-Vortex-Feature": "web-push",
    },
  });
}
