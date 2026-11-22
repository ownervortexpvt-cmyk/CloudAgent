/* ============================================================
   VORTEX — Admin Panel core (admin.js)
   Strong client-side security for static hosting:
   · Salted SHA-256 password hashing (Web Crypto API)
   · Brute-force lockout with exponential backoff
   · 30-minute sliding session with auto-lock
   · No plaintext password is ever stored or transmitted
   Tabs for Apps/Data are implemented in admin-data.js.
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'vortex_data_override';
  const LOCK_KEY = 'vortex_admin_lock';
  const SESS_KEY = 'vortex_admin_session';
  const SESSION_MS = 30 * 60 * 1000; // 30 minutes

  /** Default credentials: password 1000391619244862 (change it after first login!) */
  const DEFAULT_AUTH = {
    salt: 'vx~2026#V0rt3x$Adm1n^S4lt9k2',
    hash: '5c8ba2e42e53e04b7c4906242cb0e0e110307eb6953f5b65a4be606ea3d30e0b'
  };

  /* ---------------- utilities ---------------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function toast(msg, kind = 'ok', ms = 4200) {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const ico = kind === 'ok'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="t-ico"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="t-ico"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    el.innerHTML = ico + '<div>' + esc(msg) + '</div>';
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  }

  /** SHA-256 hex (Web Crypto) with a compact fallback for exotic contexts */
  async function sha256Hex(str) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback (different prefix so it can never collide with a real digest)
    let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    for (let r = 0; r < 997; r++) {
      h1 = Math.imul(h1 ^ (h1 >>> 15), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    }
    const hx = (h) => (h >>> 0).toString(16).padStart(8, '0');
    return 'fb.' + hx(h1) + hx(h2) + hx(h1 ^ h2) + hx(Math.imul(h1, h2) >>> 0);
  }

  const randSalt = () =>
    Array.from(crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : new Uint8Array(12).map(() => Math.floor(Math.random() * 256)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** Downscale an uploaded image to keep data URLs small (keeps transparency).
      Reports the detected source size to the callback: cb(dataUrl, info{w,h}) */
  function compressImage(file, max, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const info = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
        const scale = Math.min(1, max / Math.max(info.w, info.h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(info.w * scale));
        c.height = Math.max(1, Math.round(info.h * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/png'), info);
      };
      img.onerror = () => toast('Could not read that image file.', 'err');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /** Human verdict for an auto-detected logo/icon size */
  function sizeVerdict(w, h, kind) {
    const s = Math.max(w, h);
    const square = Math.abs(w - h) <= Math.max(2, Math.round(Math.max(w, h) * 0.02));
    let quality;
    if (kind === 'logo') quality = s >= 512 ? 'excellent' : s >= 256 ? 'good' : s >= 128 ? 'okay' : 'low';
    else quality = s >= 256 ? 'excellent' : s >= 128 ? 'good' : s >= 64 ? 'okay' : 'low';
    const qText = { excellent: 'excellent quality', good: 'good quality', okay: 'acceptable', low: 'LOW resolution — it may look blurry, consider a bigger image' }[quality];
    const shape = square ? 'square ✓' : `not square (${w}×${h}) — it will be scaled to fit`;
    return `Detected: ${w}×${h} px · ${shape} · ${qText}. Auto-optimised for the web.`;
  }

  /* ---------------- data store ---------------- */
  let store = null;
  const LASTGOOD_KEY = 'vx_last_good_store'; // emergency snapshot with ≥1 app

  function seedStore() {
    const base = JSON.parse(JSON.stringify(window.VORTEX_DATA || { meta: {}, logo: {}, apps: [] }));
    base.auth = null; // null → DEFAULT_AUTH
    return base;
  }

  function stampOf(d) {
    try { return Date.parse((d && d.meta && d.meta.updatedAt) || '') || 0; } catch (e) { return 0; }
  }
  function readLastGood() {
    try {
      const lg = JSON.parse(localStorage.getItem(LASTGOOD_KEY) || 'null');
      if (lg && Array.isArray(lg.apps) && lg.apps.length > 0) return lg;
    } catch (e) { /* ignore */ }
    return null;
  }

  function loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    if (raw && !Array.isArray(raw.apps)) raw = null;
    const lastGood = readLastGood();
    if (raw && Array.isArray(raw.apps)) {
      const bundled = (window.VORTEX_DATA && window.VORTEX_DATA.apps) || [];
      if (!raw.apps.length && bundled.length) {
        /* WIPE-PROTECTION: an empty saved catalog must never shadow the real
           one — self-heal from the bundled apps-data.js instead. */
        store = seedStore();
        store.meta = Object.assign({}, raw.meta || {}, store.meta, { updatedAt: new Date().toISOString() });
        if (raw.logo && raw.logo.custom && !store.logo.custom) store.logo = raw.logo;
        if (typeof toast === 'function') toast('Local copy was empty — the published catalog was restored automatically (wipe-protection).', 'warn', 8000);
        return;
      }
      /* LAST-GOOD HEAL: raw is empty AND even the bundled file is empty (the
         exact death-spiral state after a bad publish was mirrored) — restore
         the newest known-good snapshot instead of staying empty. */
      if (!raw.apps.length && lastGood && stampOf(lastGood) >= stampOf(raw)) {
        store = lastGood;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
        if (typeof toast === 'function') toast('Local copy was empty — restored the last good catalog (' + store.apps.length + ' apps).', 'warn', 8000);
        return;
      }
      store = raw; return;
    }
    // raw missing or corrupt
    store = seedStore();
    if (!store.apps.length && lastGood) {
      store = lastGood;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
    }
  }

  function saveStore(persistAuth = true, skipAuto = false) {
    if (!persistAuth) delete store.auth;
    store.meta = store.meta || {};
    store.meta.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      // keep the emergency snapshot fresh (only catalogs with ≥1 app)
      if (store.apps && store.apps.length > 0) {
        try { localStorage.setItem(LASTGOOD_KEY, JSON.stringify(store)); } catch (e) { /* quota — snapshot is best-effort */ }
      }
      // any successful save may go live: notify the auto-publish engine
      if (!skipAuto && window.VX_ADMIN_PUBLISH && window.VX_ADMIN_PUBLISH.scheduleAutoPublish) {
        window.VX_ADMIN_PUBLISH.scheduleAutoPublish();
      }
      return true;
    } catch (e) {
      toast('Storage full — data could not be saved. Export & publish, then clear the local override.', 'err', 6500);
      return false;
    }
  }

  /** Replace this device's store with the cloud-published copy (used by
      syncOnOpen). Keeps the per-device admin password. */
  function adoptCloudData(data) {
    if (!data || !Array.isArray(data.apps) || !data.apps.length) return false;
    const auth = store && store.auth ? store.auth : null;
    store = data;
    if (auth) store.auth = auth;
    saveStore(true, true); // persist WITHOUT firing auto-publish (no rev churn)
    return true;
  }

  function getAuth() {
    return (store && store.auth) || DEFAULT_AUTH;
  }

  /* ---------------- confirm modal ---------------- */
  let modalCb = null;
  function confirmAction(title, text, cb, okLabel) {
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-ok').textContent = okLabel || 'Yes, continue';
    modalCb = cb;
    $('#modal-backdrop').classList.add('show');
  }
  $('#modal-cancel').addEventListener('click', () => { modalCb = null; $('#modal-backdrop').classList.remove('show'); });
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) { modalCb = null; $('#modal-backdrop').classList.remove('show'); } });
  $('#modal-ok').addEventListener('click', () => {
    $('#modal-backdrop').classList.remove('show');
    if (modalCb) { const cb = modalCb; modalCb = null; cb(); }
  });

  /* ---------------- session management ---------------- */
  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null');
      return (s && s.exp > Date.now()) ? s : null;
    } catch (e) { return null; }
  }
  function startSession() {
    sessionStorage.setItem(SESS_KEY, JSON.stringify({ t: randSalt(), exp: Date.now() + SESSION_MS }));
  }
  function extendSession() {
    const s = getSession();
    if (s) sessionStorage.setItem(SESS_KEY, JSON.stringify({ t: s.t, exp: Date.now() + SESSION_MS }));
  }
  function endSession() { sessionStorage.removeItem(SESS_KEY); }

  /* ---------------- brute-force lockout ---------------- */
  function getLock() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null') || { fails: 0, until: 0 }; }
    catch (e) { return { fails: 0, until: 0 }; }
  }
  function setLock(l) {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch (e) { /* ignore */ }
  }

  /* ---------------- auth flow ---------------- */
  let lockTimer = null;

  function showLoginError(msg) {
    const box = $('#login-err');
    $('#login-err-text').textContent = msg;
    box.classList.add('show');
  }

  function startLockCountdown() {
    if (lockTimer) clearInterval(lockTimer);
    const tick = () => {
      const lock = getLock();
      const remain = lock.until - Date.now();
      const btn = $('#login-btn');
      if (remain > 0) {
        const s = Math.ceil(remain / 1000);
        const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
        btn.disabled = true;
        btn.textContent = `Locked — retry in ${mm}:${ss}`;
        showLoginError(`Too many failed attempts. The panel is locked for ${s} more second${s === 1 ? '' : 's'}.`);
      } else {
        btn.disabled = false;
        btn.textContent = 'Unlock Panel';
        if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
      }
    };
    tick();
    lockTimer = setInterval(tick, 1000);
  }

  async function tryLogin(password) {
    const lock = getLock();
    if (lock.until > Date.now()) { startLockCountdown(); return; }

    const auth = getAuth();
    const inputHash = await sha256Hex((auth.salt || '') + password);
    if (inputHash === auth.hash) {
      setLock({ fails: 0, until: 0 });
      $('#login-err').classList.remove('show');
      startSession();
      enterPanel();
      toast('Welcome back, admin.', 'ok');
    } else {
      lock.fails = (lock.fails || 0) + 1;
      if (lock.fails >= 5) {
        const delay = Math.min(30000 * Math.pow(2, lock.fails - 5), 15 * 60 * 1000);
        lock.until = Date.now() + delay;
      }
      setLock(lock);
      const left = lock.fails >= 5
        ? ' Too many failed attempts — the panel is now temporarily locked.'
        : ` Incorrect password. ${5 - lock.fails} attempt${5 - lock.fails === 1 ? '' : 's'} left before a temporary lockout.`;
      showLoginError('Incorrect password.' + left);
      if (lock.until > Date.now()) startLockCountdown();
    }
  }

  /* ---------------- password strength ---------------- */
  function pwScore(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-zA-Z]/.test(pw) && /\d/.test(pw)) s++;
    if (/[^a-zA-Z0-9]/.test(pw)) s++;
    if (pw && pw !== '1000391619244862') s++;
    return s; // 0..5
  }

  /* ---------------- views ---------------- */
  function enterPanel() {
    $('#login-view').style.display = 'none';
    $('#panel-view').style.display = 'block';
    renderAllTabs();
    // CROSS-DEVICE AUTO-SYNC: silently compare with the cloud and adopt the
    // newer published copy, so admin login on ANY device shows everything.
    const P = window.VX_ADMIN_PUBLISH;
    if (P && P.syncOnOpen) P.syncOnOpen(store);
  }
  function exitPanel() {
    endSession();
    $('#panel-view').style.display = 'none';
    $('#login-view').style.display = 'grid';
    $('#login-pw').value = '';
  }

  /* ---------------- tabs ---------------- */
  const TABS = ['dashboard', 'apps', 'logo', 'settings', 'account', 'data'];

  function switchTab(name) {
    TABS.forEach((t) => { $('#tab-' + t).hidden = (t !== name); });
    $$('#admin-tabs .admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (window.VX_ADMIN_DATA) window.VX_ADMIN_DATA.onTab(name, store);
    if (name === 'dashboard') renderDashboard();
    if (name === 'logo') renderLogoTab();
    if (name === 'settings') renderSettingsTab();
    if (name === 'account') renderAccountTab();
  }

  function renderAllTabs() {
    if (window.VX_ADMIN_DATA) window.VX_ADMIN_DATA.renderAppsTab(store);
    if (window.VX_ADMIN_DATA) window.VX_ADMIN_DATA.renderDataTab(store);
    switchTab('dashboard');
  }

  /* ---------------- dashboard ---------------- */
  function renderDashboard() {
    const el = $('#tab-dashboard');
    const apps = store.apps || [];
    const liveLinks = apps.reduce((n, a) => n + (a.links ? ['apk', 'exe', 'web', 'pwa'].filter((k) => a.links[k]).length : 0), 0);
    const logoState = (store.logo && store.logo.custom) ? 'Custom logo active' : 'Default VORTEX logo';
    const now = new Date();
    const lock = getLock();

    el.innerHTML = `
      <h2>Dashboard</h2>
      <p class="panel-sub">Everything you change here saves to <b>this browser</b> instantly. Publish it with one click so <b>every visitor</b> sees it too.</p>

      <div class="stat-grid">
        <div class="stat-box accent"><b>${apps.length}</b><small>Apps published</small></div>
        <div class="stat-box accent"><b>${liveLinks}</b><small>Live APK / EXE / Web / PWA links</small></div>
        <div class="stat-box"><b style="font-size:1rem;padding-top:.35rem">${esc(logoState)}</b><small>Brand identity</small></div>
        <div class="stat-box"><b style="font-size:1rem;padding-top:.35rem">${esc(now.toLocaleDateString())}</b><small>Data last saved</small></div>
      </div>

      <div class="quick-row">
        <button class="btn btn-primary" data-goto="apps">Manage apps &amp; links</button>
        <button class="btn btn-ghost" data-goto="logo">Change site logo</button>
        <button class="btn btn-ghost" data-goto="data">Publish changes ↗</button>
      </div>

      <div id="pub-badge"></div>

      <div class="guide-box">
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-6 4h6M9 8h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          How publishing works — one click, all visitors</h3>
        <ol>
          <li>Edit apps, links, versions and logo here — you see results on the site <b>immediately</b> in your browser.</li>
          <li>Open the <b>☁ Cloud</b> tab — your VORTEX Cloud storage (about 8 GB free) is already connected. No GitHub, no tokens, nothing expires.</li>
          <li>Press <b>Publish now</b> (or just leave auto-publish on): your apps and files go straight to the cloud and go live instantly.</li>
          <li>Every visitor worldwide sees the new version within seconds — the site reads your live cloud data automatically.</li>
        </ol>
      </div>

      ${lock.fails > 0 ? `<div class="guide-box warn" style="margin-top:1.4rem"><h3>⚠ Security notice</h3><p class="muted" style="margin:0">There ${lock.fails === 1 ? 'was 1 failed' : 'were ' + lock.fails + ' failed'} login attempt${lock.fails === 1 ? '' : 's'} on this device. The panel locks automatically after 5 failures.</p></div>` : ''}
    `;

    $$('.quick-row [data-goto]', el).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.goto)));

    if (window.VX_ADMIN_PUBLISH) window.VX_ADMIN_PUBLISH.refreshBadge(store);
  }

  /* ---------------- logo tab ---------------- */
  function renderLogoTab() {
    const el = $('#tab-logo');
    const custom = store.logo && store.logo.custom;
    el.innerHTML = `
      <h2>Site logo</h2>
      <p class="panel-sub">Upload your own logo — it replaces the default VORTEX mark in the header, footer, favicon and admin panel, across the whole site.</p>

      <div class="logo-stage">
        <div class="logo-preview"><img id="logo-preview-img" src="${esc(custom || 'logo.svg')}" alt="Current logo"></div>
        <div class="ls-info">
          <h3>${custom ? 'Custom logo is active' : 'Default VORTEX logo is active'}</h3>
          <p>Recommended: square PNG or JPG, at least 512×512 px, transparent background. The panel <b>auto-detects the image size</b> and optimises it — just upload.</p>
          <div class="logo-detect" id="logo-detect" hidden></div>
          <div class="quick-row" style="margin:1rem 0 0">
            <label class="btn btn-primary" style="cursor:pointer">Upload new logo
              <input type="file" id="logo-file" accept="image/*" style="display:none">
            </label>
            ${custom ? '<button class="btn btn-ghost" id="logo-download">Download logo file</button>' : ''}
            ${custom ? '<button class="btn btn-danger" id="logo-reset">Reset to default</button>' : ''}
          </div>
        </div>
      </div>

      <div class="guide-box">
        <h3>Good to know</h3>
        <ol>
          <li>Your uploaded logo is applied instantly — switch to the public site tab and refresh to see it.</li>
          <li>The logo travels inside your app data: publish once (Data / Publish tab) and every visitor sees it. With auto-publish ON it goes live by itself.</li>
          <li>You can swap the logo any time — the old one is simply replaced everywhere.</li>
        </ol>
      </div>
    `;

    $('#logo-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Please choose an image file (PNG, JPG, SVG, WEBP).', 'err'); return; }
      if (file.size > 4 * 1024 * 1024) { toast('Image is too large — please use a file under 4 MB.', 'err'); return; }
      const box = $('#logo-detect');
      box.hidden = false;
      box.className = 'logo-detect checking';
      box.textContent = '⏳ Reading image & auto-detecting size…';
      compressImage(file, 512, (dataUrl, info) => {
        const verdict = sizeVerdict(info.w, info.h, 'logo');
        const low = /LOW/.test(verdict);
        box.className = 'logo-detect ' + (low ? 'warn' : 'ok');
        box.textContent = '✓ ' + verdict;
        store.logo = store.logo || {};
        store.logo.custom = dataUrl;
        store.logo.updatedAt = new Date().toISOString(); // timestamp → safe merges
        if (saveStore()) {
          const ghc = (JSON.parse(localStorage.getItem('vortex_gh_cfg') || 'null') || {});
          toast('Logo applied — it is now live in your browser.' + (ghc.autoPublish && ghc.lastRev ? ' Auto-publish will make it live for everyone.' : ' Publish via Data tab for all visitors.'), 'ok');
          VX_CORE && VX_CORE.applyBrand && VX_CORE.applyBrand(store);
          renderLogoTab();
        }
      });
    });

    const dl = $('#logo-download');
    if (dl) dl.addEventListener('click', () => {
      fetch(custom).then((r) => r.blob()).then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = url; a.download = 'vortex-logo.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
    });

    const reset = $('#logo-reset');
    if (reset) reset.addEventListener('click', () => {
      confirmAction('Reset logo?', 'The default VORTEX logo will be restored everywhere.', () => {
        store.logo = { custom: null };
        if (saveStore()) {
          toast('Logo reset to default.', 'ok');
          VX_CORE && VX_CORE.applyBrand && VX_CORE.applyBrand(store);
          renderLogoTab();
        }
      }, 'Reset logo');
    });
  }

  /* ---------------- settings tab ---------------- */
  function renderSettingsTab() {
    const el = $('#tab-settings');
    const m = store.meta || {};
    const ann = m.announcement || {};
    el.innerHTML = `
      <h2>Site settings</h2>
      <p class="panel-sub">Global settings used across every public page.</p>
      <div class="ed-grid">
        <div class="field full">
          <label for="s-email">Contact email</label>
          <input type="email" id="s-email" placeholder="you@example.com" value="${esc(m.contactEmail || '')}">
          <small>The contact form on the Contact page opens the visitor's email app addressed to this address.</small>
        </div>
        <div class="field full">
          <label for="s-tagline">Site tagline (footer)</label>
          <input type="text" id="s-tagline" maxlength="140" value="${esc(m.tagline || '')}">
        </div>
        <div class="field full">
          <div class="switch-row">
            <input type="checkbox" id="s-ann-on" ${ann.enabled ? 'checked' : ''}>
            <label for="s-ann-on">Show announcement strip on all pages</label>
          </div>
        </div>
        <div class="field full">
          <label for="s-ann-text">Announcement text</label>
          <input type="text" id="s-ann-text" maxlength="160" placeholder="e.g. NEXA AI v1.4.2 is now live — update available!" value="${esc(ann.text || '')}">
        </div>
      </div>
      <div class="ed-actions">
        <button class="btn btn-primary" id="settings-save">Save settings</button>
      </div>
    `;
    $('#settings-save').addEventListener('click', () => {
      store.meta = store.meta || {};
      store.meta.contactEmail = $('#s-email').value.trim();
      store.meta.tagline = $('#s-tagline').value.trim();
      store.meta.announcement = {
        enabled: $('#s-ann-on').checked,
        text: $('#s-ann-text').value.trim(),
        id: String(Date.now())
      };
      if (saveStore()) toast('Settings saved in this browser. Publish via Data tab for all visitors.', 'ok');
    });
  }

  /* ---------------- account / password tab ---------------- */
  function renderAccountTab() {
    const el = $('#tab-account');
    const usingDefault = !store.auth;
    el.innerHTML = `
      <h2>Admin password</h2>
      <p class="panel-sub">${usingDefault
        ? 'You are using the <b>default password</b>. For strong security, change it now.'
        : 'A custom password is active on this device. Keep it safe — there is no recovery option.'}</p>

      <div class="ed-grid">
        <div class="field full">
          <label for="p-current">Current password</label>
          <input type="password" id="p-current" autocomplete="current-password">
        </div>
        <div class="field">
          <label for="p-new">New password (min 8 chars, letters + numbers)</label>
          <input type="password" id="p-new" autocomplete="new-password">
        </div>
        <div class="field">
          <label for="p-confirm">Confirm new password</label>
          <input type="password" id="p-confirm" autocomplete="new-password">
        </div>
        <div class="field full">
          <label>Password strength</label>
          <div id="pw-meter" style="display:flex;gap:.4rem">
            ${[1, 2, 3, 4, 5].map(() => '<span style="flex:1;height:7px;border-radius:4px;background:var(--surface-2)"></span>').join('')}
          </div>
          <small id="pw-label" class="muted">Strength appears as you type.</small>
        </div>
      </div>
      <div class="ed-actions">
        <button class="btn btn-primary" id="pw-save">Change password</button>
      </div>

      <div class="guide-box warn" style="margin-top:1.6rem">
        <h3>⚠ Important security notes</h3>
        <ol>
          <li>The password is stored only as a <b>salted SHA-256 hash</b> — never as plain text.</li>
          <li>After changing your password, <b>export apps-data.js</b> (Data tab) and publish it, otherwise other browsers/devices will still use the previous password.</li>
          <li>A static site cannot hide its own code: this panel blocks casual access, and your cloud storage is only writable through this panel's service.</li>
        </ol>
      </div>
    `;

    const newInput = $('#p-new');
    newInput.addEventListener('input', () => {
      const s = pwScore(newInput.value);
      const colors = ['#f87171', '#f87171', '#fbbf24', '#fbbf24', '#34d399', '#34d399'];
      const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
      $$('#pw-meter span').forEach((seg, i) => { seg.style.background = i < s ? colors[s] : 'var(--surface-2)'; });
      $('#pw-label').textContent = newInput.value ? labels[s] : 'Strength appears as you type.';
    });

    $('#pw-save').addEventListener('click', async () => {
      const cur = $('#p-current').value;
      const nw = $('#p-new').value;
      const cf = $('#p-confirm').value;
      const auth = getAuth();
      if (!cur) { toast('Enter your current password first.', 'warn'); return; }
      const curHash = await sha256Hex((auth.salt || '') + cur);
      if (curHash !== auth.hash) { toast('Current password is incorrect.', 'err'); return; }
      if (nw.length < 8) { toast('New password must be at least 8 characters.', 'warn'); return; }
      if (!/[a-zA-Z]/.test(nw) || !/\d/.test(nw)) { toast('New password must contain both letters and numbers.', 'warn'); return; }
      if (nw !== cf) { toast('New passwords do not match.', 'warn'); return; }
      const salt = randSalt();
      const hash = await sha256Hex(salt + nw);
      store.auth = { salt, hash };
      if (saveStore()) {
        toast('Password changed. Remember: export & publish apps-data.js to apply it on other devices too.', 'ok', 6000);
        renderAccountTab();
      }
    });
  }

  /* ---------------- session timer ---------------- */
  function sessionTick() {
    const s = getSession();
    const chip = $('#session-chip');
    if (!s) {
      if ($('#panel-view').style.display !== 'none') {
        $('#session-overlay').classList.add('show');
      }
      return;
    }
    const left = s.exp - Date.now();
    const mm = Math.max(0, Math.floor(left / 60000));
    const ss = String(Math.max(0, Math.floor((left % 60000) / 1000))).padStart(2, '0');
    const label = $('#session-left');
    if (label) label.textContent = `${String(mm).padStart(2, '0')}:${ss}`;
    if (chip) chip.classList.toggle('timeout', mm < 5);
  }
  setInterval(sessionTick, 1000);

  /* ---------------- wire up ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    loadStore();

    // apply custom logo on admin screen too
    if (store.logo && store.logo.custom) {
      $$('img[data-logo]').forEach((i) => { i.src = store.logo.custom; });
    }

    $('#pw-toggle').addEventListener('click', () => {
      const inp = $('#login-pw');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = $('#login-pw').value;
      if (!pw) return;
      const btn = $('#login-btn');
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      setTimeout(async () => {
        await tryLogin(pw);
        if (getLock().until < Date.now() && $('#panel-view').style.display === 'none') {
          // only re-enable if still on login view and not locked
          const l = getLock();
          if (!(l.until > Date.now())) { btn.disabled = false; btn.textContent = 'Unlock Panel'; }
        }
      }, 350);
    });

    $('#logout-btn').addEventListener('click', () => {
      confirmAction('Log out?', 'Your saved changes stay in this browser.', () => {
        exitPanel();
        toast('Logged out securely.', 'ok');
      }, 'Log out');
    });

    $('#session-relogin').addEventListener('click', () => {
      $('#session-overlay').classList.remove('show');
      exitPanel();
    });

    $$('#admin-tabs .admin-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // sliding session: any interaction extends it
    ['click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
      if ($('#panel-view').style.display !== 'none') extendSession();
    }, { passive: true }));

    // restore an existing valid session
    if (getSession()) enterPanel();
    else if (getLock().until > Date.now()) startLockCountdown();

    // expose hooks for admin-data.js / admin-publish.js
    window.VX_ADMIN_CORE = {
      store: () => store,
      reloadStore: loadStore,
      saveStore,
      adoptCloudData,
      toast, esc, sha256Hex, randSalt, downloadFile, compressImage, sizeVerdict,
      confirmAction, switchTab, renderDashboard
    };
  });
})();
