/* ============================================================
   VORTEX — Core (main.js)
   Data loading & merging · brand/logo application · shared
   header & footer · announcement · personal update banner ·
   shared utilities. Page renderers live in pages.js.
   ============================================================ */
(() => {
  'use strict';

  const OVERRIDE_KEY = 'vortex_data_override';
  const UV_KEY = 'vortex_user_versions';
  const ANN_KEY = 'vortex_ann_dismissed';
  const SEEN_KEY = 'vortex_seen_versions';
  const LIVE_KEY = 'vx_live_index';      // cached cloud-published data (newest truth)
  const CLOUD_KEY = 'vx-cloud-base';     // cloud base URL (set by the admin panel)
  /* Default cloud base — the public storage service of this website project.
     The admin panel can override it per browser via CLOUD_KEY. If this URL
     goes stale (sandbox restarts), visitors re-discover it from the saved
     cloud URL (see refreshLiveData). */
  const DEFAULT_CLOUD_BASE = 'https://preview-chat-52b6222c-e627-441c-8dd5-82cfd7397854.space-z.ai';
  // GitHub Pages mirror retired (2026-10-22) — the site is 100% VORTEX Cloud now.

  /* ---------------- Utilities ---------------- */
  const VX = {};
  let CURRENT_DATA = null; // effective data (published file merged with local admin override)

  VX.clone = (obj) => JSON.parse(JSON.stringify(obj));

  VX.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** true when version a is newer than version b */
  VX.vNewer = (a, b) => {
    const p = (s) => String(s || '').split(/[.\-_+]/).map((x) => parseInt(x, 10) || 0);
    const A = p(a), B = p(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const d = (A[i] || 0) - (B[i] || 0);
      if (d) return d > 0;
    }
    return false;
  };

  VX.fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return iso || '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  VX.toast = (msg, kind = 'ok', ms = 3800) => {
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const ico = kind === 'ok'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="t-ico"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : kind === 'warn'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="t-ico"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="t-ico"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01" stroke-linecap="round"/></svg>';
    el.innerHTML = ico + '<div>' + VX.esc(msg) + '</div>';
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  };

  VX.slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

  /** Guarantee direct downloads: a GitHub *file page* (…/blob/…) link would
      dump visitors on github.com — rewrite it to the raw direct file so the
      Download button inside Vortex always downloads instantly. Release
      download links (…/releases/download/…) are already direct. */
  VX.directUrl = (u) => {
    const t = String(u || '').trim();
    // Cloud-hosted files: host-relative /api/vx-files/<id> (the stable, private
    // form) resolves against the CURRENT cloud base — which self-heals from
    // cloud-base.json when the sandbox URL changes. Legacy Pages
    // /releases/<id>/<name> URLs (files were mirrored there once) map back to
    // their cloud file id, so even a stale cached catalog keeps working.
    const rel = t.match(/^\/api\/vx-files\/([a-f0-9]{16})$/);
    if (rel) {
      const b = VX.cloudBase();
      return b ? (b + t) : t;
    }
    const legacy = t.match(/^https?:\/\/mdhonabali02\.github\.io\/vortex-website\/releases\/([a-f0-9]{16})\/[^?#]*$/);
    if (legacy) {
      const b = VX.cloudBase();
      return b ? (b + '/api/vx-files/' + legacy[1]) : t;
    }
    const embedded = t.match(/^https?:\/\/[^/]+(\/api\/vx-files\/[a-f0-9]{16})$/);
    if (embedded) {
      const b = VX.cloudBase();
      return b ? (b + embedded[1]) : t;
    }
    try {
      const url = new URL(t);
      if (url.hostname.replace(/^www\./, '') !== 'github.com') return url.href;
      const m = url.pathname.match(/^\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`; // query/hash dropped — not needed for raw files
      return url.href;
    } catch (e) { return t; }
  };

  /* ---------------- Data ---------------- */
  VX.cloudBase = () => {
    let b = null;
    try { b = localStorage.getItem(CLOUD_KEY); } catch (e) { b = null; }
    b = String(b || window.VORTEX_CLOUD_BASE || DEFAULT_CLOUD_BASE).trim().replace(/\/+$/, '');
    return b || null;
  };

  const stampOf = (d) => Date.parse((d && d.meta && d.meta.updatedAt) || 0) || 0;

  /** Effective data = newest of (cloud live index) vs (this browser's admin
      override) vs (bundled apps-data.js). The cloud index is what the admin
      panel publishes — it wins whenever it is newer than the bundled file. */
  VX.getEffectiveData = () => {
    const fileData = window.VORTEX_DATA || { meta: {}, logo: {}, apps: [] };
    let live = null;
    try { live = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); } catch (e) { live = null; }
    if (live && !Array.isArray(live.apps) && live.data && Array.isArray(live.data.apps)) live = live.data;
    if (!live || !Array.isArray(live.apps)) live = null;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || 'null'); } catch (e) { local = null; }
    let best = fileData;
    if (live && stampOf(live) > stampOf(best)) best = live;
    if (local && Array.isArray(local.apps) && stampOf(local) > stampOf(best)) best = local;
    /* WIPE-PROTECTION: a cached cloud index (or override) with an EMPTY app
       list must never shadow the bundled catalog — visitors always see apps. */
    if (best && Array.isArray(best.apps) && !best.apps.length &&
        Array.isArray(fileData.apps) && fileData.apps.length) best = fileData;
    return VX.clone(best);
  };

  /** Fetch the cloud-published index; if it is newer than what we render,
      cache it and (optionally) re-render the whole page with the new data.
      Tries same-origin first (site served from the VORTEX Cloud itself),
      then the configured absolute cloud base. */
  VX.refreshLiveData = (opts) => new Promise((resolve) => {
    const b = VX.cloudBase();
    if (!b) return resolve(null);
    const urls = ['/api/vx-index'];
    if (b && b !== location.origin) urls.push(b + '/api/vx-index');
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // hard cap: a hanging cloud must never keep the page busy for long
    const ac = ('AbortController' in window) ? new AbortController() : null;
    const to = setTimeout(() => { if (ac) ac.abort(); finish(null); }, 9000);
    const adopt = (j) => {
      clearTimeout(to);
      const payload = j && (j.data && Array.isArray(j.data.apps) ? j.data : (Array.isArray(j.apps) ? j : null));
      if (!j || !j.ok || !payload) return false;
      /* WIPE-PROTECTION: never adopt/cache an empty catalog from the cloud —
         a broken publish must not blank out any visitor's screen. */
      if (!payload.apps.length) return false;
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); } catch (e) { cached = null; }
      const newRev = Number(j.rev) || 0;
      const oldRev = Number(cached && cached._rev) || Number((window.VORTEX_DATA || { meta: {} }).meta && window.VORTEX_DATA.meta.rev) || 0;
      if (newRev && newRev >= oldRev) {
        try { localStorage.setItem(LIVE_KEY, JSON.stringify(Object.assign({}, payload, { _rev: newRev }))); } catch (e) { /* ignore */ }
      }
      finish(payload);
      if (opts && opts.rerender && payload) rerenderWithNewest();
      return true;
    };
    (async () => {
      for (const u of urls) {
        try {
          const r = await fetch(u, { cache: 'no-store', signal: ac ? ac.signal : undefined });
          if (r.ok) { const j = await r.json(); if (adopt(j)) return; }
        } catch (e) { /* try next */ }
      }
      // All sources failed → give up quietly; the bundled catalog still
      // renders (offline-tolerant).
      clearTimeout(to);
      finish(null);
    })();
  });

  function rerenderWithNewest() {
    try {
      const data = VX.getEffectiveData();
      CURRENT_DATA = data;
      renderChrome(data);
      renderAnnouncement(data);
      const bannerRoot = document.getElementById('update-banner-root');
      if (bannerRoot) bannerRoot.innerHTML = '';
      renderUpdateBanner(data);
      window.VORTEX = { data, VX };
      if (typeof window.VX_PAGES === 'function') window.VX_PAGES({ data, VX });
    } catch (e) { console.error('[VORTEX] live re-render error:', e); }
  }

  VX.getApps = (data) => (data && data.apps) || [];

  VX.getApp = (data, id) => VX.getApps(data).find((a) => a.id === id) || null;

  VX.iconSrc = (app) => (app && (app.iconData || app.icon)) || 'logo.svg';

  /* ---------------- Seen versions (navbar notification bell) ---------------- */
  /* Remembers which version each visitor last saw. When the published data
     carries something newer, the bell in the navbar lights up and lists it. */
  VX.getSeenVersions = () => {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || 'null') || {}; } catch (e) { return {}; }
  };

  VX.baselineSeenVersions = () => {
    const s = {};
    VX.getApps(CURRENT_DATA || window.VORTEX_DATA || {}).forEach((a) => { s[a.id] = a.version; });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    return s;
  };

  VX.markAppSeen = (appId) => {
    const app = VX.getApp(CURRENT_DATA || window.VORTEX_DATA || {}, appId);
    if (!app) return;
    const s = VX.getSeenVersions();
    s[appId] = app.version;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  };

  /** Apps whose published version is newer than (or missing from) what this
      visitor last saw — these light up the bell. */
  VX.getBellUpdates = () => {
    let seen = null;
    let firstVisit = false;
    try {
      firstVisit = !localStorage.getItem(SEEN_KEY);
      seen = VX.getSeenVersions();
      if (firstVisit) return VX.baselineSeenVersions() && [];
    } catch (e) { return []; }
    return VX.getApps(CURRENT_DATA || window.VORTEX_DATA || {}).filter((a) => {
      if (!seen[a.id]) return true; // added to the catalog after this visit
      return VX.vNewer(a.version, seen[a.id]);
    });
  };

  /* ---------------- User versions (for "Update version available") ---------------- */
  VX.getUserVersions = () => {
    try { return JSON.parse(localStorage.getItem(UV_KEY) || '{}'); } catch (e) { return {}; }
  };

  /** Record that the user obtained this app at this version (download / open) */
  VX.recordUserVersion = (appId, version) => {
    if (!appId || !version) return;
    const uv = VX.getUserVersions();
    uv[appId] = Object.assign({}, uv[appId], { installed: version, ts: Date.now() });
    try { localStorage.setItem(UV_KEY, JSON.stringify(uv)); } catch (e) { /* storage full/blocked */ }
  };

  /** Apps where the user's recorded version is older than the published one */
  VX.getPendingUpdates = (data) => {
    const uv = VX.getUserVersions();
    return VX.getApps(data).filter((a) => {
      const rec = uv[a.id];
      return rec && rec.installed && VX.vNewer(a.version, rec.installed);
    });
  };

  /* Direct downloads & "Open App" clicks record the version immediately
     (best effort). Multi-part [data-vdl] buttons are skipped here —
     download-manager.js records them only after the file has been fully
     assembled, verified and saved. */
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest('[data-record-app][data-record-ver]');
    if (!el || el.closest('[data-vdl]') || el.hasAttribute('data-coming-soon')) return;
    try {
      VX.recordUserVersion(el.getAttribute('data-record-app'), el.getAttribute('data-record-ver'));
    } catch (err) { /* noop */ }
  });

  /* ---------------- Brand / logo ---------------- */
  VX.applyBrand = (data) => {
    const custom = data && data.logo && data.logo.custom;
    document.querySelectorAll('img[data-logo]').forEach((img) => {
      img.src = custom || img.getAttribute('data-default-logo') || 'logo.svg';
    });
    // favicon follows the site logo (a dedicated logo.favicon wins — e.g. a
    // dark brand tile that stays visible on light browser tab bars)
    const link = document.querySelector('link[rel="icon"]');
    if (link) {
      const fav = (data && data.logo && data.logo.favicon) || custom;
      if (fav) link.href = fav;
    }
  };

  /* ---------------- Shared chrome (header + footer) ---------------- */
  const NAV = [
    ['index.html', 'Home'],
    ['marketplace.html', 'Marketplace'],
    ['apk.html', 'Android APKs'],
    ['pwa.html', 'PWA'],
    ['webapps.html', 'Web Apps'],
    ['updates.html', 'Updates'],
    ['contact.html', 'Contact']
  ];

  function renderChrome(data) {
    const page = document.body.dataset.page || '';
    const header = document.getElementById('site-header');
    const footer = document.getElementById('site-footer');

    if (header) {
      header.innerHTML = `
        <div class="nav-inner container">
          <a class="brand" href="index.html" aria-label="VORTEX home">
            <img data-logo data-default-logo="logo.svg" src="logo.svg" alt="VORTEX logo" class="brand-mark">
            <span class="brand-name">VORT<em>EX</em></span>
          </a>
          <nav class="nav-links" id="nav-links" aria-label="Main navigation">
            ${NAV.map(([href, label]) =>
              `<a href="${href}" ${page === href.replace('.html', '') ? 'class="active" aria-current="page"' : ''}>${label}</a>`
            ).join('')}
            <a href="admin.html" rel="nofollow" class="nav-admin" title="Site administration">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v2" stroke-linecap="round"/></svg>
              Admin Panel
            </a>
          </nav>
          <div class="nav-bell">
            <button class="bell-btn" id="bell-btn" type="button" aria-label="Update notifications" aria-expanded="false" aria-controls="bell-panel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M18 8.4a6 6 0 1 0-12 0c0 6.6-2.5 8.1-2.5 8.1h17S18 15 18 8.4Z" stroke-linejoin="round" stroke-linecap="round"/><path d="M13.9 20a2.2 2.2 0 0 1-3.8 0" stroke-linecap="round"/></svg>
              <span class="bell-badge" id="bell-badge" hidden></span>
            </button>
            <div class="bell-panel" id="bell-panel" hidden>
              <div class="bell-head">
                <b>Update notifications</b>
                <button type="button" class="bell-mark" id="bell-mark">Mark all seen</button>
              </div>
              <div class="bell-list" id="bell-list"></div>
            </div>
          </div>
          <a class="btn btn-primary btn-sm nav-cta" href="marketplace.html">Explore Apps</a>
          <button class="nav-burger" id="nav-burger" aria-label="Toggle menu" aria-expanded="false" aria-controls="nav-links">
            <span></span><span></span><span></span>
          </button>
        </div>`;

      const burger = header.querySelector('#nav-burger');
      const links = header.querySelector('#nav-links');
      if (burger && links) {
        burger.addEventListener('click', () => {
          const open = links.classList.toggle('open');
          burger.classList.toggle('open', open);
          burger.setAttribute('aria-expanded', String(open));
        });
        links.addEventListener('click', (e) => {
          if (e.target.tagName === 'A') {
            links.classList.remove('open');
            burger.classList.remove('open');
            burger.setAttribute('aria-expanded', 'false');
          }
        });
      }
    }

    if (footer) {
      const apps = VX.getApps(data).slice(0, 6);
      footer.innerHTML = `
        <div class="container footer-grid">
          <div class="footer-brand">
            <a class="brand" href="index.html">
              <img data-logo data-default-logo="logo.svg" src="logo.svg" alt="VORTEX logo" class="brand-mark">
              <span class="brand-name">VORT<em>EX</em></span>
            </a>
            <p>${VX.esc((data.meta && data.meta.tagline) || 'A powerful universe of apps.')}</p>
            <div class="app-chips">
              <span class="chip chip-accent">Android</span>
              <span class="chip chip-accent">Desktop</span>
              <span class="chip chip-accent">Web</span>
            </div>
          </div>
          <div class="footer-col">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="marketplace.html">Apps Marketplace</a></li>
              <li><a href="apk.html">Android APK Downloads</a></li>
              <li><a href="pwa.html">Progressive Web Apps</a></li>
              <li><a href="webapps.html">Web Applications</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Our Apps</h4>
            <ul>
              ${apps.map((a) => `<li><a href="app.html?id=${encodeURIComponent(a.id)}">${VX.esc(a.name)}</a></li>`).join('') || '<li><a href="marketplace.html">Browse apps</a></li>'}
            </ul>
          </div>
          <div class="footer-col">
            <h4>Legal &amp; Support</h4>
            <ul>
              <li><a href="privacy.html">Privacy Policy</a></li>
              <li><a href="terms.html">Terms of Service</a></li>
              <li><a href="updates.html">Version &amp; Updates</a></li>
              <li><a href="contact.html">Contact Us</a></li>
            </ul>
          </div>
        </div>
        <div class="container footer-bottom">
          <span>© <span id="fyear"></span> VORTEX. All rights reserved.</span>
          <span class="footer-meta">
            <a href="updates.html">Release notes</a>
            <a href="admin.html" rel="nofollow" class="admin-btn" title="Site administration">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v2" stroke-linecap="round"/></svg>
              Admin Panel
            </a>
          </span>
        </div>`;
      const fy = footer.querySelector('#fyear');
      if (fy) fy.textContent = new Date().getFullYear();
    }

    VX.applyBrand(data);
    initBell();
    refreshBell();
    /* Sticky search strip: park it exactly below the sticky navbar on every
       page, so the search box is always on screen and easy to spot. */
    const strip = document.getElementById('search-strip');
    const hdr = document.getElementById('site-header');
    if (strip && hdr) {
      const setStripTop = () => { strip.style.top = hdr.offsetHeight + 'px'; };
      setStripTop();
      window.addEventListener('resize', setStripTop);
      window.addEventListener('load', setStripTop);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(setStripTop).catch(() => {});
    }
  }

  /* ---------------- Notification bell behaviour ---------------- */
  function bellItem(app) {
    const seen = VX.getSeenVersions()[app.id];
    const sub = seen
      ? `Update available — v${VX.esc(seen)} → v${VX.esc(app.version)}`
      : `New in the catalog — v${VX.esc(app.version)}`;
    return `
      <a class="bell-item" href="app.html?id=${encodeURIComponent(app.id)}">
        <img src="${VX.esc(VX.iconSrc(app))}" alt="" onerror="this.src='logo.svg'">
        <span class="bi-body"><b>${VX.esc(app.name)}</b><span>${sub}</span></span>
      </a>`;
  }

  function refreshBell() {
    const badge = document.getElementById('bell-badge');
    const list = document.getElementById('bell-list');
    if (!badge || !list) return;
    let pend = [];
    try { pend = VX.getBellUpdates(); } catch (e) { pend = []; }
    badge.hidden = pend.length === 0;
    badge.textContent = pend.length > 9 ? '9+' : String(pend.length);
    list.innerHTML = pend.length
      ? pend.map(bellItem).join('')
      : '<div class="bell-empty">You are all caught up. When a new VORTEX release or update is published, it will show up here automatically.</div>';
  }

  function initBell() {
    const btn = document.getElementById('bell-btn');
    const panel = document.getElementById('bell-panel');
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !panel.hidden;
      panel.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('a')) { // navigating to the app page
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !e.target.closest('.nav-bell')) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    const mark = document.getElementById('bell-mark');
    if (mark) mark.addEventListener('click', () => {
      VX.baselineSeenVersions();
      refreshBell();
    });
  }

  /* ---------------- Announcement strip ---------------- */
  function renderAnnouncement(data) {
    const root = document.getElementById('announcement-root');
    if (!root) return;
    const ann = (data.meta && data.meta.announcement) || {};
    if (!ann.enabled || !ann.text) return;
    const annId = ann.id || String(Date.parse(data.meta.updatedAt) || '');
    let dismissed = null;
    try { dismissed = localStorage.getItem(ANN_KEY); } catch (e) { /* ignore */ }
    if (dismissed === annId) return;

    const el = document.createElement('div');
    el.className = 'announce';
    el.innerHTML = `
      <div class="container">
        <svg class="megaphone" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 13v-2Z" stroke-linejoin="round"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" stroke-linecap="round"/></svg>
        <p>${VX.esc(ann.text)}</p>
        <button class="announce-close" aria-label="Dismiss announcement">&times;</button>
      </div>`;
    el.querySelector('.announce-close').addEventListener('click', () => {
      try { localStorage.setItem(ANN_KEY, annId); } catch (e) { /* ignore */ }
      el.remove();
    });
    root.appendChild(el);
  }

  /* ---------------- Personal "Update version available" banner ---------------- */
  function renderUpdateBanner(data) {
    const root = document.getElementById('update-banner-root');
    if (!root) return;
    const pending = VX.getPendingUpdates(data);
    if (!pending.length) return;

    const names = pending.slice(0, 3).map((a) => a.name).join(', ');
    const extra = pending.length > 3 ? ` +${pending.length - 3} more` : '';
    const el = document.createElement('div');
    el.className = 'update-banner';
    el.innerHTML = `
      <div class="container">
        <svg class="ub-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <strong>Update version available</strong>
        <span>New updates are ready for ${VX.esc(names)}${VX.esc(extra)}.</span>
        <a href="updates.html">View updates →</a>
      </div>`;
    root.appendChild(el);
  }

  /* ---------------- Global click delegation: record downloads/opens ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-record-app]');
    if (el) {
      const id = el.getAttribute('data-record-app');
      const ver = el.getAttribute('data-record-ver');
      VX.recordUserVersion(id, ver);
      VX.markAppSeen(id); // taking the update clears its bell notification
    }
    const soon = e.target.closest('[data-coming-soon]');
    if (soon) {
      if (soon.tagName === 'A') e.preventDefault();
      VX.toast('This release is not published yet — the download link is coming soon.', 'warn');
    }
  }, true);

  /* ---------------- Boot ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    const data = VX.getEffectiveData();
    CURRENT_DATA = data;
    renderChrome(data);
    renderAnnouncement(data);
    renderUpdateBanner(data);
    window.VORTEX = { data, VX };
    if (typeof window.VX_PAGES === 'function') {
      try { window.VX_PAGES({ data, VX }); }
      catch (err) { console.error('[VORTEX] page renderer error:', err); }
    }
    // Live cloud index — published apps appear for every visitor instantly,
    // without touching the bundled apps-data.js file.
    if (VX.cloudBase()) VX.refreshLiveData({ rerender: true });
  });

  window.VX_CORE = VX;
})();
