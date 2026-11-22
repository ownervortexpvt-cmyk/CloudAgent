/* ============================================================
   VORTEX — Admin file inspector (js/admin-apk.js)
   Auto-detection engine behind the Upload Center:
   · Icon, app name, version code, version name, package name
     (binary AndroidManifest.xml + resources.arsc via app-info-parser)
   · Size, ABIs (ZIP central directory), MD5 + SHA-256
     (incremental, chunked — safe for files up to ~95 MB)
   · Status verdict for the read-only INFO panel
   Works fully offline inside the browser; nothing is uploaded
   anywhere during detection.
   ============================================================ */
(() => {
  'use strict';

  /* ================= incremental hashing ================= */

  /** RFC 1321 MD5 — incremental (update / hex), little-endian */
  class MD5 {
    constructor() {
      this.a = 0x67452301; this.b = 0xefcdab89;
      this.c = 0x98badcfe; this.d = 0x10325476;
      this.tail = new Uint8Array(0);
      this.total = 0;
      this.T = new Int32Array(64);
      for (let i = 0; i < 64; i++) this.T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
      this.S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    }
    update(bytes) {
      this.total += bytes.length;
      let buf;
      if (this.tail.length) {
        buf = new Uint8Array(this.tail.length + bytes.length);
        buf.set(this.tail); buf.set(bytes, this.tail.length);
      } else buf = bytes;
      const blocks = (buf.length - (buf.length % 64)) >>> 0;
      for (let off = 0; off < blocks; off += 64) this._block(buf, off);
      this.tail = buf.slice(blocks);
      return this;
    }
    _block(p, off) {
      const M = new Int32Array(16);
      for (let i = 0; i < 16; i++) {
        M[i] = (p[off + i * 4]) | (p[off + i * 4 + 1] << 8) | (p[off + i * 4 + 2] << 16) | (p[off + i * 4 + 3] << 24);
      }
      let A = this.a, B = this.b, C = this.c, D = this.d;
      for (let j = 0; j < 64; j++) {
        let f, g;
        if (j < 16)      { f = (B & C) | (~B & D);      g = j; }
        else if (j < 32) { f = (D & B) | (~D & C);      g = (5 * j + 1) & 15; }
        else if (j < 48) { f = B ^ C ^ D;               g = (3 * j + 5) & 15; }
        else             { f = C ^ (B | ~D);            g = (7 * j) & 15; }
        const tmp = D;
        D = C; C = B;
        const shift = this.S[(j >>> 4) * 4 + (j & 3)];
        const sum = (A + f + this.T[j] + M[g]) | 0;
        B = (B + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        A = tmp;
      }
      this.a = (this.a + A) | 0; this.b = (this.b + B) | 0;
      this.c = (this.c + C) | 0; this.d = (this.d + D) | 0;
    }
    hex() {
      // padding: 0x80, zeros until length ≡ 56 (mod 64), then 64-bit LE bit length
      const tailLen = this.tail.length;
      const padLen = ((55 - tailLen) % 64 + 64) % 64;
      const merged = new Uint8Array(tailLen + 1 + padLen + 8);
      merged.set(this.tail);
      merged[tailLen] = 0x80;
      const bits = this.total * 8;
      const lo = (bits % 4294967296) >>> 0, hi = Math.floor(bits / 4294967296) >>> 0;
      merged[merged.length - 8] = lo & 255; merged[merged.length - 7] = (lo >>> 8) & 255;
      merged[merged.length - 6] = (lo >>> 16) & 255; merged[merged.length - 5] = (lo >>> 24) & 255;
      merged[merged.length - 4] = hi & 255; merged[merged.length - 3] = (hi >>> 8) & 255;
      merged[merged.length - 2] = (hi >>> 16) & 255; merged[merged.length - 1] = (hi >>> 24) & 255;
      for (let off = 0; off < merged.length; off += 64) this._block(merged, off);
      const hexOf = (v) => {
        let s = '';
        for (let i = 0; i < 4; i++) s += ((v >>> (i * 8)) & 255).toString(16).padStart(2, '0');
        return s;
      };
      return hexOf(this.a) + hexOf(this.b) + hexOf(this.c) + hexOf(this.d);
    }
  }

  /** FIPS 180-4 SHA-256 — incremental (update / hex), big-endian */
  class SHA256 {
    constructor() {
      this.h = new Int32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
      this.k = new Int32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
      this.tail = new Uint8Array(0);
      this.total = 0;
    }
    update(bytes) {
      this.total += bytes.length;
      let buf;
      if (this.tail.length) {
        buf = new Uint8Array(this.tail.length + bytes.length);
        buf.set(this.tail); buf.set(bytes, this.tail.length);
      } else buf = bytes;
      const blocks = (buf.length - (buf.length % 64)) >>> 0;
      for (let off = 0; off < blocks; off += 64) this._block(buf, off);
      this.tail = buf.slice(blocks);
      return this;
    }
    _block(p, off) {
      const w = new Int32Array(64);
      for (let i = 0; i < 16; i++) {
        w[i] = (p[off + i * 4] << 24) | (p[off + i * 4 + 1] << 16) | (p[off + i * 4 + 2] << 8) | (p[off + i * 4 + 3]);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = this.h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + this.k[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      this.h[0] = (this.h[0] + a) | 0; this.h[1] = (this.h[1] + b) | 0;
      this.h[2] = (this.h[2] + c) | 0; this.h[3] = (this.h[3] + d) | 0;
      this.h[4] = (this.h[4] + e) | 0; this.h[5] = (this.h[5] + f) | 0;
      this.h[6] = (this.h[6] + g) | 0; this.h[7] = (this.h[7] + h) | 0;
    }
    hex() {
      const bits = this.total * 8;
      const padLen = ((((this.total + 8) >> 6) + 1) * 64) - this.total;
      const merged = new Uint8Array(this.tail.length + padLen);
      merged.set(this.tail);
      merged[this.tail.length] = 0x80;
      const lo = (bits % 4294967296) >>> 0, hi = Math.floor(bits / 4294967296) >>> 0;
      merged[merged.length - 8] = (hi >>> 24) & 255; merged[merged.length - 7] = (hi >>> 16) & 255;
      merged[merged.length - 6] = (hi >>> 8) & 255; merged[merged.length - 5] = hi & 255;
      merged[merged.length - 4] = (lo >>> 24) & 255; merged[merged.length - 3] = (lo >>> 16) & 255;
      merged[merged.length - 2] = (lo >>> 8) & 255; merged[merged.length - 1] = lo & 255;
      for (let off = 0; off < merged.length; off += 64) this._block(merged, off);
      let s = '';
      for (let i = 0; i < 8; i++) {
        const v = this.h[i];
        s += ((v >>> 24) & 255).toString(16).padStart(2, '0') + ((v >>> 16) & 255).toString(16).padStart(2, '0') +
             ((v >>> 8) & 255).toString(16).padStart(2, '0') + (v & 255).toString(16).padStart(2, '0');
      }
      return s;
    }
  }

  /* ================= ZIP central directory ================= */

  /** Parse the ZIP central directory (names, sizes, methods). Needs only
      the tail of the file — perfect for File.slice() streaming. */
  function zipCentralDir(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const stop = Math.max(0, u8.length - 22 - 65536);
    for (let i = u8.length - 22; i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip archive');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let k = 0; k < count; k++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const size = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));
      entries.push({ name, method, compSize, size, localOff });
      off += 46 + nameLen + extraLen + commLen;
    }
    return { entries, declared: count };
  }

  /** CPU architectures found under lib/<abi>/ — the Android ABIs */
  const ABI_ORDER = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86', 'armeabi', 'mips', 'mips64'];
  function listAbis(entries) {
    const set = new Set();
    (entries || []).forEach((e) => {
      const m = /^lib\/([^/]+)\//.exec(e.name || '');
      if (m) set.add(m[1]);
    });
    return Array.from(set).sort((a, b) => {
      const ia = ABI_ORDER.indexOf(a) + 1 || 99, ib = ABI_ORDER.indexOf(b) + 1 || 99;
      return ia - ib;
    });
  }

  /* ================= chunked base64 (upload helper) ================= */

  /** File → base64 without the data: prefix. Read in 3 MB-aligned chunks so
      even ~95 MB files encode with modest memory + real progress. */
  function fileToB64(file, onProgress) {
    const CHUNK = 3 * 1024 * 1024 - (3 * 1024 * 1024) % 3; // multiple of 3 → clean b64 concat
    const parts = [];
    let off = 0;
    function nextChunk() {
      if (off >= file.size) return Promise.resolve(parts.join(''));
      const slice = file.slice(off, off + CHUNK);
      return slice.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        const SUB = 0x8000;
        for (let i = 0; i < bytes.length; i += SUB) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + SUB, bytes.length)));
        }
        parts.push(btoa(bin));
        off += CHUNK;
        if (onProgress) try { onProgress(Math.min(100, Math.round(off / file.size * 100))); } catch (e) { /* noop */ }
        return nextChunk();
      });
    }
    return nextChunk();
  }

  /* ================= APK inspection ================= */

  function fmtBytes(n) {
    const b = Number(n) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }

  function detectKind(name) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'apk') return 'apk';
    if (ext === 'apks' || ext === 'xapk' || ext === 'aab') return 'apk-related';
    if (ext === 'exe' || ext === 'msi') return 'exe';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    return 'other';
  }

  /** application.label may be a string, an array (resource resolved) or an
      unresolved "resourceId:…" marker — normalise to a display string. */
  function pickLabel(label) {
    if (Array.isArray(label)) {
      const first = label.find((v) => typeof v === 'string' && v && v.indexOf('resourceId:') !== 0);
      return first || '';
    }
    if (typeof label === 'string' && label.indexOf('resourceId:') !== 0) return label;
    return '';
  }

  async function hashFile(file, which, onProgress) {
    const impl = which === 'md5' ? new MD5() : new SHA256();
    const CHUNK = 8 * 1024 * 1024;
    for (let off = 0; off < file.size; off += CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
      impl.update(buf);
      if (onProgress) try { onProgress(Math.min(100, Math.round((off + buf.length) / file.size * 100))); } catch (e) { /* noop */ }
    }
    return impl.hex();
  }

  /**
   * Full inspection of a picked file. onStage(phase, pct, note) reports:
   *   'md5'  'sha'  'parse'  'zip'  'done'
   * Returns a plain result object (see INFO panel in admin-data.js).
   */
  async function inspectFile(file, onStage) {
    const say = (p, pc, n) => { if (onStage) try { onStage(p, pc, n); } catch (e) { /* noop */ } };
    const kind = detectKind(file && file.name);
    const result = {
      kind, size: (file && file.size) || 0,
      md5: '', sha256: '',
      packageName: '', versionCode: '', versionName: '', label: '',
      iconDataUrl: '', abis: [], parsed: false, warnings: []
    };
    if (!file) return result;

    say('md5', 0);
    result.md5 = await hashFile(file, 'md5', (p) => say('md5', p));
    say('sha', 0);
    result.sha256 = await hashFile(file, 'sha', (p) => say('sha', p));

    // ZIP directory → ABIs + structure sanity (apk / apks / xapk / aab / zip)
    if (kind === 'apk' || kind === 'apk-related' || kind === 'archive') {
      say('zip', 0);
      try {
        const tailStart = Math.max(0, file.size - (22 + 65536));
        const cdSize = file.size - tailStart;
        const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
        // central dir may sit before the tail window for huge zips — widen once if needed
        let cd;
        try { cd = zipCentralDir(tail); }
        catch (e) {
          const head = new Uint8Array(await file.slice(0, Math.min(file.size, 12 * 1024 * 1024)).arrayBuffer());
          cd = zipCentralDir(new Uint8Array([...head, ...tail])); // rare fallback
        }
        result.abis = listAbis(cd.entries);
        result.entries = cd.entries.length;
        const names = new Set(cd.entries.map((e) => e.name));
        result.hasManifest = names.has('AndroidManifest.xml');
        result.hasArsc = names.has('resources.arsc');
      } catch (e) {
        result.warnings.push('Archive structure could not be read (' + e.message + ').');
      }
    }

    if (kind === 'apk' || kind === 'apk-related') {
      say('parse', 0);
      if (typeof window.AppInfoParser !== 'function') {
        result.warnings.push('APK metadata library missing — package details unavailable.');
      } else if (!result.hasManifest && kind === 'apk') {
        result.warnings.push('This APK has no AndroidManifest.xml — it may be corrupted.');
      } else {
        try {
          const parser = new window.AppInfoParser(file);
          const r = await parser.parse();
          result.parsed = true;
          result.packageName = String(r.package || '');
          result.versionCode = r.versionCode != null ? String(r.versionCode) : '';
          result.versionName = r.versionName != null ? String(r.versionName) : '';
          result.label = pickLabel(r.application && r.application.label);
          result.iconDataUrl = (typeof r.icon === 'string' && r.icon.startsWith('data:image')) ? r.icon : '';
          const sdk = r.usesSdk || {};
          result.minSdk = sdk.minSdkVersion != null ? String(sdk.minSdkVersion) : '';
          result.targetSdk = sdk.targetSdkVersion != null ? String(sdk.targetSdkVersion) : '';
        } catch (e) {
          result.warnings.push('APK metadata could not be fully read (protected or unusual build): ' + (e && e.message ? e.message : 'parse error'));
        }
      }
    }
    say('done', 100);
    return result;
  }

  /** Short human status for the INFO panel */
  function statusText(r, context) {
    const ctx = context || {};
    if (r.kind === 'apk' || r.kind === 'apk-related') {
      if (r.parsed) {
        const bits = ['✓ Valid APK — parsed successfully'];
        if (r.versionName) bits.push('version ' + r.versionName + (r.versionCode ? ' (code ' + r.versionCode + ')' : ''));
        if (r.abis && r.abis.length) bits.push(r.abis.join(' + '));
        else bits.push('universal (no native libs)');
        if (ctx.versionChanged) bits.push('⚠ version differs from the app entry — "New version" upload will update it');
        return bits.join(' · ');
      }
      return '⚠ APK structure detected but metadata unreadable — size, checksums' +
        (r.abis && r.abis.length ? ' and ABIs are still verified' : ' are verified') + '.';
    }
    if (r.kind === 'exe') return '✓ Windows file — size & checksums detected (package metadata is not readable in the browser).';
    if (r.kind === 'archive') return '✓ Archive — size & checksums detected. For Web apps paste the URL or deploy the package.';
    return '✓ File ready — size & checksums detected.';
  }

  const API = {
    MD5, SHA256, zipCentralDir, listAbis, fileToB64, detectKind, pickLabel,
    hashFile, inspectFile, statusText, fmtBytes,
    md5Hex: (u8) => new MD5().update(u8).hex(),
    sha256Hex: (u8) => new SHA256().update(u8).hex()
  };

  if (typeof window !== 'undefined') window.VX_APK = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
