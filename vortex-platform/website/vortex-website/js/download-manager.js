/* ============================================================
   VORTEX — Download manager (download-manager.js)
   Large releases are stored in the repository as 16 MB parts +
   a .manifest.json (written automatically by the admin Upload
   Center). This module is the visitor side: it reads the
   manifest, downloads the parts with a live progress bar,
   verifies every part's SHA-256, reassembles the original file
   and saves it — all inside the site, never on GitHub.
   ============================================================ */
(() => {
  'use strict';

  const RETRY = 3;        // attempts per part
  const PARALLEL = 3;     // concurrent part downloads

  const fmtBytes = (n) => {
    if (n === undefined || n === null || isNaN(n)) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = Number(n) || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
  };

  async function sha256Hex(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------------- progress modal ---------------- */
  let refs = null;
  function ensureModal() {
    if (refs) return refs;
    const ov = document.createElement('div');
    ov.className = 'vdl-overlay';
    ov.hidden = true;
    ov.innerHTML = `
      <div class="vdl-card" role="dialog" aria-modal="true" aria-label="Downloading file">
        <div class="vdl-head">
          <span class="vdl-spin" aria-hidden="true"></span>
          <div class="vdl-titles">
            <b class="vdl-title">Preparing download…</b>
            <span class="vdl-file"></span>
          </div>
          <button type="button" class="vdl-cancel btn btn-ghost btn-sm">Cancel</button>
        </div>
        <div class="vdl-bar"><span class="vdl-bar-fill"></span></div>
        <div class="vdl-stats">
          <b class="vdl-pct">0%</b>
          <span class="vdl-bytes"></span>
          <span class="vdl-speed"></span>
        </div>
        <div class="vdl-stage"></div>
        <div class="vdl-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Every part is checksum-verified before your file is saved.
        </div>
      </div>`;
    document.body.appendChild(ov);
    refs = {
      ov,
      card: ov.querySelector('.vdl-card'),
      spin: ov.querySelector('.vdl-spin'),
      title: ov.querySelector('.vdl-title'),
      file: ov.querySelector('.vdl-file'),
      cancel: ov.querySelector('.vdl-cancel'),
      fill: ov.querySelector('.vdl-bar-fill'),
      pct: ov.querySelector('.vdl-pct'),
      bytes: ov.querySelector('.vdl-bytes'),
      speed: ov.querySelector('.vdl-speed'),
      stage: ov.querySelector('.vdl-stage'),
      note: ov.querySelector('.vdl-note')
    };
    return refs;
  }

  function modalShow(title, fileLine) {
    const r = ensureModal();
    r.title.textContent = title;
    r.file.textContent = fileLine || '';
    r.fill.style.width = '0%';
    r.pct.textContent = '0%';
    r.bytes.textContent = '';
    r.speed.textContent = '';
    r.stage.textContent = 'Connecting…';
    r.stage.className = 'vdl-stage';
    r.note.hidden = false;
    r.cancel.textContent = 'Cancel';
    r.cancel.hidden = false;
    r.card.classList.remove('err', 'done');
    r.spin.hidden = false;
    r.ov.hidden = false;
  }

  function modalProgress(pct, doneBytes, totalBytes, speed) {
    const r = ensureModal();
    r.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    r.pct.textContent = Math.round(pct) + '%';
    r.bytes.textContent = fmtBytes(doneBytes) + ' of ' + fmtBytes(totalBytes);
    r.speed.textContent = speed || '';
  }

  function modalStage(text, kind) {
    const r = ensureModal();
    r.stage.textContent = text;
    r.stage.className = 'vdl-stage' + (kind ? ' ' + kind : '');
  }

  function modalDone(text) {
    const r = ensureModal();
    r.fill.style.width = '100%';
    r.pct.textContent = '100%';
    r.card.classList.add('done');
    r.spin.hidden = true;
    r.stage.textContent = text || 'Download ready — all parts verified.';
    r.stage.className = 'vdl-stage ok';
    r.cancel.textContent = 'Close';
    r.note.hidden = true;
    setTimeout(() => { r.ov.hidden = true; }, 6000);
  }

  function modalError(text) {
    const r = ensureModal();
    r.card.classList.add('err');
    r.spin.hidden = true;
    r.stage.textContent = text;
    r.stage.className = 'vdl-stage err';
    r.cancel.textContent = 'Close';
    r.note.hidden = true;
  }

  function modalHide() {
    if (refs) refs.ov.hidden = true;
  }

  /* ---------------- download core ---------------- */

  async function fetchPart(url, signal, onBytes) {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) { // very old browsers — read all at once
      const buf = await res.arrayBuffer();
      if (onBytes) onBytes(buf.byteLength);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      got += step.value.length;
      if (onBytes) onBytes(step.value.length, got);
    }
    const all = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    return all.buffer;
  }

  async function downloadChunked(app, kind) {
    const d = kind === 'exe' ? app.exeDownload : app.apkDownload;
    if (!d || d.mode !== 'chunked' || !d.manifest) {
      throw new Error('No multi-part download manifest for this app.');
    }
    // Cloud-hosted manifests (/api/vx-files/<id>) must resolve against the
    // CURRENT cloud base — never the page origin (the site itself lives on
    // GitHub Pages). VX.directUrl handles both relative and legacy URLs.
    const manifestUrl = (window.VX && window.VX.directUrl)
      ? new URL(VX.directUrl(d.manifest), location.href).href
      : new URL(d.manifest, location.href).href;
    const mres = await fetch(manifestUrl, { cache: 'no-store' });
    if (!mres.ok) {
      throw new Error('Download manifest not found (HTTP ' + mres.status + '). The release may still be publishing — please try again in a minute.');
    }
    const man = await mres.json();
    if (!man || man.format !== 'vortex-chunked/1' || !Array.isArray(man.parts) || !man.parts.length) {
      throw new Error('This release has an invalid download manifest.');
    }
    // parts sit next to the manifest — resolve relative to it so this works
    // on GitHub Pages project URLs AND on the root of custom domains
    const base = new URL('./', manifestUrl).href;
    const total = Number(man.size) || man.parts.reduce((s, p) => s + (Number(p.size) || 0), 0);

    modalShow(
      'Downloading ' + (app.name || 'release') + (app.version ? ' v' + app.version : ''),
      (man.filename || d.filename || 'file') + ' · ' + fmtBytes(total) + ' · ' + man.parts.length + ' part' + (man.parts.length > 1 ? 's' : '')
    );

    const ac = new AbortController();
    const onCancel = () => ac.abort();
    refs.cancel.addEventListener('click', onCancel, { once: true });

    const bufs = new Array(man.parts.length).fill(null);
    let doneBytes = 0;
    // smoothed speed estimate
    let speedText = '';
    let lastT = performance.now();
    let lastB = 0;
    const tick = () => {
      const now = performance.now();
      if (now - lastT > 700) {
        const bps = ((doneBytes - lastB) * 1000) / (now - lastT);
        if (bps > 0) speedText = fmtBytes(bps) + '/s';
        lastT = now;
        lastB = doneBytes;
      }
      modalProgress(total ? (doneBytes / total) * 100 : 0, doneBytes, total, speedText);
    };

    let next = 0;
    const workers = [];
    const runWorker = async () => {
      for (;;) {
        const i = next++;
        if (i >= man.parts.length) return;
        const p = man.parts[i];
        const url = base + p.name;
        let buf = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= RETRY && !buf; attempt++) {
          try {
            if (attempt > 1) modalStage('Retrying part ' + (i + 1) + ' of ' + man.parts.length + ' (attempt ' + attempt + ')…');
            buf = await fetchPart(url, ac.signal, () => {});
          } catch (e) {
            if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) throw e;
            lastErr = e;
          }
        }
        if (!buf) throw new Error('Part ' + (i + 1) + ' of ' + man.parts.length + ' failed to download' + (lastErr ? ' (' + lastErr.message + ')' : '') + '. Check your connection and try again — nothing was installed.');
        if (p.sha256) {
          modalStage('Verifying part ' + (i + 1) + ' of ' + man.parts.length + '…');
          const hex = await sha256Hex(buf);
          if (hex.toLowerCase() !== String(p.sha256).toLowerCase()) {
            throw new Error('Integrity check failed on part ' + (i + 1) + ' of ' + man.parts.length + '. The download was stopped — please try again.');
          }
        }
        bufs[i] = buf;
        doneBytes += buf.byteLength;
        tick();
      }
    };
    for (let w = 0; w < Math.min(PARALLEL, man.parts.length); w++) workers.push(runWorker());
    try {
      await Promise.all(workers);
    } catch (e) {
      ac.abort();
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) {
        modalHide();
        throw e; // cancelled by the user — modal already closed
      }
      modalError(e.message || 'Download failed.');
      throw e;
    }

    modalStage('Assembling file…');
    const got = bufs.reduce((s, b) => s + b.byteLength, 0);
    if (man.size && got !== Number(man.size)) {
      const msg = 'Size check failed after assembly (' + fmtBytes(got) + ' ≠ ' + fmtBytes(man.size) + '). Please try again.';
      modalError(msg);
      throw new Error(msg);
    }
    const blob = new Blob(bufs, { type: man.mime || d.mime || 'application/octet-stream' });

    // automated QA hook (?vdlqa=1): report the assembled file instead of saving it
    if (/[?&]vdlqa=1/.test(location.search)) {
      const sha = await sha256Hex(await blob.arrayBuffer());
      window.__VORTEX_DL_TEST = {
        ok: true,
        filename: man.filename,
        size: blob.size,
        sha256: sha,
        expectedSha256: man.sha256,
        parts: man.parts.length
      };
      modalDone('QA assembly complete — see window.__VORTEX_DL_TEST.');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = man.filename || d.filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    // remember the obtained version → powers the "Update available · Update now" chip
    if (window.VX && window.VX.recordUserVersion) {
      try { window.VX.recordUserVersion(app.id, app.version); } catch (err) { /* noop */ }
    }
    modalDone('Download ready — every part verified. Check your downloads folder.');
  }

  /* ---------------- click delegation ---------------- */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-vdl]');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.vdlBusy) return;

    const kind = btn.dataset.vdl === 'exe' ? 'exe' : 'apk';
    const id = btn.getAttribute('data-record-app');
    const apps = (window.VORTEX && window.VORTEX.data && window.VORTEX.data.apps) || [];
    const app = apps.find((a) => a.id === id) || null;
    if (!app) {
      if (window.VX && window.VX.toast) window.VX.toast('Could not find the download data for this app — please reload the page.', 'err');
      return;
    }

    btn.dataset.vdlBusy = '1';
    try {
      await downloadChunked(app, kind);
    } catch (err) {
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err && err.message)))) {
        if (window.VX && window.VX.toast) window.VX.toast('Download cancelled.', 'warn');
      } else if (refs && !refs.ov.hidden) {
        // modal already shows the error — keep it open
      } else if (window.VX && window.VX.toast) {
        window.VX.toast((err && err.message) || 'Download failed.', 'err', 6500);
      }
    } finally {
      delete btn.dataset.vdlBusy;
    }
  });

  window.VORTEX_DL = { download: downloadChunked };
})();
