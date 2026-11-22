/* ============================================================
   VORTEX Admin — Publisher (panel v10 — TOKEN-FREE)
   ------------------------------------------------------------
   ONE publish target: VORTEX Cloud (your 10 GB sandbox storage).

   1. PUBLISH — "Publish now" sends the catalog to VORTEX Cloud.
      If the cloud is reachable the publish is instant. If it is
      temporarily unreachable, the publish is QUEUED in this
      browser and retried automatically (every 90 s, and every
      time the panel is opened) until it lands. Nothing is lost.

   2. AUTO MIRROR — after every cloud publish the sandbox
      mirrors the catalog + files to GitHub BY ITSELF (server
      side). That is how every visitor and every device sees the
      update — with ZERO tokens and ZERO GitHub logins for you.
      Your devices never touch GitHub. Ever.

   3. STORAGE — the Publish tab shows the 10 GB usage, lists
      every stored file and lets you delete old versions. When
      you upload a new version of a file, the previous version
      is deleted automatically (toggle in the Storage card).

   WIPE-PROOFING (kept from v9):
   · Refuses to publish an EMPTY app catalog (this wiped the site
     once — never again).
   · Auto-publish skips empty catalogs and is OFF by default.
   · "Pull published copy" falls back to the live website files
     when the cloud is unreachable — so every device can sync.

   Upload contract (used by admin-data.js) is kept:
     mount(el, store) · refreshBadge(store) · doPublish()
     scheduleAutoPublish() · cancelUpload() · canUpload()
     preflight() · upload({path,file,sha256,onProgress,stage})
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- config ---------------- */
  const CFG_KEY = 'vx_cloud_cfg';
  const AUTO_KEY = 'vx_auto_publish';
  const PENDING_KEY = 'vx_pending_publish';
  const CLEAN_KEY = 'vx_auto_clean';
  const DEFAULT_CLOUD_BASE = 'https://preview-chat-52b6222c-e627-441c-8dd5-82cfd7397854.space-z.ai';
  // GitHub mirror retired (2026-10-22): the site is 100% VORTEX Cloud now.
  // No GitHub, no Pages, no worker mirrors — publish goes live instantly.
  const PING_TIMEOUT = 8000;

  const CORE = () => window.VX_ADMIN_CORE;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sleepMs = (n) => new Promise((r) => setTimeout(r, n));

  let cfg = { base: DEFAULT_CLOUD_BASE };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* keep default */ }
  if (!cfg.base) cfg.base = DEFAULT_CLOUD_BASE;

  let lastPing = null;
  let apTimer = null, apBusy = false, apPending = false;
  let UPLOAD_CANCEL = false;
  const activeXhrs = new Set(); // every in-flight upload request (all parts)
  let lastKnownCloud = null;
  let SAME_ORIGIN = null;
  let lastPublish = null;      // {at, verified, where}
  let lastSyncStatus = null;   // GitHub mirror status from the cloud
  let fileList = null;         // storage card cache
  let mountGen = 0;
  let retryTimer = null;

  const base = () => String(cfg.base || '').replace(/\/+$/, '');
  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch (e) { return false; } };
  const autoCleanOn = () => { try { return localStorage.getItem(CLEAN_KEY) !== '0'; } catch (e) { return true; } };
  const bundledApps = () => (window.VORTEX_DATA && Array.isArray(window.VORTEX_DATA.apps)) ? window.VORTEX_DATA.apps : [];

  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }

  async function probeSameOrigin() {
    if (SAME_ORIGIN !== null) return SAME_ORIGIN;
    try {
      const r = await fetch('/api/vx-ping', { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      SAME_ORIGIN = !!(r.ok && j && j.ok && j.service === 'VORTEX Cloud');
    } catch (e) { SAME_ORIGIN = false; }
    return SAME_ORIGIN;
  }
  async function apiUrlAsync(p) { await probeSameOrigin(); return (SAME_ORIGIN ? p : base() + p); }

  async function ping() {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), PING_TIMEOUT);
      const r = await fetch(await apiUrlAsync('/api/vx-ping'), { cache: 'no-store', signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      lastPing = await r.json();
      return lastPing;
    } catch (e) { lastPing = null; return null; }
  }

  async function getIndex() {
    const r = await fetch(await apiUrlAsync('/api/vx-index'), { cache: 'no-store' });
    if (!r.ok) throw new Error('Cloud index unreadable (HTTP ' + r.status + ').');
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray((j.data && j.data.apps) || j.apps)) throw new Error('Cloud index is not a VORTEX data file.');
    lastKnownCloud = j;
    return j;
  }

  /* ---------------- Cloud-URL self-healing ----------------
     The sandbox preview URL changes between sessions. When the saved
     Cloud URL stops working, the panel re-discovers the CURRENT URL
     from cloud-base.json — a tiny file the GitHub auto-mirror rewrites
     on every publish (fetched from the always-alive GitHub Pages). */
  let discoveryBusy = null;
  async function discoverCloudBase() {
    if (discoveryBusy) return discoveryBusy;
    discoveryBusy = (async () => {
      const urls = [location.origin + '/cloud-base.json'];
      for (const u of urls) {
        try {
          const ac = ('AbortController' in window) ? new AbortController() : null;
          const to = setTimeout(() => { if (ac) ac.abort(); }, 8000);
          const r = await fetch(u, { cache: 'no-store', signal: ac ? ac.signal : undefined });
          clearTimeout(to);
          if (!r.ok) continue;
          const j = await r.json().catch(() => null);
          const b = String(j && j.base || '').replace(/\/+$/, '');
          if (/^https:\/\//.test(b)) {
            if (b !== base()) {
              cfg.base = b;
              try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
              SAME_ORIGIN = null; // re-probe against the new base
            }
            return b;
          }
        } catch (e) { /* try next source */ }
      }
      return null;
    })();
    try { return await discoveryBusy; } finally { discoveryBusy = null; }
  }
  /** getIndex() with one automatic cloud-URL discovery retry */
  async function getIndexSmart() {
    try { return await getIndex(); }
    catch (e) {
      const nb = await discoverCloudBase();
      if (nb && nb !== base()) { try { return await getIndex(); } catch (e2) { /* fall through */ } }
      throw e;
    }
  }

  async function fetchSyncStatus() {
    try {
      const r = await fetch(await apiUrlAsync('/api/vx-sync-github'), { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      lastSyncStatus = (j && j.ok) ? (j.status || null) : null;
    } catch (e) { lastSyncStatus = null; }
    return lastSyncStatus;
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0, v = Number(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(1) : v) + ' ' + u[i];
  }
  function guessMime(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    const map = { apk: 'application/vnd.android.package-archive', exe: 'application/vnd.microsoft.portable-executable', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', json: 'application/json', txt: 'text/plain' };
    return map[ext] || 'application/octet-stream';
  }

  /* ============================================================
     VORTEX CLOUD — the one publish path
     ============================================================ */
  /* ---------------- logo safety (speed) ----------------
     A giant base64 logo (500 KB+) inside the store makes localStorage
     saves fail on phones — which corrupted local copies and led to the
     empty-catalog wipes. Every publish recompresses the logo to
     ≤512 px / ≤150 KB before it ships, on ALL publish paths. */
  async function recompressLogo(store) {
    try {
      const cur = store && store.logo && store.logo.custom;
      if (!cur || !/^data:image\/[a-z+]+;base64,/i.test(cur) || cur.length <= 160 * 1024) return;
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => rej(new Error('unreadable'));
        im.src = cur;
      });
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth || MAX, img.naturalHeight || MAX));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round((img.naturalWidth || MAX) * scale));
      cv.height = Math.max(1, Math.round((img.naturalHeight || MAX) * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let out = cv.toDataURL('image/webp', 0.85);
      if (!/^data:image\/webp/.test(out) || out.length > cur.length) out = cv.toDataURL('image/png');
      if (out.length < cur.length) {
        store.logo.custom = out;
        if (CORE() && CORE().saveStore) CORE().saveStore(true, true);
      }
    } catch (e) { /* logo untouched — never block a publish on this */ }
  }

  async function publishStoreToCloud(store, opts) {
    opts = opts || {};
    if (!base()) throw new Error('VORTEX Cloud is not configured (Cloud URL missing).');
    await probeSameOrigin();
    // WIPE GUARD (covers EVERY path: manual publish, queued retry,
    // auto-publish). A device that somehow holds an empty catalog must
    // never ship it — this exact accident blanked the live site twice.
    if (!Array.isArray(store.apps) || !store.apps.length) {
      const err = new Error('SAFE-GUARD: this device has 0 apps — publishing would blank the whole site. Press "⇩ Pull published copy" to restore your apps, then publish. Nothing was changed.');
      err.safeGuard = true;
      throw err;
    }
    await recompressLogo(store);
    const localRev = store && store.meta ? Number(store.meta.rev) || 0 : 0;
    let rev = 0;
    try { rev = Number((await getIndexSmart()).rev) || 0; } catch (e) { rev = localRev; /* cloud unreadable even after healing — never let the revision number go backwards */ }
    // STALE-DEVICE GUARD: if the cloud is NEWER than this device, publishing
    // here would erase another device's newer apps. Refuse and say how to
    // fix it — syncOnOpen normally prevents ever reaching this state.
    if (rev > localRev) {
      const err = new Error('SAFE-GUARD: the cloud copy is newer (rev ' + rev + ') than this device (rev ' + localRev + '). Press "⇩ Pull published copy" to update this device first. Nothing was changed.');
      err.stale = true;
      throw err;
    }
    const newRev = rev + 1;
    const payload = {
      rev: newRev,
      cloudBase: SAME_ORIGIN ? location.origin : base(),
      data: {
        meta: Object.assign({}, store.meta || {}, { rev: newRev, publishedAt: store.meta && store.meta.publishedAt ? store.meta.publishedAt : new Date().toISOString() }),
        logo: store.logo || {},
        apps: Array.isArray(store.apps) ? store.apps : []
      }
    };
    let r;
    const putBody = JSON.stringify(payload);
    try {
      r = await fetch(await apiUrlAsync('/api/vx-index'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: putBody
      });
    } catch (e) {
      // Cloud unreachable → try to re-discover the current Cloud URL once,
      // then retry the very same publish with it.
      const nb = await discoverCloudBase();
      if (nb && nb !== base()) {
        try {
          r = await fetch(await apiUrlAsync('/api/vx-index'), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: putBody
          });
        } catch (e2) {
          throw new Error('VORTEX Cloud is not reachable right now (' + base() + ').');
        }
      } else {
        throw new Error('VORTEX Cloud is not reachable right now (' + base() + ').');
      }
    }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep */ }
      throw new Error('Cloud publish failed: ' + msg);
    }
    const saved = await r.json();
    if (!saved || !saved.ok) throw new Error('Cloud publish failed — the service rejected the data.');
    try { store.meta = store.meta || {}; store.meta.rev = newRev; if (CORE() && CORE().saveStore && !opts.skipLocalSave) CORE().saveStore(); } catch (e) { /* non-fatal */ }
    let verified = false;
    try { const back = await getIndex(); verified = Number(back.rev) === newRev; } catch (e) { verified = false; }
    return { rev: newRev, verified, updatedAt: saved.updatedAt };
  }

  /* ---------------- pending-publish queue (offline resilience) ---------------- */
  function loadPending() {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      return (p && p.data && Array.isArray(p.data.apps)) ? p : null;
    } catch (e) { return null; }
  }
  function savePending(s, publishedAt) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ data: s, publishedAt, ts: Date.now() })); } catch (e) { /* storage full */ }
  }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ } }

  async function retryPending() {
    if (apBusy) return;
    const p = loadPending();
    if (!p) return;
    apBusy = true;
    try {
      const r = await publishStoreToCloud(p.data, { skipLocalSave: true });
      clearPending();
      lastPublish = { at: p.publishedAt, verified: true, where: 'cloud (queued publish)' };
      const C = CORE();
      if (C && C.toast) C.toast('✅ The queued publish went live — revision ' + r.rev + '. Every visitor can see it now.', 'ok', 9000);
      await fetchSyncStatus();
      refreshBadge(p.data); renderMountIfMounted(p.data);
      setTimeout(() => autoCheckLive(p.publishedAt, true), 90000);
    } catch (e) {
      // A queued publish that can never land (empty/stale) must not block
      // the queue forever — drop it and sync this device instead.
      if (e && (e.safeGuard || e.stale)) {
        clearPending();
        const C = CORE();
        if (C && C.toast) C.toast('The queued publish was skipped (this device\'s copy was outdated or empty). Updating this device from the cloud instead…', 'warn', 8000);
        syncOnOpen(C && C.store ? C.store() : null);
      }
      /* network errors: still down — stay queued, try again on the next tick */
    }
    finally { apBusy = false; }
  }

  function startRetryLoop() {
    if (retryTimer) return;
    setInterval(retryPending, 90000);
    try { window.addEventListener('online', retryPending); } catch (e) { /* ignore */ }
    retryTimer = true;
    retryPending();
  }

  /* ---------------- live-site check (read-only) ---------------- */
  async function checkLive(publishedAt) {
    const stamp = publishedAt || (lastPublish && lastPublish.at) || '';
    const bases = [];
    [location.origin, lastSyncStatus && lastSyncStatus.state === 'cloudflare' && lastSyncStatus.url ? lastSyncStatus.url : null].forEach((b) => { if (b && bases.indexOf(b) === -1) bases.push(b); });
    for (const b of bases) {
      try {
        const r = await fetch(b + '/js/apps-data.js?cb=' + Date.now(), { cache: 'no-store' });
        if (r.ok) {
          const t = await r.text();
          if (stamp && t.indexOf(stamp) !== -1) return { verified: true, where: b };
          if (!stamp) return { verified: true, where: b };
        }
      } catch (e) { /* next mirror */ }
    }
    return { verified: false, where: '' };
  }

  async function autoCheckLive(publishedAt, quiet) {
    const v = await checkLive(publishedAt);
    if (lastPublish && publishedAt && lastPublish.at === publishedAt) {
      lastPublish.verified = v.verified; lastPublish.where = v.where;
    }
    const C = CORE();
    if (v.verified) {
      renderMountIfMounted();
      if (C && C.toast && !quiet) C.toast('✅ LIVE — confirmed on ' + v.where.replace(/^https?:\/\//, '').split('/')[0] + '. Every visitor can see it now.', 'ok', 9000);
    } else if (!quiet && C && C.toast) {
      C.toast('Live check could not confirm yet — press "Check live site" again in a minute.', 'warn', 9000);
    }
    return v;
  }

  /* ============================================================
     PUBLISH — cloud (with queue fallback) + proof
     ============================================================ */
  async function doPublish(store, opts) {
    const s = store || (CORE() && CORE().store ? CORE().store() : null);
    if (!s) return;
    const C = CORE();
    // WIPE GUARD — this exact accident blanked the live site once.
    if (!Array.isArray(s.apps) || !s.apps.length) {
      if (bundledApps().length) {
        throw new Error('Refusing to publish an EMPTY catalog — it would blank the whole site (this happened before). Press "Pull published copy" first, or re-add your apps.');
      }
    }
    const publishedAt = new Date().toISOString();
    s.meta = s.meta || {};
    s.meta.publishedAt = publishedAt;
    s.meta.updatedAt = publishedAt;
    if (C && C.toast) C.toast('Publishing to VORTEX Cloud…', 'ok', 4000);
    let r;
    try {
      r = await publishStoreToCloud(s, opts);
    } catch (e) {
      const netDown = /not reachable|Failed to fetch|NetworkError|timed out|HTTP 5\d\d|HTTP 0|aborted/i.test((e && e.message) || '');
      if (netDown) {
        savePending(s, publishedAt);
        refreshBadge(s); renderMountIfMounted(s);
        const err = new Error('VORTEX Cloud is not reachable right now — your publish is QUEUED, not lost. This panel retries it automatically every 90 seconds (and every time you open the panel), so it goes live the moment the cloud is reachable. You can close the panel safely.');
        err.queued = true;
        throw err;
      }
      throw e;
    }
    clearPending();
    lastPublish = { at: publishedAt, verified: false, where: '' };
    try { if (CORE() && CORE().saveStore) CORE().saveStore(); } catch (e) { /* non-fatal */ }
    if (C && C.toast) C.toast('✅ Published to VORTEX Cloud (rev ' + r.rev + ') — the GitHub mirror is updating automatically now…', 'ok', 7000);
    await fetchSyncStatus();
    refreshBadge(s); renderMountIfMounted(s);
    setTimeout(() => autoCheckLive(publishedAt, false), 90000);
    return { cloud: r, queued: false, publishedAt };
  }

  /** Pull the published catalog: cloud first, then the live website file. */
  async function pullFromGitHub() {
    const C = CORE();
    let data = null, src = '';
    try {
      const idx = await getIndex();
      data = idx.data || idx; src = 'VORTEX Cloud (rev ' + idx.rev + ')';
    } catch (e) { /* cloud down — fall through to the live site */ }
    if (!data) {
      const bases = [];
      [location.origin, lastSyncStatus && lastSyncStatus.state === 'cloudflare' && lastSyncStatus.url ? lastSyncStatus.url : null].forEach((b) => { if (b && bases.indexOf(b) === -1) bases.push(b); });
      for (const b of bases) {
        try {
          const r = await fetch(b + '/js/apps-data.js?cb=' + Date.now(), { cache: 'no-store' });
          if (!r.ok) continue;
          const t = await r.text();
          const m = t.match(/window\.VORTEX_DATA\s*=\s*([\s\S]*?);\s*$/);
          if (!m) continue;
          data = JSON.parse(m[1]); src = b.replace(/^https?:\/\//, '');
          break;
        } catch (e) { /* next mirror */ }
      }
    }
    if (!data || !Array.isArray(data.apps)) throw new Error('Could not reach the cloud or any live website mirror.');
    if (!data.apps.length) throw new Error('The published copy is empty — refusing to import it (wipe-protection).');
    // keep this device's admin password (it is per-device by design)
    try {
      const cur = JSON.parse(localStorage.getItem('vortex_data_override') || 'null');
      if (cur && cur.auth) data.auth = cur.auth;
    } catch (e) { /* ignore */ }
    try { localStorage.setItem('vortex_data_override', JSON.stringify(data)); } catch (e) { /* storage */ }
    if (C) {
      C.reloadStore();
      if (window.VX_ADMIN_DATA) {
        window.VX_ADMIN_DATA.renderAppsTab(C.store());
        window.VX_ADMIN_DATA.renderDataTab(C.store());
      }
      C.toast('Pulled the published copy from ' + src + ' (' + data.apps.length + ' apps).', 'ok', 7000);
    }
    return data;
  }

  /* ---------------- auto-sync on panel open (cross-device) ----------------
     When the admin opens the panel on ANY device, silently compare it with
     the cloud. A device that is behind (new phone, cleared storage, a
     device that missed the last publish) adopts the cloud copy
     automatically — so every device always shows the full catalog. */
  async function syncOnOpen(store) {
    const C = CORE();
    try {
      const idx = await getIndex();
      const data = idx.data || idx;
      const apps = Array.isArray(data.apps) ? data.apps : [];
      if (!apps.length) return false;            // never adopt an empty cloud copy
      const cloudRev = Number(idx.rev) || 0;
      const localRev = store && store.meta ? Number(store.meta.rev) || 0 : 0;
      if (cloudRev <= localRev) return false;    // this device is current
      if (store && store.auth) data.auth = store.auth; // keep per-device password
      try { localStorage.setItem('vortex_data_override', JSON.stringify(data)); } catch (e) { /* storage */ }
      if (C && C.reloadStore) C.reloadStore();
      if (C && C.toast) C.toast('⇩ This device was behind — updated to revision ' + cloudRev + ' (' + apps.length + ' apps) from VORTEX Cloud.', 'ok', 6500);
      if (window.VX_ADMIN_DATA && C && C.store) {
        window.VX_ADMIN_DATA.renderAppsTab(C.store());
        window.VX_ADMIN_DATA.renderDataTab(C.store());
      }
      refreshBadge(C ? C.store() : store);
      renderMountIfMounted(C ? C.store() : store);
      return true;
    } catch (e) { return false; } // offline — the device just keeps its local copy
  }

  /* ---------------- auto publish (cloud-only, guarded, OFF by default) ---------------- */
  function scheduleAutoPublish() {
    if (!autoOn()) return;
    const s = CORE() && CORE().store ? CORE().store() : null;
    if (!s || !Array.isArray(s.apps) || !s.apps.length) return; // never auto-publish an empty catalog
    apPending = true;
    if (apTimer) clearTimeout(apTimer);
    apTimer = setTimeout(async () => {
      apTimer = null;
      if (!apPending || apBusy) return;
      apPending = false;
      const st = CORE() && CORE().store ? CORE().store() : null;
      if (!st || !Array.isArray(st.apps) || !st.apps.length) return;
      apBusy = true;
      try { await publishStoreToCloud(st, { skipLocalSave: true }); await fetchSyncStatus(); refreshBadge(st); } catch (e) { /* silent; badge shows state */ } finally { apBusy = false; }
    }, 5000);
  }

  /* ---------------- upload dispatcher (Upload Center) ---------------- */
  function canUpload() { return !!base(); }

  async function preflight() {
    if (!base()) return { ok: false, reason: 'setup', message: 'VORTEX Cloud is not configured yet. Open the Publish tab → Advanced → set the Cloud URL. Nothing was changed.' };
    const p = await ping();
    if (!p || !p.ok) {
      return { ok: false, reason: 'down', message: 'VORTEX Cloud is not reachable right now (' + base() + '). Nothing was changed — try again in a minute; publishes also queue and retry automatically.' };
    }
    return { ok: true, target: 'cloud', info: p };
  }

  function b64ToBlob(b64, mime) {
    let raw = String(b64 || '');
    const m = raw.match(/^data:[^;]*;base64,(.*)$/);
    if (m) raw = m[1];
    const bin = atob(raw);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }

  function uploadToCloud(opts) {
    return new Promise((resolve, reject) => {
      UPLOAD_CANCEL = false;
      const name = String((opts && (opts.path || opts.name)) || 'file.bin').split('/').pop() || 'file.bin';
      const stage = (opts && opts.stage) || (() => {});
      const onProgress = (opts && opts.onProgress) || (() => {});
      probeSameOrigin().then(() => {
        let blob = null;
        if (opts && opts.file) blob = opts.file;
        else if (opts && opts.base64) blob = b64ToBlob(opts.base64, (opts.mime || '') || guessMime(name));
        else return reject(new Error('No file data was provided to the uploader.'));
        const basePrefix = SAME_ORIGIN ? '' : base();

        const b64url = (s) => {
          const b = btoa(unescape(encodeURIComponent(String(s))));
          return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const doneResolve = (f, replaced) => {
          onProgress(100);
          let doneMsg = 'Upload complete — stored on VORTEX Cloud.';
          if (replaced) doneMsg += ' Old version deleted automatically (' + fmtBytes(replaced.size) + ' freed).';
          stage(doneMsg);
          // Host-relative link: the sandbox URL never leaks into the catalog,
          // visitors resolve it via the self-healed cloud base, and the mirror
          // never copies the file to GitHub (privacy rule).
          resolve({ url: '/api/vx-files/' + f.id, path: 'vortex-cloud/' + f.name, name: f.name, id: f.id, size: f.size, sha256: f.sha256 || (opts && opts.sha256) || '', chunked: null, target: 'cloud', replaced: replaced || null });
        };
        const cancelled = () => UPLOAD_CANCEL;

        /* ---- SMALL FILE → single POST with auto-retry + stall watchdog ----
           A stalled connection (socket open, zero bytes) is aborted after 25s
           and retried automatically; transient network errors get 2 retries. */
        if (blob.size <= 5 * 1024 * 1024) {
          const buildFd = () => {
            const fd = new FormData();
            fd.append('file', blob, name);
            try {
              fd.append('autoclean', autoCleanOn() ? '1' : '0');
              if (opts && opts.appId) fd.append('appId', String(opts.appId));
              if (opts && opts.slot) fd.append('slot', String(opts.slot));
              if (opts && opts.oldUrl) fd.append('oldUrl', String(opts.oldUrl));
            } catch (e) { /* non-fatal */ }
            return fd;
          };
          let smallPeak = 0; // monotonic — the bar never goes backward
          const sendSmall = (attempt) => {
            const xhr = new XMLHttpRequest();
            activeXhrs.add(xhr);
            xhr.open('POST', basePrefix + '/api/vx-upload', true);
            xhr.timeout = 0; // stall watchdog below handles dead connections
            let stalled = false, sLoaded = 0, lastBytes = 0, lastTick = Date.now();
            const wd = setInterval(() => {
              if (UPLOAD_CANCEL) { clearInterval(wd); return; }
              if (sLoaded !== lastBytes) { lastBytes = sLoaded; lastTick = Date.now(); return; }
              if (Date.now() - lastTick > 25000) { stalled = true; clearInterval(wd); try { xhr.abort(); } catch (e) { /* */ } }
            }, 3000);
            stage('Uploading to VORTEX Cloud…' + (attempt ? ' (auto-retry ' + attempt + ')' : ''));
            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) {
                sLoaded = ev.loaded;
                if (sLoaded > smallPeak) smallPeak = sLoaded;
                onProgress(Math.min(99, Math.round((smallPeak / ev.total) * 100)));
              }
            };
            const retrySmall = (why) => {
              clearInterval(wd); activeXhrs.delete(xhr);
              if (cancelled()) return reject(new Error('Upload cancelled — nothing was changed.'));
              if (attempt < 2) {
                stage(why + ' — auto-retrying…');
                setTimeout(() => sendSmall(attempt + 1), 1200);
              } else {
                const er = new Error(why + ' after ' + (attempt + 1) + ' attempts. Nothing was changed. The cloud may be temporarily unreachable — press Upload to try again in a minute.');
                er.fatal = true;
                reject(er);
              }
            };
            xhr.onload = () => {
              clearInterval(wd); activeXhrs.delete(xhr);
              if (UPLOAD_CANCEL) return reject(new Error('Upload cancelled — nothing was changed.'));
              let j = null;
              try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
              if (xhr.status >= 200 && xhr.status < 300 && j && j.ok) {
                doneResolve(j.file, j.replaced);
              } else if (xhr.status === 0 || xhr.status >= 500) {
                retrySmall('VORTEX Cloud hiccup (error ' + xhr.status + ')');
              } else {
                const msg = (j && j.error) ? j.error : ('VORTEX Cloud rejected the upload (error ' + xhr.status + '). Nothing was changed.');
                reject(new Error(msg));
              }
            };
            xhr.onerror = () => retrySmall('Network error while uploading to VORTEX Cloud');
            xhr.onabort = () => {
              clearInterval(wd); activeXhrs.delete(xhr);
              if (stalled && !cancelled()) return retrySmall('Connection stalled during upload');
              reject(new Error('Upload cancelled — nothing was changed. Your file is untouched, you can start again any time.'));
            };
            xhr.send(buildFd());
          };
          sendSmall(0);
          return;
        }

        /* ---- BIG FILE → chunked upload (fixes "network error") ----
           Splits into 5 MB parts, uploads 3 in parallel with 5 retries per
           part (exponential backoff), then asks the cloud to assemble. Each
           request is small, so no proxy/gateway can abort it mid-flight.
           Flaky-link defences: (1) progress is MONOTONIC — a retry never
           drags the bar backward; (2) a part that sends nothing for 25s is
           aborted and retried instead of blocking a worker; (3) after two
           retry events the uploader enters "steadier mode" — parts start
           staggered so a thin link is not hit by 3 streams at once — and
           leaves it again after 6 clean parts. */
        const CHUNK = 5 * 1024 * 1024;
        const PARALLEL = 3;
        const RETRIES = 5;
        let sid = '';
        try {
          sid = (crypto.randomUUID ? crypto.randomUUID() : (crypto.getRandomValues(new Uint8Array(12)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''))).replace(/-/g, '').slice(0, 24);
        } catch (e) {
          sid = Date.now().toString(16) + Math.floor(Math.random() * 1e8).toString(16);
        }
        const totalParts = Math.ceil(blob.size / CHUNK);
        const nameEnc = b64url(name);
        const mimeEnc = b64url(blob.type || guessMime(name));
        const partBase = basePrefix + '/api/vx-upload-part';
        const loaded = new Array(totalParts).fill(0);
        let doneBytes = 0;   // bytes of fully completed parts
        let peakBytes = 0;   // monotonic high-water mark — bar never drops

        const pushProgress = () => {
          let sum = doneBytes;
          for (let i = 0; i < loaded.length; i++) sum += loaded[i] || 0;
          if (sum > peakBytes) peakBytes = sum;
          onProgress(Math.min(99, Math.round((peakBytes / blob.size) * 100)));
        };

        let badMode = false;   // steadier mode after repeated hiccups
        let consecOk = 0;      // clean parts since the last hiccup

        const uploadPart = (idx, attempt) => new Promise((res, rej) => {
          if (cancelled()) return rej(new Error('Upload cancelled — nothing was changed.'));
          const start = idx * CHUNK;
          const piece = blob.slice(start, Math.min(blob.size, start + CHUNK));
          const xhr = new XMLHttpRequest();
          activeXhrs.add(xhr);
          xhr.open('POST', partBase + '?sid=' + sid + '&n=' + idx, true);
          xhr.timeout = 0; // the stall watchdog below handles dead connections
          let stalled = false, lastBytes = 0, lastTick = Date.now();
          const wd = setInterval(() => {
            if (UPLOAD_CANCEL) { clearInterval(wd); return; }
            if (loaded[idx] !== lastBytes) { lastBytes = loaded[idx]; lastTick = Date.now(); return; }
            if (Date.now() - lastTick > 25000) {
              stalled = true; clearInterval(wd);
              try { xhr.abort(); } catch (e) { /* */ }
            }
          }, 3000);
          const stopWd = () => clearInterval(wd);
          xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) { loaded[idx] = ev.loaded; pushProgress(); } };
          const retry = (why) => {
            stopWd();
            activeXhrs.delete(xhr);
            loaded[idx] = 0;
            if (cancelled()) return rej(new Error('Upload cancelled — nothing was changed.'));
            if (attempt < RETRIES) {
              badMode = true; consecOk = 0;
              if (attempt === 1) stage('Slow connection detected — switching to steadier upload mode…');
              stage(why + ' — retrying (' + (attempt + 1) + '/' + RETRIES + ')…');
              setTimeout(() => uploadPart(idx, attempt + 1).then(res, rej), Math.min(800 * Math.pow(2, attempt), 8000));
            } else {
              const er = new Error(why + ' after ' + RETRIES + ' attempts. Nothing was published — check your connection and press Upload to try again.');
              er.fatal = true;
              rej(er);
            }
          };
          xhr.onload = () => {
            stopWd();
            activeXhrs.delete(xhr);
            let j = null;
            try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
            if (xhr.status >= 200 && xhr.status < 300 && j && j.ok) {
              loaded[idx] = piece.size; doneBytes += piece.size; loaded[idx] = 0;
              consecOk++; if (consecOk >= 6) badMode = false;
              pushProgress();
              res();
            } else {
              retry('Part ' + (idx + 1) + '/' + totalParts + ' failed' + ((j && j.error) ? ': ' + j.error : ''));
            }
          };
          xhr.onerror = () => retry('Connection hiccup on part ' + (idx + 1) + '/' + totalParts);
          xhr.ontimeout = () => retry('Part ' + (idx + 1) + '/' + totalParts + ' timed out');
          xhr.onabort = () => {
            stopWd();
            activeXhrs.delete(xhr);
            if (stalled && !cancelled()) return retry('Part ' + (idx + 1) + '/' + totalParts + ' stalled');
            loaded[idx] = 0;
            rej(new Error('Upload cancelled — nothing was changed.'));
          };
          xhr.send(piece);
        });

        stage('Large file — uploading in ' + totalParts + ' parts (' + fmtBytes(blob.size) + ')…');
        const queue = Array.from({ length: totalParts }, (_, i) => i);
        let cursor = 0;
        let failed = false;
        const worker = () => new Promise((res) => {
          const step = () => {
            if (failed || cancelled()) return res();
            const i = cursor++;
            if (i >= queue.length) return res();
            uploadPart(queue[i], 0).catch(() => { failed = true; }).then(() => {
              // steadier mode: stagger the next part so a thin link is not
              // hit by several streams starting at the same moment
              setTimeout(step, badMode ? 900 : 0);
            });
          };
          step();
        });
        Promise.all([worker(), worker(), worker()].slice(0, PARALLEL)).then(() => {
          if (cancelled()) return reject(new Error('Upload cancelled — nothing was changed.'));
          if (failed) {
            fetch(partBase + '?sid=' + sid, { method: 'DELETE' }).catch(() => {});
            return reject(new Error('Some parts could not be uploaded. Nothing was changed — please check your connection and press Upload again.'));
          }
          stage('Assembling the file on VORTEX Cloud…');
          const fq = new URLSearchParams({ sid, done: '1', name: nameEnc, mime: mimeEnc });
          try {
            fq.set('autoclean', autoCleanOn() ? '1' : '0');
            if (opts && opts.appId) fq.set('appId', String(opts.appId));
            if (opts && opts.slot) fq.set('slot', String(opts.slot));
            if (opts && opts.oldUrl) fq.set('oldUrl', String(opts.oldUrl));
          } catch (e) { /* non-fatal */ }
          return fetch(partBase + '?' + fq.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '',
          }).then(async (r) => {
            let j = null;
            try { j = await r.json(); } catch (e) { j = null; }
            if (r.ok && j && j.ok) return doneResolve(j.file, j.replaced);
            try { await fetch(partBase + '?sid=' + sid, { method: 'DELETE' }); } catch (e) { /* cleanup best-effort */ }
            reject(new Error((j && j.error) || 'Assembling the file failed (HTTP ' + r.status + '). Nothing was changed.'));
          }).catch((er) => reject(new Error('Could not finish the upload (network). Nothing was changed — try again.')));
        });
      }).catch((er) => { reject(er); });
    });
  }

  async function upload(opts) {
    return uploadToCloud(opts);
  }

  function cancelUpload() {
    UPLOAD_CANCEL = true;
    activeXhrs.forEach((x) => { try { x.abort(); } catch (e) { /* ignore */ } });
    activeXhrs.clear();
  }

  /* ---------------- status / badge ---------------- */
  function statusChip(store) {
    if (!lastPing || !lastPing.ok) {
      return `<span class="admin-chip" style="color:#f87171"><span class="dot" style="background:#f87171"></span> Cloud unreachable — publishes queue automatically</span>`;
    }
    const cloudRev = lastKnownCloud ? lastKnownCloud.rev : (lastPing.index ? lastPing.index.rev : 0);
    const localRev = store && store.meta ? Number(store.meta.rev) || 0 : 0;
    if (localRev && cloudRev && localRev < cloudRev) {
      return `<span class="admin-chip" style="color:#fbbf24"><span class="dot" style="background:#fbbf24"></span> Device copy old (rev ${localRev}) — cloud has rev ${cloudRev}</span>`;
    }
    const dirty = localRev && cloudRev && localRev > cloudRev;
    return `<span class="admin-chip" style="color:${dirty ? '#fbbf24' : '#34d399'}"><span class="dot" style="background:${dirty ? '#fbbf24' : '#34d399'}"></span> ${dirty ? 'Unsaved changes — press Publish' : 'LIVE · revision ' + cloudRev}</span>`;
  }

  function mirrorChip() {
    const st = lastSyncStatus;
    if (st && st.state === 'cloudflare') {
      if (st.ok && st.pushed) {
        return `<span class="admin-chip" style="color:#34d399"><span class="dot" style="background:#34d399"></span> Cloudflare Pages live · rev ${esc(String(st.rev || '?'))} · ${esc(String((st.url || '').replace(/^https?:\/\//, '') || 'pages.dev'))}</span>`;
      }
      return `<span class="admin-chip" style="color:#fbbf24"><span class="dot" style="background:#fbbf24"></span> Cloudflare deploy failed — retrying on next publish</span>`;
    }
    if (st && (st.state === 'disabled' || st.state === 'cloudflare-unconfigured')) {
      return `<span class="admin-chip" style="color:#34d399"><span class="dot" style="background:#34d399"></span> Cloud only — live instantly</span>`;
    }
    if (st && st.ok && st.pushed && st.commit) {
      return `<span class="admin-chip" style="color:#34d399"><span class="dot" style="background:#34d399"></span> Mirror synced · rev ${esc(String(st.rev || '?'))}</span>`;
    }
    if (st && st.ok && !st.pushed) {
      return `<span class="admin-chip"><span class="dot"></span> Mirror up to date</span>`;
    }
    if (st && st.ok === false) {
      return `<span class="admin-chip" style="color:#fbbf24"><span class="dot" style="background:#fbbf24"></span> Mirror retrying on next publish</span>`;
    }
    return `<span class="admin-chip" style="color:#34d399"><span class="dot" style="background:#34d399"></span> Cloud only — live instantly</span>`;
  }

  function pendingChip() {
    const p = loadPending();
    if (!p) return '';
    return `<span class="admin-chip" style="color:#fbbf24"><span class="dot" style="background:#fbbf24"></span> Publish queued ${new Date(p.ts).toLocaleTimeString()} — auto-retrying</span>`;
  }

  function refreshBadge(store) {
    const el = document.getElementById('pub-badge');
    if (!el) return;
    const s = store || (CORE() && CORE().store ? CORE().store() : null);
    if (loadPending()) {
      el.innerHTML = `<span class="admin-chip" style="color:#fbbf24"><span class="dot" style="background:#fbbf24"></span> Publish queued — will go live automatically</span>`;
    } else if (lastPing && lastPing.ok) {
      el.innerHTML = `<span class="admin-chip" style="color:#34d399"><span class="dot" style="background:#34d399"></span> Publish ready · cloud rev ${lastKnownCloud ? lastKnownCloud.rev : (lastPing.index ? lastPing.index.rev : '?')}</span>`;
    } else {
      el.innerHTML = `<span class="admin-chip" style="color:#f87171"><span class="dot" style="background:#f87171"></span> Cloud unreachable — publishes queue automatically</span>`;
    }
    if (s && lastPing) el.title = 'Cloud free space: ' + fmtBytes(lastPing.disk && lastPing.disk.freeBytes);
  }

  /* ---------------- Publish tab UI ---------------- */
  let mountEl = null;
  function renderMountIfMounted(store, depth) { if (mountEl) renderMount(mountEl, store, depth); }

  function filesRows() {
    if (!fileList || !fileList.length) return `<tr><td colspan="4" style="padding:.6rem;color:var(--muted-2)">No files stored yet — uploads appear here.</td></tr>`;
    return fileList.map((f) => `
      <tr>
        <td style="padding:.45rem .5rem;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.name)}">${esc(f.name)}</td>
        <td style="padding:.45rem .5rem;white-space:nowrap">${fmtBytes(f.size)}</td>
        <td style="padding:.45rem .5rem;white-space:nowrap;color:var(--muted-2)">${new Date(f.addedAt).toLocaleDateString()}</td>
        <td style="padding:.45rem .5rem;text-align:right"><button class="btn btn-ghost btn-sm" data-del="${esc(f.id)}" data-name="${esc(f.name)}">Delete</button></td>
      </tr>`).join('');
  }

  function renderMount(el, store, depth) {
    if (!el) return;
    mountEl = el;
    const gen = ++mountGen;
    const s = store || (CORE() && CORE().store ? CORE().store() : null);
    const freeGB = lastPing && lastPing.disk ? lastPing.disk.freeGB : null;
    const totalGB = lastPing && lastPing.disk ? lastPing.disk.totalGB : null;
    const files = lastPing && lastPing.files ? lastPing.files : { count: 0, bytes: 0 };
    const pct = (lastPing && lastPing.disk && lastPing.disk.totalBytes)
      ? Math.max(2, Math.round((lastPing.disk.usedBytes / lastPing.disk.totalBytes) * 100)) : 0;

    el.innerHTML = `
      <div class="data-card" id="pub-card">
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19a4.5 4.5 0 1 0-.42-8.98A6 6 0 0 0 5.2 12.5 3.75 3.75 0 0 0 6.5 19h11Z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Publish — one button, no tokens</h3>
        <p>This publishes your catalog to <b>VORTEX Cloud</b> — and it goes <b>live instantly</b>. Every visitor on every device sees the update right away. The site also mirrors to <b>Cloudflare Pages</b> automatically when Cloudflare is connected. No GitHub, no token, no login, nothing to manage.</p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:.8rem 0">
          ${statusChip(s)}
          ${pendingChip()}
          ${mirrorChip()}
          ${lastPublish ? `<span class="admin-chip"><span class="dot"></span> last publish ${lastPublish.verified ? 'verified live' : 'in progress'} · ${new Date(lastPublish.at).toLocaleTimeString()}</span>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="pub-now">⇧ Publish now</button>
          <button class="btn btn-ghost" id="pub-pull">⇩ Pull published copy</button>
          <button class="btn btn-ghost btn-sm" id="pub-check">↻ Check live site</button>
        </div>
        <div id="pub-msg" class="pub-detail" style="margin-top:.7rem"></div>
        <details style="margin-top:.9rem">
          <summary style="cursor:pointer;color:var(--muted-2)">Advanced — cloud URL</summary>
          <div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">
            <input id="vx-cloud-url" type="url" value="${esc(base())}" placeholder="https://preview-….space-z.ai" style="flex:1;min-width:240px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:var(--text);padding:.55rem .7rem">
            <button class="btn btn-ghost btn-sm" id="vx-cloud-save-url">Save &amp; test</button>
          </div>
          <p class="muted" style="margin:.5rem 0 0;font-size:.85rem">The address of your VORTEX Cloud storage. Filled in automatically — change it only if the storage moves.</p>
        </details>
      </div>

      <div class="data-card" id="vx-storage-card" style="margin-top:1rem">
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7" stroke-linecap="round"/></svg>
          Storage — VORTEX Cloud ${totalGB ? '(' + totalGB + ' GB)' : ''}</h3>
        <p>${totalGB ? '<b>' + freeGB + ' GB free</b> of ' + totalGB + ' GB' : 'Checking free space…'} · ${files.count} file${files.count === 1 ? '' : 's'} · ${fmtBytes(files.bytes)} stored. When you upload a new version of a file, the old version is deleted automatically if you keep the toggle below ON.</p>
        <div style="background:rgba(255,255,255,.06);border-radius:8px;height:8px;overflow:hidden;max-width:420px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#22d3ee,#a78bfa)"></div>
        </div>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:.9rem 0 .4rem">
          <label class="admin-chip" style="cursor:pointer"><input type="checkbox" id="vx-autoclean" ${autoCleanOn() ? 'checked' : ''} style="margin-right:.45rem"> Auto-delete the old version when I upload a new one</label>
          <button class="btn btn-ghost btn-sm" id="vx-files-refresh">↻ Refresh</button>
        </div>
        <div style="max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-top:.5rem">
          <table style="width:100%;border-collapse:collapse;font-size:.9rem">
            <thead><tr style="text-align:left;color:var(--muted-2)"><th style="padding:.5rem">File</th><th style="padding:.5rem">Size</th><th style="padding:.5rem">Uploaded</th><th></th></tr></thead>
            <tbody id="vx-files-body">${filesRows()}</tbody>
          </table>
        </div>
        <div id="vx-files-msg" class="pub-detail" style="margin-top:.6rem"></div>
      </div>`;

    /* ---- wiring ---- */
    const msg = (t, kind) => {
      const m = document.getElementById('pub-msg');
      if (m) m.innerHTML = t ? `<span style="color:${kind === 'err' ? '#f87171' : kind === 'warn' ? '#fbbf24' : '#34d399'}">${t}</span>` : '';
    };
    const fmsg = (t, kind) => {
      const m = document.getElementById('vx-files-msg');
      if (m) m.innerHTML = t ? `<span style="color:${kind === 'err' ? '#f87171' : kind === 'warn' ? '#fbbf24' : '#34d399'}">${t}</span>` : '';
    };

    const pubBtn = el.querySelector('#pub-now');
    if (pubBtn) pubBtn.addEventListener('click', async () => {
      pubBtn.disabled = true;
      msg('Publishing — this sends your catalog to VORTEX Cloud…', 'warn');
      try {
        const r = await doPublish(s);
        msg(r && r.cloud
          ? '✅ Published to VORTEX Cloud (rev ' + r.cloud.rev + ') — live instantly. Press "Check live site" to verify.'
          : 'Published.', 'ok');
      } catch (e) {
        msg('⚠ ' + esc(e && e.message ? e.message : 'Publish failed.'), e && e.queued ? 'warn' : 'err');
      }
      pubBtn.disabled = false;
    });

    const pullBtn = el.querySelector('#pub-pull');
    if (pullBtn) pullBtn.addEventListener('click', async () => {
      pullBtn.disabled = true;
      msg('Pulling the published copy (cloud → live website)…', 'warn');
      try {
        const d = await pullFromGitHub();
        msg('⇩ Pulled ' + d.apps.length + ' apps — this browser now matches what visitors see.', 'ok');
      } catch (e) {
        msg('⚠ ' + esc(e && e.message ? e.message : 'Pull failed.'), 'err');
      }
      pullBtn.disabled = false;
    });

    const checkBtn = el.querySelector('#pub-check');
    if (checkBtn) checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      msg('Checking the live website…', 'warn');
      const v = await checkLive(null);
      msg(v.verified
        ? '✅ LIVE — the published catalog is visible on ' + esc(v.where.replace(/^https?:\/\//, '')) + '.'
        : 'The live mirrors have not picked up the latest publish yet (usually under 2 minutes). Try again shortly.', v.verified ? 'ok' : 'warn');
      checkBtn.disabled = false;
    });

    const autoClean = el.querySelector('#vx-autoclean');
    if (autoClean) autoClean.addEventListener('change', () => {
      try { localStorage.setItem(CLEAN_KEY, autoClean.checked ? '1' : '0'); } catch (e) { /* ignore */ }
      const C = CORE();
      if (C && C.toast) C.toast(autoClean.checked ? 'Auto-clean ON — uploading a new version deletes the old one automatically.' : 'Auto-clean OFF — old versions are kept; free space from the file list below.', 'ok');
    });

    const saveUrl = el.querySelector('#vx-cloud-save-url');
    if (saveUrl) saveUrl.addEventListener('click', async () => {
      const inp = el.querySelector('#vx-cloud-url');
      const v = String(inp && inp.value || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(v)) { msg('⚠ Enter a full URL starting with https://', 'err'); return; }
      cfg.base = v; saveCfg(); SAME_ORIGIN = null;
      msg('Testing the cloud URL…', 'warn');
      lastKnownCloud = null;
      const p = await ping();
      if (p && p.ok) { msg('✅ Connected — ' + (p.disk ? p.disk.freeGB + ' GB free' : 'service reachable') + '.', 'ok'); refreshBadge(s); }
      else msg('⚠ Could not reach ' + esc(v) + ' — publishes will queue and retry automatically.', 'err');
    });

    async function refreshFiles() {
      try {
        await ping();
        const r = await fetch(await apiUrlAsync('/api/vx-files'), { cache: 'no-store' });
        const j = await r.json().catch(() => null);
        if (j && j.ok) {
          fileList = Array.isArray(j.files) ? j.files : [];
          const body = el.querySelector('#vx-files-body');
          if (body) body.innerHTML = filesRows();
        }
        await getIndex().catch(() => { lastKnownCloud = null; });
        await fetchSyncStatus();
        refreshBadge(s);
      } catch (e) { /* card shows stale data — fine */ }
    }

    el.addEventListener('click', async (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-del]') : null;
      if (!btn) return;
      const C = CORE();
      const doDel = async () => {
        btn.disabled = true;
        try {
          const r = await fetch(await apiUrlAsync('/api/vx-files/' + btn.getAttribute('data-del')), { method: 'DELETE' });
          const j = await r.json().catch(() => null);
          if (j && j.ok) { fmsg('✅ Deleted ' + esc(btn.getAttribute('data-name')) + ' — space freed.', 'ok'); await refreshFiles(); }
          else fmsg('⚠ Could not delete that file.', 'err');
        } catch (e) { fmsg('⚠ Delete failed — check the connection.', 'err'); }
        btn.disabled = false;
      };
      if (C && C.confirmAction) C.confirmAction('Delete file?', esc(btn.getAttribute('data-name')) + ' will be removed from VORTEX Cloud. Downloads pointing to it stop working.', doDel);
      else doDel();
    });

    const frBtn = el.querySelector('#vx-files-refresh');
    if (frBtn) frBtn.addEventListener('click', () => refreshFiles());

    // initial async status fill — refresh the view ONCE when data arrives
    (async () => {
      await ping();
      await refreshFiles();
      if (gen !== mountGen || depth > 0) return;
      renderMountIfMounted(s, (depth || 0) + 1);
    })();
    startRetryLoop();
  }

  /* ---------------- compat stubs ---------------- */
  function checkSync() { return { state: lastKnownCloud ? 'synced' : 'unknown', published: lastKnownCloud && (lastKnownCloud.data || lastKnownCloud) }; }
  async function refreshStatus(store) { await ping(); try { await getIndex(); } catch (e) { /* ignore */ } await fetchSyncStatus(); refreshBadge(store); }
  function mergeStores() { return null; }
  function describeDiff() { return ''; }
  function deploySiteFiles() { return Promise.resolve({ ok: true, skipped: true }); }
  function detectSite() { return { repo: null, public: true }; }

  /* ---------------- hooks ---------------- */
  window.VX_ADMIN_PUBLISH = {
    mount: renderMount,
    refreshStatus,
    refreshBadge,
    doPublish,
    pullFromGitHub,
    syncOnOpen,
    checkSync,
    scheduleAutoPublish,
    mergeStores,
    describeDiff,
    upload,
    cancelUpload,
    canUpload,
    preflight,
    autoCleanOn,
    detectSite,
    deploySiteFiles,
    github: { repo: null, branch: null, hasToken: () => false },
    debug: () => ({ base: base(), lastPing, autoOn: autoOn(), autoClean: autoCleanOn(), apBusy, apPending, pending: !!loadPending(), lastSyncStatus, lastPublish })
  };
})();
