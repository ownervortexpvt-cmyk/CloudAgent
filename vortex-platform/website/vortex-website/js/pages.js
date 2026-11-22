/* ============================================================
   VORTEX — Page renderers (pages.js)
   Renders app cards, detail pages, updates list and binds the
   contact form. Runs after main.js builds the shared chrome.
   ============================================================ */
(() => {
  'use strict';

  window.VX_PAGES = function ({ data, VX }) {
    const page = document.body.dataset.page || '';
    const esc = VX.esc;
    const apps = VX.getApps(data);

    /* ---------- shared pieces ---------- */

    const ICON_SVG = {
      android: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 10.5a7 7 0 0 1 14 0V17a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17Z" stroke-linejoin="round"/><path d="M8.5 7 7 4.5M15.5 7 17 4.5M9.5 13h.01M14.5 13h.01M5 10.5h14" stroke-linecap="round"/></svg>',
      pwa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 15V9l6 6V9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5Z"/></svg>',
      empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5" stroke-linecap="round"/></svg>'
    };

    const CAT_LABEL = { apk: 'APK', exe: 'Windows', pwa: 'PWA', webapp: 'Web App' };

    /** One primary action button for a card, depending on page context */
    function primaryAction(app, prefer) {
      const rec = `data-record-app="${esc(app.id)}" data-record-ver="${esc(app.version)}"`;
      const mk = (href, label, extra) =>
        `<a class="btn btn-primary btn-sm" href="${esc(href)}" ${extra || ''} ${rec}>${label}</a>`;
      /** multi-part release → js/download-manager.js assembles the file with a
          live progress bar and verifies every part before saving. */
      const vdl = (kind, label) =>
        `<button type="button" class="btn btn-primary btn-sm" data-vdl="${kind}" ${rec}>${label}</button>`;
      const apkChunked = app.apkDownload && app.apkDownload.mode === 'chunked';
      const exeChunked = app.exeDownload && app.exeDownload.mode === 'chunked';
      if (prefer === 'apk') {
        if (apkChunked) return vdl('apk', 'Download APK');
        return app.links.apk ? mk(VX.directUrl(app.links.apk), 'Download APK', 'download') : soonBtn();
      }
      if (prefer === 'web') {
        const webHref = app.links.pwa || app.links.web;
        return webHref ? mk(webHref, 'Open App', 'target="_blank" rel="noopener"') : soonBtn();
      }
      if (apkChunked) return vdl('apk', 'Download APK');
      if (app.links.apk) return mk(VX.directUrl(app.links.apk), 'Download APK', 'download');
      if (exeChunked) return vdl('exe', 'Download EXE');
      if (app.links.exe) return mk(VX.directUrl(app.links.exe), 'Download EXE', 'download');
      if (app.links.web) return mk(app.links.web, 'Open App', 'target="_blank" rel="noopener"');
      return soonBtn();
    }

    function soonBtn() {
      return `<a class="btn btn-ghost btn-sm is-disabled" href="#" data-coming-soon="1">Coming Soon</a>`;
    }

    function card(app, prefer, delay) {
      const uv = VX.getUserVersions()[app.id];
      const hasUpdate = uv && uv.installed && VX.vNewer(app.version, uv.installed);
      const cats = (app.categories || []).map((c) => `<span class="chip">${esc(CAT_LABEL[c] || c)}</span>`).join('');
      const style = `--card-accent:${esc(app.accent || '#22d3ee')}` + (delay ? `;animation-delay:${Math.min(delay, 400)}ms` : '');
      return `
      <article class="app-card" style="${style}">
        <div class="app-card-top">
          <span class="app-icon"><img src="${esc(VX.iconSrc(app))}" alt="${esc(app.name)} icon" loading="lazy" onerror="this.src='logo.svg'"></span>
          <div class="app-id">
            <h3>${esc(app.name)}</h3>
            <span class="app-type">${esc(app.type || '')}</span>
          </div>
          <span class="ver-chip">v${esc(app.version)}</span>
        </div>
        <p class="app-tagline">${esc(app.tagline || '')}</p>
        <div class="app-chips">${cats}${hasUpdate ? `<a class="update-chip" href="app.html?id=${encodeURIComponent(app.id)}" title="You have v${esc(uv.installed)} — tap to update to v${esc(app.version)}">Update available · Update now<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : ''}</div>
        <div class="app-actions">
          <a class="btn btn-ghost btn-sm" href="app.html?id=${encodeURIComponent(app.id)}">Details</a>
          ${primaryAction(app, prefer)}
        </div>
      </article>`;
    }

    function renderGrid(el, list, prefer) {
      if (!el) return;
      if (!list.length) {
        el.innerHTML = `
          <div class="empty-state">
            <svg class="es-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 9.5h18M9.5 9.5V21" stroke-linecap="round"/></svg>
            <h3>No apps published here yet</h3>
            <p>The VORTEX team hasn't published anything in this category so far. Check back soon — new releases and updates are announced right here on this site.</p>
          </div>`;
        return;
      }
      el.innerHTML = list.map((a, i) => card(a, prefer, i * 60)).join('');
    }

    /* ---------- Marketplace filters ---------- */
    function bindFilters(onFilter) {
      const bar = document.querySelector('.filter-bar');
      if (!bar) return;
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        bar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onFilter(btn.dataset.filter);
      });
    }

    /* ---------- App search (marketplace + platform pages) ----------
       Live-filters the visible grid while typing. Searches name,
       tagline, type, version, description, categories, features and
       changelog entries. Prefills from ?q= so the home-page hero
       search box lands here with results ready. */
    function bindSearch(gridId, getList, prefer) {
      const input = document.getElementById('app-search');
      const grid = document.getElementById(gridId);
      if (!input || !grid) return null;
      const clearBtn = document.getElementById('app-search-clear');
      const count = document.getElementById('app-search-count');
      const norm = (s) => String(s || '').toLowerCase();
      const matches = (a, q) =>
        norm(a.name).includes(q) || norm(a.tagline).includes(q) || norm(a.type).includes(q) ||
        norm(a.version).includes(q) || norm(a.description).includes(q) ||
        (a.categories || []).some((c) => norm(CAT_LABEL[c] || c).includes(q)) ||
        (a.features || []).some((f) => norm(f).includes(q)) ||
        (a.changelog || []).some((c) => norm(c.v).includes(q));
      const urlQ = new URLSearchParams(location.search).get('q') || '';
      if (urlQ && !input.value) input.value = urlQ;
      function apply() {
        const q = norm(input.value).trim();
        const base = getList();
        const list = q ? base.filter((a) => matches(a, q)) : base;
        renderGrid(grid, list, prefer);
        if (!list.length && q) {
          grid.innerHTML = `
          <div class="empty-state">
            <svg class="es-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/></svg>
            <h3>No apps found for “${esc(input.value.trim())}”</h3>
            <p>Check the spelling or try a shorter word — or clear the search to browse the full catalogue.</p>
            <div style="margin-top:1.2rem"><button type="button" class="btn btn-ghost btn-sm" id="search-reset">Clear search</button></div>
          </div>`;
          const rs = document.getElementById('search-reset');
          if (rs) rs.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
        }
        if (count) {
          count.hidden = !q;
          count.textContent = q ? `${list.length} of ${base.length} app${base.length === 1 ? '' : 's'} match “${input.value.trim()}”` : '';
        }
        if (clearBtn) clearBtn.hidden = !input.value;
      }
      let t = null;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 130); });
      if (clearBtn) clearBtn.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
      apply();
      return { apply };
    }

    /* ---------- Updates page ---------- */
    function renderUpdates() {
      const el = document.getElementById('updates-list');
      if (!el) return;
      if (!apps.length) { el.innerHTML = '<div class="empty-state"><h3>No apps yet</h3><p>Version history will appear here once apps are published.</p></div>'; return; }
      const uv = VX.getUserVersions();
      el.innerHTML = apps.map((a, i) => {
        const rec = uv[a.id];
        let pill, note;
        if (rec && rec.installed && VX.vNewer(a.version, rec.installed)) {
          pill = '<span class="status-pill warn">Update version available</span>';
          note = `<p class="muted" style="font-size:.93rem">You have v${esc(rec.installed)} — v${esc(a.version)} is ready. Open the app page to download the update.</p>`;
        } else if (rec && rec.installed) {
          pill = '<span class="status-pill ok">Up to date</span>';
          note = `<p class="muted" style="font-size:.93rem">You are on the latest version (v${esc(a.version)}).</p>`;
        } else {
          pill = '<span class="status-pill idle">Not installed yet</span>';
          note = `<p class="muted" style="font-size:.93rem">Download the app once — this page will then track its version for you.</p>`;
        }
        const log = (a.changelog || []).map((c, ci) => `
          <li>
            <div class="cl-head">
              <span class="cl-ver">v${esc(c.v)}</span>
              <span class="cl-date">${esc(VX.fmtDate(c.d))}</span>
              ${ci === 0 ? '<span class="cl-latest">Latest</span>' : ''}
            </div>
            <ul>${(c.c || []).map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
          </li>`).join('');
        return `
        <article class="update-row" style="animation-delay:${Math.min(i * 60, 300)}ms">
          <span class="app-icon"><img src="${esc(VX.iconSrc(a))}" alt="${esc(a.name)} icon" loading="lazy" onerror="this.src='logo.svg'"></span>
          <div class="ur-main">
            <h3>${esc(a.name)}</h3>
            <div class="ur-meta">
              <span class="ver-chip">v${esc(a.version)}</span>
              <span>Released ${esc(VX.fmtDate(a.releaseDate))}</span>
              <span>·</span><span>${esc(a.size || '')}</span>
              ${pill}
            </div>
            ${note}
            <details class="changelog-details" ${rec && rec.installed && VX.vNewer(a.version, rec.installed) ? 'open' : ''}>
              <summary style="cursor:pointer;color:var(--accent);font-size:.88rem;margin:.7rem 0 .9rem">Version history ▾</summary>
              <ul class="changelog">${log}</ul>
            </details>
            <div class="app-actions" style="padding-top:.3rem">
              <a class="btn btn-ghost btn-sm" href="app.html?id=${encodeURIComponent(a.id)}">Open app page</a>
            </div>
          </div>
        </article>`;
      }).join('');
    }

    /* ---------- App detail page ---------- */
    function renderDetail() {
      const el = document.getElementById('app-detail');
      if (!el) return;
      const id = new URLSearchParams(location.search).get('id');
      const app = VX.getApp(data, id);

      if (!app) {
        el.innerHTML = `
          <div class="empty-state">
            ${ICON_SVG.empty.replace('<svg', '<svg class="es-ico"')}
            <h3>App not found</h3>
            <p>This app does not exist or may have been removed. Browse the marketplace to find what you are looking for.</p>
            <div style="margin-top:1.4rem"><a class="btn btn-primary" href="marketplace.html">Go to Marketplace</a></div>
          </div>`;
        return;
      }

      document.title = `${app.name} — v${app.version} | VORTEX`;

      const rec = VX.getUserVersions()[app.id];
      const hasUpdate = rec && rec.installed && VX.vNewer(app.version, rec.installed);
      const A = esc(app.accent || '#22d3ee');
      const recAttr = `data-record-app="${esc(app.id)}" data-record-ver="${esc(app.version)}"`;

      const dlBtn = (label, href, small, vdlKind) =>
        vdlKind
          ? `<button type="button" class="btn btn-primary" data-vdl="${vdlKind}" ${recAttr}>${label}<small>${esc(small)}</small></button>`
          : `<a class="btn btn-primary" href="${esc(VX.directUrl(href))}" download ${recAttr}>${label}<small>${esc(small)}</small></a>`;
      const openBtn = (label, href, small) =>
        `<a class="btn btn-primary" href="${esc(href)}" target="_blank" rel="noopener" ${recAttr}>${label}<small>${esc(small)}</small></a>`;
      const soon = (label) => `<a class="btn btn-ghost is-disabled" href="#" data-coming-soon="1">${label}<small>Link not published yet</small></a>`;

      const showApk = (app.categories || []).includes('apk');
      const isDesktop = /desktop|windows|exe/i.test(app.type || '') || (app.categories || []).includes('exe');
      const showWeb = (app.categories || []).includes('webapp') || (app.categories || []).includes('pwa');

      const apkChunked = app.apkDownload && app.apkDownload.mode === 'chunked';
      const exeChunked = app.exeDownload && app.exeDownload.mode === 'chunked';
      const apkSub = `v${app.version} · ${app.size || ''}` + (apkChunked ? ' · verified multi-part download' : '');
      const apkRow = showApk ? ((app.links.apk || apkChunked) ? dlBtn('Download APK', app.links.apk || '#', apkSub, apkChunked ? 'apk' : null) : soon('Download APK')) : '';
      const exeRow = (app.links.exe || isDesktop || exeChunked) ? ((app.links.exe || exeChunked) ? dlBtn('Download for Windows', app.links.exe || '#', `v${app.version} · EXE${app.size ? ' · ' + app.size : ''}` + (exeChunked ? ' · verified multi-part download' : ''), exeChunked ? 'exe' : null) : soon('Download for Windows')) : '';
      const pwaRow = showWeb && app.links.pwa ? openBtn('Install PWA', app.links.pwa, 'Direct install link') : '';
      const webRow = showWeb ? (app.links.web ? openBtn('Open Web App', app.links.web, 'Runs in your browser') : (app.links.pwa ? '' : soon('Open Web App'))) : '';

      const dlRows = [apkRow, exeRow, pwaRow, webRow].filter(Boolean).join('');
      const dlBlock = dlRows
        ? `<div class="dl-row">${dlRows}</div><p class="muted" style="font-size:.83rem;margin-top:.8rem">Downloads and links are published directly by the VORTEX team. You are always on the official page.</p>`
        : `<div class="soon-note">No download links have been published for this app yet. Please check back soon — new links appear here the moment they go live.</div>`;

      const updateBox = hasUpdate ? `
        <div class="update-callout">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Update version available
          </h3>
          <p>You currently have <b>v${esc(rec.installed)}</b> installed. Version <b>v${esc(app.version)}</b> is ready — update now to get the latest fixes and features.</p>
          <a class="btn btn-primary btn-sm" href="#downloads">Update now ↓</a>
        </div>` : '';

      const featList = (app.features || []).map((f) => `
        <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${esc(f)}</li>`).join('');

      const logHtml = (app.changelog || []).map((c, ci) => `
        <li>
          <div class="cl-head">
            <span class="cl-ver">v${esc(c.v)}</span>
            <span class="cl-date">${esc(VX.fmtDate(c.d))}</span>
            ${ci === 0 ? '<span class="cl-latest">Latest</span>' : ''}
          </div>
          <ul>${(c.c || []).map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
        </li>`).join('') || '<li><span class="cl-ver">—</span></li>';

      const others = apps.filter((a) => a.id !== app.id).slice(0, 3);
      const othersHtml = others.map((a) => card(a, 'auto')).join('');

      // Package verification block — shown when the admin uploaded a parsed APK
      const pk = app.apkInfo;
      const pkgBlock = (pk && pk.package && showApk) ? `
        <section class="detail-panel">
          <h2>Package details</h2>
          <p class="muted" style="font-size:.85rem;margin-bottom:.8rem">Technical details of the published APK file, auto-detected when it was uploaded — for verification before installing.</p>
          <div class="pkg-grid">
            <div><small>Package name</small><b>${esc(pk.package)}</b></div>
            ${pk.versionCode ? `<div><small>Version code</small><b>${esc(String(pk.versionCode))}</b></div>` : ''}
            ${pk.versionName ? `<div><small>Version name</small><b>${esc(String(pk.versionName))}</b></div>` : ''}
            ${pk.abis && pk.abis.length ? `<div><small>ABIs</small><b>${esc(pk.abis.join(', '))}</b></div>` : ''}
            ${pk.sizeBytes ? `<div><small>File size</small><b>${esc((pk.sizeBytes / (1024 * 1024)).toFixed(1))} MB</b></div>` : ''}
            ${pk.sha256 ? `<div class="wide"><small>SHA-256</small><b class="pkg-hash" title="${esc(pk.sha256)}">${esc(String(pk.sha256).slice(0, 32))}…</b></div>` : ''}
          </div>
        </section>` : '';

      const paras = String(app.description || '').split(/\n+/).filter(Boolean)
        .map((p) => `<p style="color:var(--muted);margin-bottom:1rem">${esc(p)}</p>`).join('');

      el.innerHTML = `
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="index.html">Home</a><span class="sep">/</span>
          <a href="marketplace.html">Marketplace</a><span class="sep">/</span>
          <span>${esc(app.name)}</span>
        </nav>

        <header class="detail-head" style="--card-accent:${A}">
          <span class="detail-icon"><img src="${esc(VX.iconSrc(app))}" alt="${esc(app.name)} icon" onerror="this.src='logo.svg'"></span>
          <div class="detail-info">
            <h1>${esc(app.name)}</h1>
            <span class="app-type">${esc(app.type || '')}</span>
            <div class="detail-meta">
              <span class="ver-chip">v${esc(app.version)}</span>
              <span class="chip">${esc(app.size || 'Size N/A')}</span>
              <span class="chip">Updated ${esc(VX.fmtDate(app.releaseDate))}</span>
              ${(app.categories || []).map((c) => `<span class="chip chip-accent">${esc(CAT_LABEL[c] || c)}</span>`).join('')}
            </div>
            <p class="detail-tagline">${esc(app.tagline || '')}</p>
          </div>
        </header>

        ${updateBox}

        <div class="detail-grid">
          <div>
            <section class="detail-panel">
              <h2>About this app</h2>
              ${paras || '<p class="muted">Description coming soon.</p>'}
            </section>
            ${featList ? `<section class="detail-panel"><h2>Key features</h2><ul class="feature-list">${featList}</ul></section>` : ''}
            <section class="detail-panel">
              <h2>Version history</h2>
              <ul class="changelog">${logHtml}</ul>
            </section>
            ${pkgBlock}
          </div>
          <div>
            <section class="detail-panel" id="downloads">
              <h2>Get the app</h2>
              ${dlBlock}
            </section>
          </div>
        </div>

        ${others.length ? `
        <section class="section" style="padding-bottom:1rem">
          <div class="section-head"><h2>More from VORTEX</h2><p>Other apps you might like.</p></div>
          <div class="apps-grid">${othersHtml}</div>
        </section>` : ''}
      `;
    }

    /* ---------- Contact form ---------- */
    function bindContact() {
      const form = document.getElementById('contact-form');
      if (!form) return;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const get = (id) => (document.getElementById(id) || {}).value || '';
        const name = get('c-name').trim();
        const email = get('c-email').trim();
        const subject = get('c-subject').trim() || 'VORTEX website contact';
        const message = get('c-message').trim();
        if (!name || !message) { VX.toast('Please fill in your name and message.', 'warn'); return; }
        const adminEmail = (data.meta && data.meta.contactEmail || '').trim();
        if (!adminEmail) {
          VX.toast('Contact email is not configured yet. The site owner can set it in Admin Panel → Settings.', 'warn', 5200);
          return;
        }
        const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
        location.href = `mailto:${encodeURIComponent(adminEmail)}?subject=${encodeURIComponent('[' + subject + '] from ' + name)}&body=${encodeURIComponent(body)}`;
        VX.toast('Opening your email app to send this message…', 'ok');
      });
    }

    /* ---------- dispatch ---------- */
    switch (page) {
      case 'index': {
        renderGrid(document.getElementById('featured-grid'), apps.slice(0, 6), 'auto');
        break;
      }
      case 'marketplace': {
        let filter = 'all';
        const getList = () => (filter === 'all' ? apps : apps.filter((a) => (a.categories || []).includes(filter)));
        const search = bindSearch('apps-grid', getList, 'auto');
        if (!search) renderGrid(document.getElementById('apps-grid'), apps, 'auto');
        bindFilters((f) => {
          filter = f;
          if (search) search.apply();
          else renderGrid(document.getElementById('apps-grid'), getList(), 'auto');
        });
        break;
      }
      case 'apk': {
        const list = apps.filter((a) => (a.categories || []).includes('apk'));
        if (!bindSearch('apps-grid', () => list, 'apk')) renderGrid(document.getElementById('apps-grid'), list, 'apk');
        break;
      }
      case 'pwa': {
        const list = apps.filter((a) => (a.categories || []).includes('pwa'));
        if (!bindSearch('apps-grid', () => list, 'web')) renderGrid(document.getElementById('apps-grid'), list, 'web');
        break;
      }
      case 'webapps': {
        const list = apps.filter((a) => (a.categories || []).includes('webapp'));
        if (!bindSearch('apps-grid', () => list, 'web')) renderGrid(document.getElementById('apps-grid'), list, 'web');
        break;
      }
      case 'updates':
        renderUpdates();
        break;
      case 'app':
        renderDetail();
        break;
      case 'contact':
        bindContact();
        break;
    }
  };
})();
