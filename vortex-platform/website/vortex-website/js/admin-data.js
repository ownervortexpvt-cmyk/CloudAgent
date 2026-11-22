/* ============================================================
   VORTEX — Admin: Apps manager + Data/Publish (admin-data.js)
   · Full CRUD for apps (links, versions, changelog, icons…)
   · Export apps-data.js / JSON backup · Import backup
   · Clear local override · Reset to factory defaults
   ============================================================ */
(() => {
  'use strict';

  const CORE = () => window.VX_ADMIN_CORE;
  const esc = (s) => (window.VX_ADMIN_CORE ? window.VX_ADMIN_CORE.esc(s) : String(s == null ? '' : s));

  const PRESET_ICONS = [
    ['icons/flarex-king.svg', 'Flarex'],
    ['icons/appverse.svg', 'Appverse'],
    ['icons/cloud-agent.svg', 'Cloud'],
    ['icons/nexa-ai.svg', 'Nexa'],
    ['icons/nexseva.svg', 'Nexseva'],
    ['icons/naxora.svg', 'Naxora'],
    ['logo.svg', 'Vortex']
  ];
  const CATS = [['apk', 'Android APK'], ['exe', 'Windows EXE'], ['pwa', 'Progressive Web App'], ['webapp', 'Web Application']];

  /* =============== DIRECT-DOWNLOAD LINK HELPERS ===============
     Goal: a visitor must ALWAYS download straight from a Vortex
     download button — never land on a GitHub page. GitHub file
     pages (…/blob/…) are therefore auto-converted to
     raw.githubusercontent.com direct links on save. */

  function ghDirect(url) {
    const t = String(url || '').trim();
    if (!t) return { kind: 'empty' };
    try {
      const u = new URL(t);
      const h = u.hostname.replace(/^www\./, '');
      if (h !== 'github.com') {
        return { kind: u.protocol === 'https:' ? 'ok' : 'insecure', url: t };
      }
      // github.com/owner/repo/blob/branch/path  →  raw.githubusercontent.com direct file
      const m = u.pathname.match(/^\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
      if (m) return { kind: 'convert', url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}` };
      if (/^\/[^\/]+\/[^\/]+\/releases\/download\/.+/.test(u.pathname)) return { kind: 'ok', url: t };
      if (/^\/[^\/]+\/[^\/]+\/releases\/?$/.test(u.pathname)) return { kind: 'releases' };
      return { kind: 'page' };
    } catch (e) { return { kind: 'bad' }; }
  }

  function linkHint(kind, type) {
    switch (kind) {
      case 'empty':
        return type === 'apk' ? '○ Not set — shows "Coming Soon"'
          : type === 'pwa' ? '○ Optional — PWA page falls back to the web link'
          : '○ Not set';
      case 'ok':      return '✓ Live — direct download, users never leave Vortex';
      case 'convert': return '⚠ GitHub file page — auto-converted to a DIRECT download when you save';
      case 'releases':return '⚠ Releases PAGE, not a file — paste the direct link to the .apk / .exe file';
      case 'page':    return '⚠ GitHub PAGE link — users would land on GitHub. Use the file link or a releases/download link';
      case 'insecure':return '⚠ Uses http:// — switch to https:// for a safe direct download';
      case 'bad':     return '⚠ Not a valid URL';
    }
    return '';
  }

  const hintCls = (kind) => (kind === 'ok' ? 'has' : kind === 'empty' ? '' : 'warn');

  /** Read a version number out of a download filename or URL (myapp-v1.2.3.apk → 1.2.3).
      Accepts full URLs and plain filenames (uploaded files). */
  function versionFromFilename(url) {
    try {
      let file = String(url || '');
      try {
        const u = new URL(url);
        file = decodeURIComponent(u.pathname.split('/').pop() || '');
      } catch (e) { /* not a URL — treat the input as a plain filename */ }
      const m = file.match(/v?(\d+(?:\.\d+){1,3})/i);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /** File → base64 (no data: prefix) for GitHub uploads.
      Chunked so multi-hundred-MB strings never blow the call stack. */
  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('Could not read the file.'));
      r.readAsDataURL(file);
    });
  }

  /* =============== UPLOAD CENTER HELPERS =============== */

  function fmtBytes(n) {
    const b = Number(n) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }

  /** Auto-detect the platform of an uploaded file from its extension */
  function detectFileKind(name) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'apk' || ext === 'apks' || ext === 'aab' || ext === 'xapk')
      return { plat: 'apk', badge: 'APK', label: 'Android app package' };
    if (ext === 'exe' || ext === 'msi')
      return { plat: 'exe', badge: 'EXE', label: 'Windows installer / program' };
    if (ext === 'web')
      return { plat: 'web', badge: 'WEB', label: 'Web app package' };
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz')
      return { plat: 'web', badge: 'ZIP', label: 'Web package (archive)' };
    if (ext === 'html' || ext === 'htm')
      return { plat: 'web', badge: 'WEB', label: 'Web app file' };
    return { plat: 'apk', badge: (ext || 'BIN').toUpperCase().slice(0, 4), label: 'Custom binary — pick the platform below' };
  }

  /** Clean upload filename: FLAREX KING v1.2.1 → FLAREX-KING-v1.2.1.apk */
  function buildUploadName(app, file, ver) {
    const ext = String(file.name || '').toLowerCase().split('.').pop();
    const base = String(app.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
    const v = String(ver || app.version || '').replace(/^v/i, '');
    return `${base}-v${v}.${ext || 'bin'}`;
  }

  /** If a link already points inside the connected repository, return its
      repo path so "Replace current file" truly overwrites the same file. */
  function repoPathFromUrl(url) {
    const t = String(url || '').trim();
    if (!t) return null;
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('vortex_gh_cfg') || 'null') || {}; } catch (e) { /* ignore */ }
    const clean = (p) => decodeURIComponent(String(p || '')).replace(/^\/+/, '');
    if (!/^https?:\/\//i.test(t)) {
      // already a same-site relative path like apps/<id>/x.apk
      return /^[\w.\-/]+$/.test(t) ? clean(t) : null;
    }
    try {
      const u = new URL(t);
      const h = u.hostname.replace(/^www\./, '');
      if (h === 'raw.githubusercontent.com') {
        const m = u.pathname.match(/^\/([^\/]+)\/([^\/]+)\/[^\/]+\/(.+)$/);
        if (m && m[1] === cfg.owner && m[2] === cfg.repo) return clean(m[3]);
      }
      if (h === 'github.com') {
        const m = u.pathname.match(/^\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/[^\/]+\/(.+)$/);
        if (m && m[1] === cfg.owner && m[2] === cfg.repo) return clean(m[3]);
      }
      // same-origin file of the website itself (e.g. https://site/apps/<id>/x.apk)
      if (u.origin === location.origin) return clean(u.pathname.replace(/^\/[^\/]+\/(?=(?:apps|downloads)\b)/, '/'));
    } catch (e) { /* ignore */ }
    return null;
  }

  const UPL_PLAT = {
    apk: { label: 'Android', link: 'apk', cat: 'apk' },
    exe: { label: 'Windows EXE', link: 'exe', cat: 'exe' },
    web: { label: 'Web', link: 'web', cat: 'webapp' },
    pwa: { label: 'PWA', link: 'pwa', cat: 'pwa' }
  };

  function confirmUploadPromise(title, text, okLabel) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('modal-backdrop');
      const cancel = document.getElementById('modal-cancel');
      const ok = document.getElementById('modal-ok');
      const done = (v) => {
        cancel.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdrop);
        resolve(v);
      };
      const onCancel = () => done(false);
      const onBackdrop = (e) => { if (e.target === backdrop) done(false); };
      cancel.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdrop);
      CORE().confirmAction(title, text, () => done(true), okLabel);
    });
  }

  /* =============== APPS TAB =============== */

  function appEditorHtml(app, isNew) {
    const iconSrc = app.iconData || app.icon || 'logo.svg';
    const cats = app.categories || [];
    return `
    <div class="app-editor" data-app-id="${esc(app.id)}">
      <div class="app-editor-head">
        <span class="app-icon"><img src="${esc(iconSrc)}" alt="" onerror="this.src='logo.svg'"></span>
        <h3>${esc(app.name || 'New app')}</h3>
        <span class="ver-chip">v${esc(app.version || '?')}</span>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="app-editor-body">
        <div class="ed-grid">
          <div class="field">
            <label>App name</label>
            <input type="text" data-f="name" value="${esc(app.name || '')}" maxlength="40" placeholder="e.g. FLAREX KING">
          </div>
          <div class="field">
            <label>Type label (shown on cards)</label>
            <input type="text" data-f="type" value="${esc(app.type || '')}" maxlength="40" placeholder="e.g. Android App / Web App / Productivity Suite">
          </div>
          <div class="field full">
            <label>Tagline (one line)</label>
            <input type="text" data-f="tagline" value="${esc(app.tagline || '')}" maxlength="120">
          </div>
          <div class="field">
            <label>Latest version</label>
            <input type="text" data-f="version" value="${esc(app.version || '1.0.0')}" placeholder="e.g. 1.2.0">
          </div>
          <div class="field">
            <label>Release date</label>
            <input type="date" data-f="releaseDate" value="${esc(app.releaseDate || '')}">
          </div>
          <div class="field">
            <label>Download size (text)</label>
            <input type="text" data-f="size" value="${esc(app.size || '')}" placeholder="e.g. ≈ 18 MB">
          </div>
          <div class="field">
            <label>Accent colour</label>
            <input type="color" data-f="accent" value="${esc(app.accent || '#22d3ee')}" style="height:48px;padding:.2rem">
          </div>
          <div class="field full">
            <label>Appears on</label>
            <div class="check-row">
              ${CATS.map(([v, l]) => `<label class="check-item"><input type="checkbox" data-cat="${v}" ${cats.includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}
            </div>
          </div>
          <div class="field full">
            <label>App icon</label>
            <div class="icon-picker" data-picker>
              ${PRESET_ICONS.map(([p, label]) => `
                <span class="icon-opt ${(!app.iconData && app.icon === p) ? 'selected' : ''}" data-icon-path="${esc(p)}" title="${esc(label)}">
                  <img src="${esc(p)}" alt="${esc(label)}" onerror="this.style.display='none'">
                </span>`).join('')}
              <span class="icon-opt upload ${app.iconData ? 'selected' : ''}" data-icon-custom>Custom<br>upload</span>
              <input type="file" data-icon-file accept="image/*" style="display:none">
              <input type="hidden" data-f="iconData" value="">
            </div>
            <small class="link-status" data-icon-detect hidden></small>
          </div>
          <div class="field full">
            <label>Full description (blank line = new paragraph)</label>
            <textarea data-f="description" rows="5" placeholder="What does this app do?">${esc(app.description || '')}</textarea>
          </div>
          <div class="field full">
            <label>Key features (one per line)</label>
            <textarea data-f="features" rows="5">${esc((app.features || []).join('\n'))}</textarea>
          </div>

          <div class="field full">
            <label>⇪ Upload file — straight from your device</label>
            <div class="upl-center" data-upl-center>
              <div class="upl-drop" data-upl-drop tabindex="0" role="button" aria-label="Choose a file from your device to upload">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-3" stroke-linecap="round"/></svg>
                <b>Upload file</b>
                <span>Click to choose from your file manager — or drag &amp; drop here</span>
                <em>.apk&nbsp;·&nbsp;.apks&nbsp;·&nbsp;.aab&nbsp;·&nbsp;.exe&nbsp;·&nbsp;.msi&nbsp;·&nbsp;.web&nbsp;·&nbsp;.zip&nbsp;·&nbsp;.html — up to 350 MB</em>
                <small>Size &amp; platform are <b>auto-detected</b> · stored inside your own website · users download from your own site, never from GitHub</small>
              </div>
              <input type="file" data-upl-any hidden>
              <div class="upl-panel" data-upl-panel hidden>
                <div class="upl-file">
                  <span class="upl-ftype" data-upl-ftype>APK</span>
                  <div class="upl-fmeta">
                    <b data-upl-name></b>
                    <small data-upl-meta></small>
                  </div>
                </div>
                <div class="upl-detect" data-upl-detect hidden>
                  <div class="upl-detect-head">
                    <span class="upl-detect-ico" data-upl-detect-ico>?</span>
                    <div class="upl-detect-name">
                      <small>Icon &amp; name — auto-detected</small>
                      <b data-upl-dname>—</b>
                      <span class="upl-detect-btns">
                        <button type="button" class="btn btn-ghost btn-xs" data-upl-use-name hidden>Use as app name</button>
                        <button type="button" class="btn btn-ghost btn-xs" data-upl-use-icon hidden>Use as app icon</button>
                      </span>
                    </div>
                  </div>
                  <div class="upl-info">
                    <span class="upl-info-t">INFO — auto-detected · read-only</span>
                    <div class="upl-info-grid">
                      <div><small>Version code</small><b data-upl-i="versionCode">—</b></div>
                      <div><small>Version name</small><b data-upl-i="versionName">—</b></div>
                      <div><small>Size</small><b data-upl-i="size">—</b></div>
                      <div><small>Package name</small><b data-upl-i="package">—</b></div>
                      <div class="wide"><small>ABIs</small><b data-upl-i="abis">—</b></div>
                      <div class="wide mono"><small>MD5</small><b data-upl-i="md5">—</b></div>
                      <div class="wide mono"><small>SHA256</small><b data-upl-i="sha256">—</b></div>
                      <div class="wide"><small>Status</small><b data-upl-i="status">Reading file…</b></div>
                    </div>
                  </div>
                </div>
                <div class="upl-opts">
                  <div class="upl-opt">
                    <span class="upl-opt-t">Select platform <small>(one file → one platform)</small></span>
                    <div class="check-row">
                      <label class="check-item"><input type="checkbox" data-upl-plat="apk"> Android</label>
                      <label class="check-item"><input type="checkbox" data-upl-plat="web"> Web</label>
                      <label class="check-item"><input type="checkbox" data-upl-plat="exe"> Windows EXE</label>
                      <label class="check-item"><input type="checkbox" data-upl-plat="pwa"> PWA</label>
                    </div>
                  </div>
                  <div class="upl-opt">
                    <span class="upl-opt-t">Upload mode</span>
                    <div class="check-row">
                      <label class="check-item"><input type="radio" name="uplmode-${esc(app.id)}" data-upl-mode="version" checked> New version <b class="upl-newver" data-upl-newver></b></label>
                      <label class="check-item"><input type="radio" name="uplmode-${esc(app.id)}" data-upl-mode="replace"> Replace current file</label>
                    </div>
                  </div>
                </div>
                <div class="upl-progress" data-upl-progress hidden>
                  <div class="upl-bar"><i data-upl-bar></i></div>
                  <span class="upl-pct" data-upl-pct>0%</span>
                </div>
                <div class="upl-stage" data-upl-stage hidden></div>
                <div class="btn-row">
                  <button type="button" class="btn btn-primary btn-sm" data-upl-go>⇪ Upload to Cloud</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-upl-cancel>Cancel</button>
                </div>
              </div>
              <div class="upl-done" data-upl-done hidden></div>
            </div>
          </div>
          <div class="field">
            <label>APK download link (Android)</label>
            <input type="url" data-f="apk" value="${esc((app.links && app.links.apk) || '')}" placeholder="https://… or leave empty = Coming Soon">
            ${(() => { const g = ghDirect((app.links && app.links.apk) || ''); return `<small class="link-status ${hintCls(g.kind)}">${esc(linkHint(g.kind, 'apk'))}${g.url ? ' · <a href="#" data-test="apk">test ↗</a>' : ''}</small>`; })()}
          </div>
          <div class="field">
            <label>EXE download link (Windows)</label>
            <input type="url" data-f="exe" value="${esc((app.links && app.links.exe) || '')}" placeholder="https://… or leave empty = hidden/Coming Soon">
            ${(() => { const g = ghDirect((app.links && app.links.exe) || ''); return `<small class="link-status ${hintCls(g.kind)}">${esc(linkHint(g.kind, 'exe'))}${g.url ? ' · <a href="#" data-test="exe">test ↗</a>' : ''}</small>`; })()}
          </div>
          <div class="field">
            <label>Web app link (browser)</label>
            <input type="url" data-f="web" value="${esc((app.links && app.links.web) || '')}" placeholder="https://… (leave empty = Coming Soon)">
            ${(() => { const g = ghDirect((app.links && app.links.web) || ''); return `<small class="link-status ${hintCls(g.kind)}">${esc(linkHint(g.kind, 'web'))}${g.url ? ' · <a href="#" data-test="web">test ↗</a>' : ''}</small>`; })()}
          </div>
          <div class="field">
            <label>PWA install link (optional)</label>
            <input type="url" data-f="pwa" value="${esc((app.links && app.links.pwa) || '')}" placeholder="https://… direct install/manifest link">
            ${(() => { const g = ghDirect((app.links && app.links.pwa) || ''); return `<small class="link-status ${hintCls(g.kind)}">${esc(linkHint(g.kind, 'pwa'))}${g.url ? ' · <a href="#" data-test="pwa">test ↗</a>' : ''}</small>`; })()}
          </div>

          <div class="field full">
            <label>Version history — one entry per line: <code style="color:var(--accent)">version | date | change note</code></label>
            <textarea data-f="changelog" rows="5" placeholder="1.1.0 | 2026-10-01 | Added dark mode">${esc((app.changelog || []).map((c) => `${c.v} | ${c.d} | ${(c.c || []).join('; ')}`).join('\n'))}</textarea>
          </div>
        </div>
        <div class="ed-actions">
          <button class="btn btn-primary" data-save>Save app</button>
          <button class="btn btn-ghost" data-undo>Revert unsaved edits</button>
          <button class="btn btn-danger" data-del>Delete app</button>
          ${isNew ? '<span class="chip chip-accent" style="align-self:center">New app — not published yet</span>' : ''}
        </div>
      </div>
    </div>`;
  }

  /* Deferred-render state: while an app editor is open (or an upload is
     running) background re-renders are postponed, otherwise they would
     wipe the editor DOM — including a file picker mid-selection (the OS
     picker closed into a detached <input> and the chosen file silently
     disappeared). Explicit in-tab actions (save / revert / delete / add)
     pass {force:true}. */
  let renderDeferred = false;

  function flushDeferredAppsRender() {
    if (!renderDeferred) return;
    const elx = document.getElementById('tab-apps');
    if (elx && (elx.querySelector('.app-editor.open') || elx.querySelector('[data-upl-center][data-upl-busy="1"]'))) return;
    renderDeferred = false;
    const s = CORE().store();
    setTimeout(() => renderAppsTab(s), 0);
  }

  function renderAppsTab(store, opts) {
    const el = document.getElementById('tab-apps');
    if (!el) return;
    const apps = store.apps || [];

    const openEditors = el.querySelectorAll('.app-editor.open').length;
    const uploadBusy = el.querySelector('[data-upl-center][data-upl-busy="1"]');
    if ((openEditors || uploadBusy) && !(opts && opts.force)) {
      renderDeferred = true;   // editor open → refresh the list AFTER it closes
      return;
    }
    if (openEditors && uploadBusy) {
      renderDeferred = true;   // even a forced render must not kill a running upload
      if (CORE().toast) CORE().toast('Waiting for the upload to finish — the app list refreshes automatically afterwards.', 'warn', 6000);
      return;
    }
    renderDeferred = false;

    el.innerHTML = `
      <h2>Apps &amp; download links</h2>
      <p class="panel-sub">Upload files straight from your device (size &amp; platform auto-detected) — they are stored on <b>VORTEX Cloud</b> (your 10 GB sandbox) and mirrored to your website automatically. Uploading a new version deletes the old one automatically (toggle in the Publish tab). Users always download inside Vortex. GitHub links you paste are still auto-converted to direct downloads. Click a card to open its editor.</p>
      <div class="quick-row">
        <button class="btn btn-primary" id="add-app-btn">＋ Add new app</button>
      </div>
      <div id="apps-editors">
        ${apps.map((a) => appEditorHtml(a, false)).join('')}
      </div>
    `;

    bindEditorEvents(el, store);

    document.getElementById('add-app-btn').addEventListener('click', () => {
      const blank = {
        id: 'app-' + Date.now().toString(36),
        name: 'New App',
        type: 'Android App',
        accent: '#22d3ee',
        categories: ['apk'],
        icon: 'logo.svg',
        iconData: null,
        tagline: 'Short one-line description of the app.',
        description: 'Describe what the app does and why users will love it.\n\nAdd a second paragraph for more detail.',
        features: ['Feature one', 'Feature two'],
        version: '1.0.0',
        releaseDate: new Date().toISOString().slice(0, 10),
        size: '≈ 10 MB',
        links: { apk: '', exe: '', web: '', pwa: '' },
        updatedAt: new Date().toISOString(),
        changelog: [{ v: '1.0.0', d: new Date().toISOString().slice(0, 10), c: ['Initial release'] }]
      };
      store.apps.push(blank);
      if (CORE().saveStore()) {
        renderAppsTab(store, { force: true });
        const editors = el.querySelectorAll('.app-editor');
        const last = editors[editors.length - 1];
        if (last) { last.classList.add('open'); last.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        CORE().toast('New app added — fill in the details and press Save.', 'ok');
      } else {
        store.apps.pop();
      }
    });
  }

  /* =============== UPLOAD CENTER — the professional direct-upload flow ===============
     · choose a file from the device file manager (or drag & drop)
     · name, size, platform are auto-detected (Android / Web / EXE / PWA ticks)
     · "New version" mode: versioned path, auto version bump, changelog entry,
       release date refresh — old files stay in the repository history
     · "Replace current file" mode: overwrites the exact same repository path
     · real 0–100 % progress, big files automatically use the Git blob flow
     · after upload: link field, size field, category tick — all set for you */
  function bindUploadCenter(editorEl, app) {
    const center = editorEl.querySelector('[data-upl-center]');
    if (!center) return;
    const drop = center.querySelector('[data-upl-drop]');
    const input = center.querySelector('[data-upl-any]');
    const panel = center.querySelector('[data-upl-panel]');
    const doneBox = center.querySelector('[data-upl-done]');
    const progressBox = center.querySelector('[data-upl-progress]');
    const barEl = center.querySelector('[data-upl-bar]');
    const pctEl = center.querySelector('[data-upl-pct]');
    const stageEl = center.querySelector('[data-upl-stage]');
    const goBtn = center.querySelector('[data-upl-go]');
    const cancelBtn = center.querySelector('[data-upl-cancel]');
    const platBoxes = Array.from(center.querySelectorAll('[data-upl-plat]'));
    const modeRadios = Array.from(center.querySelectorAll('[data-upl-mode]'));
    const newverEl = center.querySelector('[data-upl-newver]');
    const detectBox = center.querySelector('[data-upl-detect]');
    const dIco = center.querySelector('[data-upl-detect-ico]');
    const dName = center.querySelector('[data-upl-dname]');
    const useNameBtn = center.querySelector('[data-upl-use-name]');
    const useIconBtn = center.querySelector('[data-upl-use-icon]');
    const infoEls = {};
    ['versionCode', 'versionName', 'size', 'package', 'abis', 'md5', 'sha256', 'status'].forEach((k) => {
      infoEls[k] = center.querySelector(`[data-upl-i="${k}"]`);
    });
    let uplFile = null;
    let uplMeta = null;   // full auto-detect result of the selected file
    let busy = false;

    const setBar = (p) => {
      if (barEl) barEl.style.width = Math.max(0, Math.min(100, p)) + '%';
      if (pctEl) pctEl.textContent = Math.max(0, Math.min(100, Math.round(p))) + '%';
    };
    const say = (text, cls) => {
      if (!stageEl) return;
      stageEl.hidden = !text;
      stageEl.className = 'upl-stage' + (cls ? ' ' + cls : '');
      stageEl.textContent = text || '';
    };

    function pickPlat(plat) {
      platBoxes.forEach((b) => { b.checked = (b.dataset.uplPlat === plat); });
    }
    function chosenPlat() {
      const b = platBoxes.find((x) => x.checked);
      return b ? b.dataset.uplPlat : null;
    }
    function chosenMode() {
      const r = modeRadios.find((x) => x.checked);
      return r ? r.dataset.uplMode : 'version';
    }
    function refreshModeUi() {
      const plat = chosenPlat();
      const fv = uplFile ? (versionFromFilename(uplFile.name) || '') : '';
      const target = fv || app.version || '1.0.0';
      if (newverEl) newverEl.textContent = '→ v' + target;
      const existing = ((app.links || {})[(UPL_PLAT[plat] || {}).link] || '').trim();
      const preferReplace = !!existing && (!fv || fv === app.version);
      modeRadios.forEach((r) => { r.checked = (r.dataset.uplMode === (preferReplace ? 'replace' : 'version')); });
    }

    platBoxes.forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) pickPlat(cb.dataset.uplPlat); // single-select behaviour
      else cb.checked = true;                        // always exactly one
      refreshModeUi();
    }));
    modeRadios.forEach((r) => r.addEventListener('change', refreshModeUi));

    function resetUi() {
      if (panel) panel.hidden = true;
      if (doneBox) doneBox.hidden = true;
      if (progressBox) progressBox.hidden = true;
      setBar(0);
      say('');
    }

    function acceptFile(file) {
      if (busy) return;
      const kind = detectFileKind(file.name);
      if (file.size > 350 * 1024 * 1024) {
        CORE().toast('That file is larger than 350 MB — the upload limit per file. Split it or host it externally and paste a direct https link instead.', 'err', 8500);
        return;
      }
      uplFile = file;
      uplMeta = null;
      center.querySelector('[data-upl-ftype]').textContent = kind.badge;
      center.querySelector('[data-upl-name]').textContent = file.name;
      const fv = versionFromFilename(file.name);
      center.querySelector('[data-upl-meta]').textContent =
        `${fmtBytes(file.size)} · auto-detected · ${kind.label}` + (fv ? ` · version ${fv} read from filename` : '');
      pickPlat(kind.plat);
      refreshModeUi();
      panel.hidden = false;
      doneBox.hidden = true;
      progressBox.hidden = true;
      setBar(0);
      say('');
      runAutoDetect(file);
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ---- auto-detection: icon, name, version, size, package, ABIs, hashes ---- */
    function setInfo(key, text, warn) {
      const elx = infoEls[key];
      if (!elx) return;
      elx.textContent = text || '—';
      elx.classList.toggle('warn-val', !!warn);
    }
    function resetDetectUi() {
      if (dIco) { dIco.classList.remove('has-img'); dIco.innerHTML = '?'; }
      if (dName) dName.textContent = '—';
      if (useNameBtn) useNameBtn.hidden = true;
      if (useIconBtn) useIconBtn.hidden = true;
      Object.keys(infoEls).forEach((k) => setInfo(k, k === 'status' ? 'Reading file…' : '—'));
    }
    async function runAutoDetect(file) {
      if (!detectBox) return;
      const A = window.VX_APK;
      detectBox.hidden = false;
      resetDetectUi();
      if (!A) {
        setInfo('size', fmtBytes(file.size));
        setInfo('status', 'Auto-detect module missing — upload still works.');
        return;
      }
      try {
        const r = await A.inspectFile(file, (phase, pct) => {
          if (phase === 'md5') setInfo('status', `Computing MD5… ${pct || 0}%`);
          else if (phase === 'sha') setInfo('status', `Computing SHA-256… ${pct || 0}%`);
          else if (phase === 'zip') setInfo('status', 'Reading package structure (libraries / ABIs)…');
          else if (phase === 'parse') setInfo('status', 'Parsing APK metadata — manifest, resources, icon…');
        });
        if (uplFile !== file) return; // another file was picked meanwhile
        uplMeta = r;
        setInfo('size', A.fmtBytes(r.size));
        setInfo('md5', r.md5 || '—');
        setInfo('sha256', r.sha256 || '—');
        setInfo('package', r.packageName || '—', !!r.packageName);
        setInfo('versionCode', r.versionCode || '—');
        setInfo('versionName', r.versionName || '—');
        setInfo('abis', (r.abis && r.abis.length) ? r.abis.join(', ') : ((r.kind === 'apk' || r.kind === 'apk-related') ? 'universal (no native libs)' : '—'));
        const detected = r.label || (r.kind === 'apk' ? '' : file.name.replace(/\.[^.]+$/, ''));
        if (dName) dName.textContent = detected || 'Not detected in this file';
        if (r.iconDataUrl && dIco) {
          dIco.classList.add('has-img');
          dIco.innerHTML = `<img src="${r.iconDataUrl}" alt="detected app icon">`;
          if (useIconBtn) {
            useIconBtn.hidden = false;
            useIconBtn.onclick = () => {
              editorEl._customIconData = r.iconDataUrl;
              editorEl.querySelector('[data-f="iconData"]').value = r.iconDataUrl;
              const picker = editorEl.querySelector('[data-picker]');
              if (picker) {
                picker.querySelectorAll('.icon-opt').forEach((o) => o.classList.remove('selected'));
                const custom = picker.querySelector('[data-icon-custom]');
                if (custom) { custom.classList.add('selected'); custom.innerHTML = '<img src="' + r.iconDataUrl + '" alt="custom">'; }
              }
              CORE().toast('Detected icon applied — press "Save app" to keep it.', 'ok');
            };
          }
        }
        if (detected && useNameBtn) {
          useNameBtn.hidden = false;
          useNameBtn.onclick = () => {
            const nameField = editorEl.querySelector('[data-f="name"]');
            if (nameField) nameField.value = detected.slice(0, 40);
            CORE().toast(`App name set to "${detected.slice(0, 40)}" — press "Save app" to keep it.`, 'ok');
          };
        }
        const versionChanged = !!(r.versionName && r.versionName !== app.version);
        setInfo('status', A.statusText(r, { versionChanged }), versionChanged);
        if (versionChanged) {
          const nv = center.querySelector('[data-upl-newver]');
          if (nv) nv.textContent = '→ v' + r.versionName;
        }
      } catch (e) {
        if (uplFile === file) setInfo('status', '⚠ Auto-detect failed: ' + (e.message || 'unknown error') + ' — upload still works.');
      }
    }

    if (drop) {
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'dragend'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) acceptFile(f);
      });
    }
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) acceptFile(f);
    });

    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (!busy) { uplFile = null; resetUi(); return; }
      // Upload in progress → abort the cloud request safely. Nothing was
      // committed yet: files only become visible after the upload completes.
      const PP = window.VX_ADMIN_PUBLISH;
      if (PP && PP.cancelUpload) PP.cancelUpload();
      say('Cancelling — stopping the upload safely…', 'warn');
    });

    if (goBtn) goBtn.addEventListener('click', async () => {
      if (busy || !uplFile) return;
      const P = window.VX_ADMIN_PUBLISH;
      if (!P || !P.canUpload || !P.canUpload()) {
        CORE().toast('VORTEX Cloud is not configured yet — open the Publish tab → Advanced → Cloud URL, then try again.', 'warn', 9000);
        return;
      }
      const plat = chosenPlat();
      const meta = UPL_PLAT[plat || ''];
      if (!meta) { CORE().toast('Select the platform for this file (Android / Web / EXE / PWA).', 'warn'); return; }
      if (uplFile.size > 50 * 1024 * 1024) {
        const go = await confirmUploadPromise(
          'Large file (over 50 MB)',
          `“${uplFile.name}” is ${fmtBytes(uplFile.size)} — a large upload to VORTEX Cloud (10 GB). Big files can take a few minutes depending on your connection; keep this tab open until it finishes. Continue?`,
          'Upload anyway'
        );
        if (!go) return;
      }
      busy = true;
      center.dataset.uplBusy = '1';   // renderAppsTab guard: never rebuild mid-upload
      goBtn.disabled = true;
      if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '✕ Cancel upload'; }
      progressBox.hidden = false;
      setBar(0);
      try {
        // FAIL FAST — check the cloud BEFORE any heavy work so a problem
        // errors at 0 % with clear guidance, never at 90 %.
        say('Checking where to store the file…');
        const pf = await P.preflight();
        if (!pf.ok) throw new Error(pf.message);
        const fv = versionFromFilename(uplFile.name);
        const targetVer = (uplMeta && uplMeta.versionName) || fv || app.version || '1.0.0';
        const mode = chosenMode();
        const existing = ((app.links || {})[meta.link] || '').trim();
        let path = `apps/${app.id}/${buildUploadName(app, uplFile, targetVer)}`;
        if (mode === 'replace' && existing) {
          const same = repoPathFromUrl(existing);
          if (same) path = same; // truly overwrite the same repository file
        }
        say(`Preparing ${fmtBytes(uplFile.size)}…`);
        const commitMsg = `Upload ${path.split('/').pop()} — ${app.name} v${targetVer} (${meta.label})`;
        // Files go to VORTEX Cloud; the sandbox mirrors everything to GitHub.
        let r;
        {
          say(`Uploading ${fmtBytes(uplFile.size)}…`);
          r = await P.upload({
            path,
            file: uplFile,
            sha256: (uplMeta && uplMeta.sha256) || '',
            message: commitMsg,
            appId: app.id,
            slot: meta.link,
            oldUrl: existing,
            onProgress: setBar,
            stage: say
          });
        }
        // ---- auto-apply everything the panel can do for you ----
        const linkField = editorEl.querySelector(`[data-f="${meta.link}"]`);
        if (linkField) linkField.value = r.url;
        const sizeField = editorEl.querySelector('[data-f="size"]');
        if (sizeField) sizeField.value = fmtBytes(uplFile.size);
        const catBox = editorEl.querySelector(`[data-cat="${meta.cat}"]`);
        if (catBox) catBox.checked = true;
        // Big-file bookkeeping: remember the multi-part manifest so the site's
        // download buttons assemble the file client-side (progress bar +
        // integrity checks) instead of pointing at an oversized single file.
        let chunkNote = '';
        if (r && r.chunked && (meta.cat === 'apk' || meta.cat === 'exe')) {
          app[meta.cat === 'exe' ? 'exeDownload' : 'apkDownload'] = {
            mode: 'chunked',
            manifest: r.chunked.manifest,
            filename: r.chunked.filename,
            mime: r.chunked.mime,
            size: r.chunked.size,
            sha256: r.chunked.sha256,
            parts: r.chunked.parts,
            partSize: r.chunked.partSize,
            updatedAt: new Date().toISOString()
          };
          chunkNote = `<li>Large file stored as <b>${r.chunked.parts} × 16 MB parts</b> — visitors get a one-click download with a live progress bar and automatic integrity verification.</li>`;
        }
        const today = new Date().toISOString().slice(0, 10);
        if (mode === 'version') {
          const verField = editorEl.querySelector('[data-f="version"]');
          if (verField) verField.value = targetVer;
          const dateField = editorEl.querySelector('[data-f="releaseDate"]');
          if (dateField) dateField.value = today;
          const logField = editorEl.querySelector('[data-f="changelog"]');
          if (logField) {
            const line = `${targetVer} | ${today} | New ${meta.label} build published (${uplFile.name})`;
            logField.value = logField.value.trim() ? line + '\n' + logField.value.trim() : line;
          }
        }
        const verNote = mode === 'version' ? `Version set to <b>v${esc(targetVer)}</b>, release date refreshed and a changelog entry added.` : 'The existing file was replaced at the same path.';
        // store the detected package details with the app (shown on the app page)
        let pkgNote = '';
        if (uplMeta && (uplMeta.kind === 'apk' || uplMeta.kind === 'apk-related') && uplMeta.parsed) {
          app.apkInfo = {
            package: uplMeta.packageName,
            versionCode: uplMeta.versionCode,
            versionName: uplMeta.versionName,
            abis: uplMeta.abis,
            md5: uplMeta.md5,
            sha256: uplMeta.sha256,
            sizeBytes: uplMeta.size,
            checkedAt: new Date().toISOString()
          };
          pkgNote = '<li>Package details (version code, ABIs, SHA-256) stored — visitors can verify the file on the app page.</li>';
        }
        if (doneBox) {
          doneBox.hidden = false;
          doneBox.innerHTML = `
            <b>✓ ${esc(uplFile.name)} uploaded — ${fmtBytes(uplFile.size)}</b>
            <ul>
              <li>${esc(meta.label)} download link set automatically — users download inside Vortex, never on GitHub.</li>
              <li>Download size auto-filled: <b>${esc(fmtBytes(uplFile.size))}</b>.</li>
              ${chunkNote}
              <li>${verNote}</li>
              ${pkgNote}
              <li>File stored on <b>${r.target === 'github' ? 'your website repository — every mirror serves it' : 'VORTEX Cloud'}</b> — it stays available for your visitors; keep a local backup copy too.</li>
            </ul>
            <span>Now press <b>Save app</b> to keep these changes${' '}— then publish (or let auto-publish do it).</span>`;
        }
        CORE().toast(`${uplFile.name} uploaded — link, size and version details filled automatically. Press "Save app".`, 'ok', 7500);
        resetPanelKeepDone();
      } catch (e) {
        const msg = (e && e.message) || 'Upload failed.';
        if (/cancel/i.test(msg)) {
          say('✕ Upload cancelled — nothing was changed. Your file is safe; you can start again any time.', 'warn');
          CORE().toast('Upload cancelled — nothing was changed.', 'warn', 5000);
        } else {
          say('⚠ ' + msg, 'err');
          CORE().toast(msg, 'err', 8000);
        }
      } finally {
        busy = false;
        delete center.dataset.uplBusy;
        goBtn.disabled = false;
        if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel'; }
        flushDeferredAppsRender();    // upload done → apply any postponed refresh
      }
    });

    function resetPanelKeepDone() {
      uplFile = null;
      panel.hidden = true;
      progressBox.hidden = true;
      setBar(0);
      say('');
    }
  }

  function parseChangelog(text) {
    const out = [];
    String(text || '').split('\n').forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const parts = t.split('|').map((p) => p.trim());
      if (parts.length < 3) return;
      out.push({ v: parts[0], d: parts[1], c: parts[2].split(';').map((s) => s.trim()).filter(Boolean) });
    });
    return out;
  }

  function collectEditor(editorEl) {
    const val = (f) => {
      const node = editorEl.querySelector(`[data-f="${f}"]`);
      return node ? node.value.trim() : '';
    };
    const iconData = (editorEl.querySelector('[data-f="iconData"]') || {}).value || '';
    const customSelected = !!editorEl.querySelector('.icon-opt[data-icon-custom].selected');
    const presetPath = (editorEl.querySelector('.icon-opt.selected[data-icon-path]') || {}).dataset ? editorEl.querySelector('.icon-opt.selected[data-icon-path]').dataset.iconPath : null;
    return {
      name: val('name') || 'Untitled App',
      type: val('type') || 'App',
      tagline: val('tagline'),
      version: val('version') || '1.0.0',
      releaseDate: val('releaseDate') || new Date().toISOString().slice(0, 10),
      size: val('size'),
      accent: val('accent') || '#22d3ee',
      categories: Array.from(editorEl.querySelectorAll('[data-cat]:checked')).map((c) => c.dataset.cat),
      icon: (!customSelected && presetPath) ? presetPath : 'logo.svg',
      iconData: customSelected ? (editorEl._customIconData || iconData || null) : null,
      description: editorEl.querySelector('[data-f="description"]').value,
      features: String(val('features') || '').split('\n').map((s) => s.trim()).filter(Boolean),
      links: {
        apk: val('apk'), exe: val('exe'), web: val('web'), pwa: val('pwa')
      },
      changelog: parseChangelog(editorEl.querySelector('[data-f="changelog"]').value)
    };
  }

  function bindEditorEvents(root, store) {
    root.querySelectorAll('.app-editor').forEach((editorEl) => {
      const id = editorEl.dataset.appId;
      const app = store.apps.find((a) => a.id === id);
      if (!app) return;

      const head = editorEl.querySelector('.app-editor-head');
      head.addEventListener('click', () => {
        editorEl.classList.toggle('open');
        flushDeferredAppsRender();   // last editor closed → apply any postponed refresh
      });

      // icon picker
      const picker = editorEl.querySelector('[data-picker]');
      if (picker) {
        picker.addEventListener('click', (e) => {
          const opt = e.target.closest('.icon-opt');
          if (!opt) return;
          if (opt.hasAttribute('data-icon-custom')) {
            const fileInput = editorEl.querySelector('[data-icon-file]');
            fileInput.click();
          } else {
            picker.querySelectorAll('.icon-opt').forEach((o) => o.classList.remove('selected'));
            opt.classList.add('selected');
            editorEl._customIconData = null;
          }
        });
        const fileInput = editorEl.querySelector('[data-icon-file]');
        fileInput.addEventListener('change', () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (!/^image\//.test(file.type)) { CORE().toast('Please choose an image file.', 'err'); return; }
          const detect = editorEl.querySelector('[data-icon-detect]');
          if (detect) { detect.hidden = false; detect.className = 'link-status'; detect.textContent = '⏳ Reading image & auto-detecting size…'; }
          CORE().compressImage(file, 256, (dataUrl, info) => {
            if (detect) {
              const verdict = (window.VX_ADMIN_CORE.sizeVerdict || (() => ''))(info.w, info.h, 'icon');
              const low = /LOW/.test(verdict);
              detect.className = 'link-status ' + (low ? 'warn' : 'has');
              detect.textContent = '✓ ' + verdict;
            }
            editorEl._customIconData = dataUrl;
            editorEl.querySelector('[data-f="iconData"]').value = dataUrl;
            picker.querySelectorAll('.icon-opt').forEach((o) => o.classList.remove('selected'));
            const custom = picker.querySelector('[data-icon-custom]');
            custom.classList.add('selected');
            custom.innerHTML = '<img src="' + dataUrl + '" alt="custom">';
            CORE().toast('Custom icon ready — press "Save app" to keep it.', 'ok');
          });
        });
      }

      // test link buttons (open the live input value in a new tab)
      editorEl.querySelectorAll('[data-test]').forEach((t) => {
        t.addEventListener('click', (e) => {
          e.preventDefault();
          const key = t.dataset.test;
          const input = editorEl.querySelector(`[data-f="${key}"]`);
          const v = input ? input.value.trim() : '';
          if (!v) { CORE().toast('Paste or save a link first.', 'warn'); return; }
          // cloud-file links are stored host-relative (privacy) — resolve them
          // against the configured cloud base before testing
          let target = v;
          if (/^\/api\//.test(v)) {
            let cb = '';
            try { const P = window.VX_ADMIN_PUBLISH; cb = (P && P.debug && P.debug().base) || ''; } catch (err) { /* ignore */ }
            target = (cb || window.location.origin).replace(/\/+$/, '') + v;
          }
          window.open(target, '_blank', 'noopener');
        });
      });

      // the professional Upload Center (choose from file manager or drag & drop,
      // size + platform auto-detected, new-version / replace mode, live progress)
      bindUploadCenter(editorEl, app);

      // save
      editorEl.querySelector('[data-save]').addEventListener('click', () => {
        const data = collectEditor(editorEl);
        const notes = [];
        // direct-download guarantee: convert GitHub file pages to raw direct links
        ['apk', 'exe', 'web', 'pwa'].forEach((k) => {
          const raw = (data.links[k] || '').trim();
          if (!raw) return;
          const g = ghDirect(raw);
          if (g.kind === 'convert' && g.url) {
            data.links[k] = g.url;
            notes.push(`${k.toUpperCase()} link auto-converted to a direct download URL — users download instantly and never visit GitHub.`);
          } else if (g.kind === 'page' || g.kind === 'releases') {
            notes.push(`⚠ ${k.toUpperCase()} link points to a GitHub PAGE — users would land on GitHub instead of downloading. Use the file link or a releases/download link.`);
          } else if (g.kind === 'insecure') {
            notes.push(`⚠ ${k.toUpperCase()} link uses http:// — switch to https://.`);
          }
          const fv = versionFromFilename(g.url || raw);
          if (fv && fv !== data.version) {
            notes.push(`${k.toUpperCase()} filename contains version ${fv} but "Latest version" is ${data.version} — keep both matching so users get the update notice.`);
          }
        });
        Object.assign(app, data);
        app.updatedAt = new Date().toISOString(); // per-app timestamp → safe merges
        if (CORE().saveStore()) {
          if (notes.length) {
            CORE().toast(`"${app.name}" saved. Publish via Data tab to make it live for all visitors.`, 'ok');
            notes.forEach((n) => CORE().toast(n, /⚠/.test(n) ? 'warn' : 'ok', 7000));
          } else {
            const auto = (JSON.parse(localStorage.getItem('vortex_gh_cfg') || 'null') || {});
            CORE().toast(auto.autoPublish && auto.lastRev
              ? `"${app.name}" saved — auto-publish will make it live for everyone in a moment.`
              : `"${app.name}" saved. Publish via Data tab to make it live for all visitors.`, 'ok');
          }
          renderAppsTab(store, { force: true });
          // reopen the editor for this app after re-render
          const again = root.querySelector(`.app-editor[data-app-id="${CSS.escape(app.id)}"]`);
          if (again) { again.classList.add('open'); }
        }
      });

      // revert
      editorEl.querySelector('[data-undo]').addEventListener('click', () => {
        renderAppsTab(store, { force: true });
        CORE().toast('Unsaved edits reverted.', 'ok');
      });

      // delete (remember the deletion so merges never resurrect it)
      editorEl.querySelector('[data-del]').addEventListener('click', () => {
        CORE().confirmAction(`Delete "${app.name}"?`, 'The app disappears from the marketplace, category pages, updates and gets no detail page. This cannot be undone in this browser.', () => {
          store.apps = store.apps.filter((a) => a.id !== id);
          store.deletedIds = (store.deletedIds || []).filter((d) => d.id !== id);
          store.deletedIds.push({ id, name: app.name, at: new Date().toISOString() });
          if (CORE().saveStore()) {
            CORE().toast('App deleted. Publish via Data tab to remove it for all visitors.', 'ok');
            renderAppsTab(store, { force: true });
          }
        }, 'Delete app');
      });
    });
  }

  /* =============== DATA / PUBLISH TAB =============== */

  function buildDataFile(store) {
    const clone = JSON.parse(JSON.stringify(store));
    // keep everything (meta, logo, apps, auth) — auth holds only a salted hash
    return `/* ============================================================
   VORTEX — Central App Data
   Generated by the VORTEX Admin Panel on ${new Date().toISOString()}
   Replace the previous apps-data.js in your repository with this
   file, commit, and the change goes live for every visitor.
   ============================================================ */

window.VORTEX_DATA = ${JSON.stringify(clone, null, 2)};
`;
  }

  function renderDataTab(store) {
    const el = document.getElementById('tab-data');
    if (!el) return;
    const hasOverride = !!localStorage.getItem('vortex_data_override');
    const apps = store.apps || [];
    const liveLinks = apps.reduce((n, a) => n + (a.links ? ['apk', 'exe', 'web', 'pwa'].filter((k) => a.links[k]).length : 0), 0);
    const sizeKb = Math.max(1, Math.round(JSON.stringify(store).length / 1024));

    el.innerHTML = `
      <h2>Data &amp; publishing</h2>
      <p class="panel-sub">One-click publish: commit your data straight to GitHub from here and the website rebuilds for <b>every visitor</b> automatically. Manual export stays available as a backup path.</p>

      <div class="stat-grid">
        <div class="stat-box"><b>${apps.length}</b><small>Apps in data</small></div>
        <div class="stat-box"><b>${liveLinks}</b><small>Live links</small></div>
        <div class="stat-box"><b style="font-size:1.05rem;padding-top:.3rem">${sizeKb} KB</b><small>Export size</small></div>
        <div class="stat-box"><b style="font-size:.92rem;padding-top:.45rem">${hasOverride ? 'Local edits' : 'Published file'}</b><small>Current data source</small></div>
      </div>

      <div id="pub-mount"></div>

      <div class="data-grid" style="margin-top:1.4rem">
        <div class="data-card">
          <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Manual export (backup path)</h3>
          <p>Prefer doing it by hand, or need a file for safekeeping? Download <b>apps-data.js</b> and replace the file of the same name in your repository, or grab a plain JSON backup. Your logo and password hash are embedded automatically.</p>
          <div class="btn-row">
            <button class="btn btn-ghost" id="exp-js">⇪ Export apps-data.js</button>
            <button class="btn btn-ghost" id="exp-json">Export JSON backup</button>
          </div>
        </div>

        <div class="data-card">
          <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Restore from backup</h3>
          <p>Import a previously exported JSON backup to restore apps, links, logo and settings on any device or browser.</p>
          <div class="btn-row">
            <label class="btn btn-ghost" style="cursor:pointer">Import JSON backup
              <input type="file" id="imp-json" accept=".json,application/json" style="display:none">
            </label>
          </div>
        </div>

        <div class="data-card">
          <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m0 0-3-3m3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Use the published file again</h3>
          <p>This browser currently${hasOverride ? '' : ' does not'} override the published <b>apps-data.js</b>. Clearing the override makes this browser follow the published file exactly (useful after publishing).</p>
          <div class="btn-row">
            <button class="btn btn-ghost" id="clear-override" ${hasOverride ? '' : 'disabled'}>Clear local override</button>
          </div>
        </div>

        <div class="data-card danger-zone">
          <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Danger zone</h3>
          <p>Reset everything in this browser back to the factory defaults (6 original apps, default logo, default password). Your published repository file is not touched.</p>
          <div class="btn-row">
            <button class="btn btn-danger" id="reset-all">Reset all admin data</button>
          </div>
        </div>
      </div>

      <div class="guide-box" style="margin-top:1.6rem">
        <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 13v-2Z" stroke-linejoin="round"/></svg>
          Step-by-step: publish an app or update (APK · EXE · Web · PWA)</h3>
        <ol>
          <li><b>Apps &amp; Links</b> tab → open the app → <b>⇪ Upload file</b>: pick the file from your file manager (or drag &amp; drop). The panel <b>auto-detects everything</b> — icon, app name, version code, size, package name, ABIs, MD5 and SHA-256 — and shows it in the read-only INFO box, then uploads with a live progress bar and fills the download link <b>for you</b>. Users download inside Vortex and never visit GitHub.</li>
          <li>Uploading a new build? Choose <b>New version</b>: the version is read from the filename, the release date refreshes and a changelog entry is added automatically. Choose <b>Replace current file</b> to swap an existing build at the same path. Old versions are never deleted from the repository.</li>
          <li>Prefer an external link? Paste it into the APK / EXE / Web / PWA field — GitHub file links are <b>auto-converted to direct downloads</b> on save.</li>
          <li><b>Data / Publish</b> → <b>Publish now — go live</b>. After your first publish, <b>auto-publish</b> sends every further save live by itself.</li>
          <li>Users who downloaded the previous version instantly see <b>"Update version available"</b> and one click downloads the new file inside Vortex.</li>
        </ol>
      </div>

      <div class="guide-box warn" style="margin-top:1.4rem">
        <h3>⚠ Before you export</h3>
        <ol>
          <li>The exported file contains a <b>salted hash</b> of your admin password (never the password itself). Keep your password long and unique.</li>
          <li>Download links are stored exactly as you paste them — double-check every URL before publishing.</li>
        </ol>
      </div>
    `;

    document.getElementById('exp-js').addEventListener('click', () => {
      CORE().downloadFile('apps-data.js', buildDataFile(store), 'text/javascript');
      CORE().toast('apps-data.js downloaded — replace it in your repository and commit.', 'ok', 6000);
    });

    document.getElementById('exp-json').addEventListener('click', () => {
      const stamp = new Date().toISOString().slice(0, 10);
      CORE().downloadFile(`vortex-backup-${stamp}.json`, JSON.stringify(store, null, 2), 'application/json');
      CORE().toast('JSON backup downloaded.', 'ok');
    });

    document.getElementById('imp-json').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || !Array.isArray(parsed.apps)) throw new Error('bad shape');
          CORE().confirmAction('Import this backup?', `It will replace the current local data: ${parsed.apps.length} apps, logo and settings included.`, () => {
            try {
              localStorage.setItem('vortex_data_override', JSON.stringify(parsed));
              CORE().reloadStore();
              if (CORE().saveStore()) {
                CORE().toast('Backup imported successfully.', 'ok');
                window.VX_ADMIN_DATA.renderAppsTab(CORE().store(), { force: true });
                window.VX_ADMIN_DATA.renderDataTab(CORE().store());
                CORE().switchTab('dashboard');
              }
            } catch (err) {
              CORE().toast('Could not save imported data (storage full?).', 'err');
            }
          }, 'Import backup');
        } catch (err) {
          CORE().toast('That file is not a valid VORTEX JSON backup.', 'err');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('clear-override').addEventListener('click', () => {
      CORE().confirmAction('Clear local override?', 'This browser will follow the published apps-data.js again. Unpublished local edits will be lost.', () => {
        localStorage.removeItem('vortex_data_override');
        CORE().reloadStore();
        window.VX_ADMIN_DATA.renderAppsTab(CORE().store(), { force: true });
        window.VX_ADMIN_DATA.renderDataTab(CORE().store());
        CORE().switchTab('dashboard');
        CORE().toast('Local override cleared — following the published file.', 'ok');
      }, 'Clear override');
    });

    document.getElementById('reset-all').addEventListener('click', () => {
      CORE().confirmAction('Reset ALL admin data?', 'Every app edit, logo upload and setting in this browser returns to factory defaults. Export a backup first if unsure.', () => {
        localStorage.removeItem('vortex_data_override');
        localStorage.removeItem('vortex_admin_lock');
        CORE().reloadStore();
        window.VX_ADMIN_DATA.renderAppsTab(CORE().store(), { force: true });
        window.VX_ADMIN_DATA.renderDataTab(CORE().store());
        CORE().switchTab('dashboard');
        CORE().toast('Everything was reset to factory defaults.', 'ok');
      }, 'Reset everything');
    });

    // mount the direct-publish section (admin-publish.js)
    if (window.VX_ADMIN_PUBLISH) window.VX_ADMIN_PUBLISH.mount(document.getElementById('pub-mount'), store);
  }

  /* =============== hooks =============== */
  window.VX_ADMIN_DATA = {
    renderAppsTab,
    renderDataTab,
    ghDirect,
    linkHint,
    versionFromFilename,
    onTab(name, store) {
      if (name === 'apps') renderAppsTab(store);
      if (name === 'data') renderDataTab(store);
    }
  };
})();
