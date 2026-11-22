/**
 * v89 — Cloud Vault: Firebase Storage as the owner's OWN backup location.
 *
 * WHY (the owner's exact words): "firebase er shathe conect thakle ami
 * firebase e login thakbo — ete ami jodi amar ei mobile ta hariyeu jay
 * amr kisui hobena" + platform account changes / snapshot rollbacks wiping the
 * sandbox. The builder's live data still lives HERE (builds already run in
 * the cloud sandbox — the phone is only the screen); the vault keeps
 * RESTORE POINTS in a bucket the owner controls, so any of those disasters
 * ends with "restore" instead of "everything gone".
 *
 * Honest scope:
 *   • Backup payload = the same JSON /api/backup produces (projects, files,
 *     runs, provider CONFIGS, non-security settings). API keys, GitHub
 *     tokens and lock secrets NEVER travel — same contract as the manual
 *     backup the platform already had.
 *   • Firebase Storage does NOT grow the fixed 9.9 GB sandbox disk and does
 *     NOT bridge PC editors — it is a restore-point vault, period.
 *
 * Implementation — NO new npm deps:
 *   Auth  — Firebase service-account JSON (one button in Firebase Console:
 *           Project settings → Service accounts → Generate new private key),
 *           RS256 JWT signed with node:crypto → oauth2 token endpoint.
 *           Service accounts bypass Storage Security Rules via IAM; the
 *           auto-generated firebase-adminsdk account has Editor by default.
 *   API   — Cloud Storage JSON API (the bucket behind Firebase Storage IS a
 *           GCS bucket; <project>.firebasestorage.app works as a plain bucket
 *           name): resumable upload, prefix list, alt=media download, delete.
 *   Store — service-account JSON is AES-256-GCM encrypted at rest
 *           (lib/crypto.ts — the strong tier, like GitHub PATs).
 */
import crypto from 'crypto'
import fs from 'fs'
import { db } from './db'
import { encrypt, decrypt } from './crypto'
import { buildBackupPayload, restoreBackupPayload } from './backup-core'
import { localFreeMb, CRITICAL_DISK_MB } from './disk'

const S = {
  bucket: 'fbstore.bucket',
  projectId: 'fbstore.projectId',
  enabled: 'fbstore.enabled',
  auto: 'fbstore.auto',
  saEnc: 'fbstore.saEnc',
  lastBackupAt: 'fbstore.lastBackupAt',
  lastBackupNote: 'fbstore.lastBackupNote',
}

export const FB_BACKUP_PREFIX = 'cloud-agent-backups/'
/** v91 — published build artifacts (APK/AAB/zips) land here instead of Google Drive. */
export const FB_ARTIFACT_PREFIX = 'publish-artifacts/'
/** v91 — source-code archives pushed from the TAKE THE SOURCE ANYWHERE card. */
export const FB_SOURCE_PREFIX = 'source-exports/'
const AUTO_TICK_MS = 6 * 3600 * 1000 // check every 6 h
const AUTO_MAX_AGE_MS = 24 * 3600 * 1000 // back up when the last one is older than 24 h
const AUTO_MIN_FREE_MB = 300 // never push a backup onto a dying disk

/* ------------------------------ settings io ------------------------------ */

async function getSetting(key: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string) {
  await db.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

async function clearSettings(keys: string[]) {
  await db.userSetting.deleteMany({ where: { key: { in: keys } } })
}

/* --------------------------- parsing (owner pastes) ---------------------- */

export interface FbParsedConfig { bucket: string; projectId: string }

/**
 * Phone reality: the owner copies the JS snippet from Firebase Console —
 * `// comments`, unquoted keys, trailing commas — or a bare bucket name.
 * JSON.parse alone fails on ALL of those, so: strict → comment-strip +
 * quote-keys → per-key regex salvage.
 */
function looseParseObject(raw: string): any | null {
  const brace = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const body = brace >= 0 && end > brace ? raw.slice(brace, end + 1) : raw
  try { return JSON.parse(body) } catch {}
  const noComments = body.replace(/^\s*\/\/.*$/gm, '')
  const quoted = noComments.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1')
  try { return JSON.parse(quoted) } catch {}
  // last resort: salvage individual "key: "value"" pairs (with or without quotes on the key)
  const salvage: any = {}
  const pairRe = /([A-Za-z_$][\w$]*)\s*[:=]\s*["']([^"']*)["']/g
  let m: RegExpExecArray | null
  while ((m = pairRe.exec(noComments))) salvage[m[1]] = m[2]
  return salvage.storageBucket || salvage.projectId ? salvage : null
}

/**
 * Accepts, in order of likelihood from a phone user:
 *   1. the whole firebaseConfig JS/JSON blob he copied from Firebase Console
 *   2. a bare bucket name ("x.firebasestorage.app" / "x.appspot.com")
 *   3. a gs:// bucket URL
 */
export function parseFirebaseConfig(raw: string): FbParsedConfig | { error: string } {
  const text = String(raw || '').trim()
  if (!text) return { error: 'Paste the firebaseConfig block from Firebase Console (Project settings → General)' }
  const obj = looseParseObject(text)
  let bucket = String(obj?.storageBucket || '').trim()
  const projectId = String(obj?.projectId || '').trim()
  if (!bucket) {
    // bare bucket / gs:// form
    const t = text.replace(/^gs:\/\//, '').split(/[\s"']/)[0].trim()
    if (/^[a-z0-9][a-z0-9._-]*\.(firebasestorage\.app|appspot\.com)$/i.test(t)) bucket = t
  }
  bucket = bucket.replace(/^gs:\/\//, '').trim()
  if (!bucket) return { error: 'No storageBucket found — copy the WHOLE firebaseConfig block (it contains storageBucket)' }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(bucket)) return { error: `storageBucket "${bucket}" does not look like a bucket name` }
  return { bucket, projectId }
}

export interface ServiceAccount { client_email: string; private_key: string; project_id: string }

/** Validate + normalize a pasted/downloaded service-account JSON. */
export function parseServiceAccount(raw: string): ServiceAccount | { error: string } {
  const text = String(raw || '').trim()
  if (!text) return { error: 'Paste the service-account JSON (or pick the downloaded file)' }
  const brace = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const body = brace >= 0 && end > brace ? text.slice(brace, end + 1) : text
  try {
    const obj = JSON.parse(body)
    if (!obj?.client_email || !obj?.private_key) {
      return { error: 'This JSON is missing client_email / private_key — make sure it is the SERVICE ACCOUNT private key (Firebase Console → Project settings → Service accounts → Generate new private key), not the web firebaseConfig' }
    }
    if (!String(obj.private_key).includes('PRIVATE KEY')) {
      return { error: 'private_key does not look like a PEM key — re-download the JSON from Firebase Console' }
    }
    return {
      client_email: String(obj.client_email),
      private_key: String(obj.private_key),
      project_id: String(obj.project_id || ''),
    }
  } catch {
    return { error: 'Not valid JSON — paste the full service-account file contents' }
  }
}

/* ------------------------------- connection ------------------------------ */

async function loadSa(): Promise<ServiceAccount | null> {
  const enc = await getSetting(S.saEnc)
  if (!enc) return null
  try {
    const obj = JSON.parse(decrypt(enc))
    if (obj?.client_email && obj?.private_key) return obj as ServiceAccount
  } catch {}
  return null
}

export async function getFbStatusInput() {
  const [bucket, projectId, enabled, auto, lastBackupAt, lastBackupNote] = await Promise.all([
    getSetting(S.bucket), getSetting(S.projectId), getSetting(S.enabled), getSetting(S.auto),
    getSetting(S.lastBackupAt), getSetting(S.lastBackupNote),
  ])
  const sa = await loadSa()
  return {
    bucket: bucket || '',
    projectId: projectId || '',
    enabled: enabled !== '0', // default ON once connected
    auto: auto === '1',
    lastBackupAt: lastBackupAt || null,
    lastBackupNote: lastBackupNote || null,
    connected: Boolean(bucket && sa),
    serviceAccountEmail: sa?.client_email || null,
  }
}

export async function saveFirebaseConfig(raw: string) {
  const parsed = parseFirebaseConfig(raw)
  if ('error' in parsed) return parsed
  await setSetting(S.bucket, parsed.bucket)
  if (parsed.projectId) await setSetting(S.projectId, parsed.projectId)
  return parsed
}

export async function saveServiceAccount(raw: string) {
  const parsed = parseServiceAccount(raw)
  if ('error' in parsed) return parsed
  await setSetting(S.saEnc, encrypt(JSON.stringify(parsed)))
  return parsed
}

export async function disconnectFbStore() {
  await clearSettings([S.saEnc, S.bucket, S.projectId, S.enabled, S.auto, S.lastBackupAt, S.lastBackupNote])
  cachedTok = null
}

export async function setFbEnabled(on: boolean) { await setSetting(S.enabled, on ? '1' : '0') }
export async function setFbAuto(on: boolean) { await setSetting(S.auto, on ? '1' : '0') }

/* ------------------------------ auth (JWT) ------------------------------- */

let cachedTok: { tok: string; exp: number } | null = null

function b64uUrl(input: string) { return Buffer.from(input, 'utf8').toString('base64url') }

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedTok && cachedTok.exp > Date.now() + 60_000) return cachedTok.tok
  const now = Math.floor(Date.now() / 1000)
  const header = b64uUrl(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64uUrl(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.full_control',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const input = `${header}.${claims}`
  let assertion: string
  try {
    assertion = `${input}.${crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key, 'base64url')}`
  } catch (e: any) {
    throw new Error(`service-account private key unreadable: ${e?.message || e}`)
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  })
  const j: any = await res.json().catch(() => null)
  if (!res.ok || !j?.access_token) {
    throw new Error(j?.error_description || j?.error || `Firebase auth failed (HTTP ${res.status})`)
  }
  cachedTok = { tok: String(j.access_token), exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  return cachedTok.tok
}

/* --------------------------- Cloud Storage JSON API ---------------------- */

function gcsUrl(bucket: string, path = '', query = '') {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}${path}${query}`
}

/** Verify the vault: auth + bucket reachable. Returns bucket metadata. */
export async function fbTestConnection(): Promise<{ ok: true; bucket: string; timeZone?: string; location?: string } | { ok: false; error: string }> {
  const sa = await loadSa()
  const bucket = (await getSetting(S.bucket)) || ''
  if (!sa || !bucket) return { ok: false, error: 'not configured — save the Firebase config and service account first' }
  try {
    const tok = await getAccessToken(sa)
    const res = await fetch(gcsUrl(bucket), {
      headers: { authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 404) return { ok: false, error: `bucket "${bucket}" does not exist yet — Firebase Storage is not ACTIVATED on your project. One-time 30-second fix: Firebase Console → left menu Build → Storage → Get started → Next → Done (free Spark plan, no card needed). Then tap Back up now here` }
    if (res.status === 403 || res.status === 401) {
      return { ok: false, error: 'permission denied — in Google Cloud Console give this service account the Editor role (or Storage Object Admin) on the project' }
    }
    if (!res.ok) return { ok: false, error: `bucket check failed (HTTP ${res.status})` }
    const j: any = await res.json().catch(() => null)
    return { ok: true, bucket, location: j?.location, timeZone: j?.timeZone }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/** Resumable upload (one init POST + one PUT) — same shape as the Drive lib. */
export async function fbUploadObject(name: string, buf: Buffer, mime = 'application/json'): Promise<{ name: string; sizeKb: number }> {
  const sa = await loadSa()
  const bucket = (await getSetting(S.bucket)) || ''
  if (!sa || !bucket) throw new Error('Firebase vault is not connected')
  const tok = await getAccessToken(sa)
  const init = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=resumable&name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tok}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mime,
        'x-upload-content-length': String(buf.length),
      },
      body: JSON.stringify({ name, contentType: mime }),
      signal: AbortSignal.timeout(30000),
    },
  )
  const sessionUrl = init.headers.get('location')
  if (!init.ok || !sessionUrl) {
    const t = await init.text().catch(() => '')
    const hint = init.status === 403 ? ' — give the service account Editor (or Storage Object Admin) on the project' : ''
    throw new Error(`vault upload init failed (HTTP ${init.status})${hint} ${t.slice(0, 160)}`)
  }
  const put = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'content-length': String(buf.length) },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(300_000),
  })
  const j: any = await put.json().catch(() => null)
  if (!put.ok) throw new Error(`vault upload failed (HTTP ${put.status}) ${j?.error?.message || ''}`.trim())
  return { name: String(j?.name || name), sizeKb: Math.round(buf.length / 1024) }
}

export interface FbBackupInfo { name: string; sizeKb: number; updated: string; exportedAt: string | null }

/** List the restore points under the backup prefix (newest first). */
export async function fbListBackups(): Promise<{ items: FbBackupInfo[]; usedKb: number }> {
  const sa = await loadSa()
  const bucket = (await getSetting(S.bucket)) || ''
  if (!sa || !bucket) throw new Error('Firebase vault is not connected')
  const tok = await getAccessToken(sa)
  const items: FbBackupInfo[] = []
  let pageToken = ''
  let usedKb = 0
  do {
    const q = new URLSearchParams({ prefix: FB_BACKUP_PREFIX, maxResults: '100', fields: 'items(name,size,updated),nextPageToken' })
    if (pageToken) q.set('pageToken', pageToken)
    const res = await fetch(gcsUrl(bucket, '/o', `?${q.toString()}`), {
      headers: { authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(25000),
    })
    const j: any = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 404) throw new Error(`bucket "${bucket}" does not exist yet — Firebase Console → Build → Storage → Get started (free Spark plan) activates it; then Back up now here`)
      if (res.status === 403 || res.status === 401) throw new Error('permission denied — the service account needs Editor (or Storage Object Admin) on the project')
      throw new Error(j?.error?.message || `vault list failed (HTTP ${res.status})`)
    }
    for (const it of j?.items || []) {
      const sizeKb = Math.round(Number(it.size || 0) / 1024)
      usedKb += sizeKb
      // GCS object metadata carries the creation/update time — that IS the
      // backup time (no need to re-parse it out of the object name).
      const ts = Date.parse(String(it.updated || ''))
      items.push({ name: String(it.name), sizeKb, updated: String(it.updated || ''), exportedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null })
    }
    pageToken = String(j?.nextPageToken || '')
  } while (pageToken && items.length < 300)
  items.sort((a, b) => (a.updated < b.updated ? 1 : -1))
  return { items, usedKb }
}

/** v91 — every readable/writable object must live under one of the vault prefixes. */
function assertVaultObject(name: string) {
  const ok = name.startsWith(FB_BACKUP_PREFIX) || name.startsWith(FB_ARTIFACT_PREFIX) || name.startsWith(FB_SOURCE_PREFIX)
  if (!ok || name.includes('..')) throw new Error('invalid object name')
}

/** Download one vault object into memory (backup / artifact / source export). */
export async function fbDownloadObject(name: string): Promise<Buffer> {
  const sa = await loadSa()
  const bucket = (await getSetting(S.bucket)) || ''
  if (!sa || !bucket) throw new Error('Firebase vault is not connected')
  assertVaultObject(name)
  const tok = await getAccessToken(sa)
  const res = await fetch(gcsUrl(bucket, `/o/${encodeURIComponent(name)}`, '?alt=media'), {
    headers: { authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`vault download failed (HTTP ${res.status}) ${t.slice(0, 160)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 32) throw new Error('vault download came back empty')
  return buf
}

export async function fbDeleteObject(name: string): Promise<void> {
  const sa = await loadSa()
  const bucket = (await getSetting(S.bucket)) || ''
  if (!sa || !bucket) throw new Error('Firebase vault is not connected')
  assertVaultObject(name)
  const tok = await getAccessToken(sa)
  const res = await fetch(gcsUrl(bucket, `/o/${encodeURIComponent(name)}`), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`vault delete failed (HTTP ${res.status})`)
  }
}

/* --------------------------- backup / restore ---------------------------- */

export interface VaultBackupResult { ok: true; object: string; sizeKb: number; counts: any; durationMs: number }

/** Compose the standard backup payload and push it to the vault. */
export async function runVaultBackup(trigger: 'manual' | 'auto' = 'manual'): Promise<VaultBackupResult> {
  const started = Date.now()
  const { backup } = await buildBackupPayload()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') // safe in object names
  const object = `${FB_BACKUP_PREFIX}ca-backup-${stamp}.json`
  const buf = Buffer.from(JSON.stringify(backup), 'utf8')
  if (buf.length > 400 * 1024 * 1024) throw new Error('backup payload too large for the vault (>400 MB)')
  await fbUploadObject(object, buf, 'application/json')
  const note = `${trigger} · ${backup.counts.projects} projects · ${backup.counts.files} files`
  await setSetting(S.lastBackupAt, new Date().toISOString())
  await setSetting(S.lastBackupNote, note)
  return { ok: true, object, sizeKb: Math.round(buf.length / 1024), counts: backup.counts, durationMs: Date.now() - started }
}

/** Pull one restore point from the vault and run the additive restore. */
export async function restoreFromVault(object: string) {
  const raw = await fbDownloadObject(object)
  let backup: any
  try { backup = JSON.parse(raw.toString('utf8')) } catch { throw new Error('vault object is not valid JSON — wrong file?') }
  if (backup?.kind !== 'cloud-agent-backup' || !backup?.data) throw new Error('not a Cloud Agent backup object')
  return restoreBackupPayload(backup)
}

/* ------------------------------ auto loop -------------------------------- */

declare global {
  var __caFbAutoLoop: NodeJS.Timeout | null | undefined
}

async function autoBackupTick() {
  try {
    const st = await getFbStatusInput()
    if (!st.connected || !st.enabled || !st.auto) return
    if (st.lastBackupAt && Date.now() - Date.parse(st.lastBackupAt) < AUTO_MAX_AGE_MS) return
    if (localFreeMb() < AUTO_MIN_FREE_MB) return
    await runVaultBackup('auto')
  } catch (e: any) {
    console.error('[fbstore] auto backup skipped:', e?.message || e)
  }
}

/** Start the daily-vault-check loop once per server process. */
export function ensureFbAutoLoop() {
  if (globalThis.__caFbAutoLoop !== undefined) return
  // first check shortly after boot / first status open, then every 6 h
  const first = setTimeout(autoBackupTick, 45_000)
  first.unref?.()
  const timer = setInterval(autoBackupTick, AUTO_TICK_MS)
  timer.unref?.()
  globalThis.__caFbAutoLoop = timer
}

/* Disk helper re-exported for route honesty checks. */
export function vaultLocalFreeMb() { return localFreeMb() }

/* ------------------------ v91: publish artifact hook --------------------- */

export interface VaultArtifactResult { uploaded: boolean; object?: string; sizeKb?: number; removedLocal?: boolean; note?: string }

export interface FbStatusInput {
  bucket: string
  projectId: string
  enabled: boolean
  auto: boolean
  lastBackupAt: string | null
  lastBackupNote: string | null
  connected: boolean
  serviceAccountEmail: string | null
}

/**
 * v91 — the ONLY cloud overflow for published artifacts now (Google Drive was
 * removed at the owner's request: "google drive er system ta muse din,
 * shorashori firebase r storage e shob joma hobe").
 *
 * Policy: vault connected + enabled → EVERY published artifact is uploaded to
 * Firebase Storage under publish-artifacts/. The local copy is dropped only
 * when disk is critical (the artifact stays downloadable either way —
 * GET /api/publish?id= streams from the vault when the local file is gone).
 * Any failure is reported in `note` and NEVER fails the publish itself.
 */
export async function maybeUploadArtifactToVault(buildId: string, artifactPath: string): Promise<VaultArtifactResult> {
  try {
    const st = await getFbStatusInput()
    if (!st.connected) return { uploaded: false, note: 'Firebase vault not connected — artifact stays on local disk only' }
    if (!st.enabled) return { uploaded: false, note: 'Firebase vault is switched OFF — artifact stays on local disk only' }
    if (!fsExists(artifactPath)) return { uploaded: false }
    const buf = await fsRead(artifactPath)
    if (buf.length < 1024) return { uploaded: false } // never sync junk
    const base = artifactPath.split('/').pop() || 'artifact.bin'
    const object = `${FB_ARTIFACT_PREFIX}${buildId}-${base}`
    const up = await fbUploadObject(object, buf, 'application/octet-stream')
    let removedLocal = false
    let note: string | undefined
    const after = localFreeMb()
    if (after < CRITICAL_DISK_MB) {
      try { fsUnlink(artifactPath); removedLocal = true; note = `local copy removed (disk critical, ${after} MB free) — artifact lives in Firebase Storage` } catch { /* keep local copy */ }
    }
    // best-effort marker in build logs (drives the GET fallback)
    try {
      const b = await db.build.findUnique({ where: { id: buildId }, select: { logs: true } })
      await db.build.update({ where: { id: buildId }, data: { logs: (b?.logs || '') + `\n[vault] object=${object} sizeKb=${up.sizeKb}${removedLocal ? ' localCopy=removed' : ''}` } })
    } catch { /* the caller still gets the object name */ }
    return { uploaded: true, object, sizeKb: up.sizeKb, removedLocal, note }
  } catch (e: any) {
    return { uploaded: false, note: `Firebase Storage upload skipped: ${e?.message || e}` }
  }
}

/* tiny fs wrappers so the hook above stays test-friendly */
function fsExists(p: string) { return fs.existsSync(p) }
function fsRead(p: string): Promise<Buffer> { return fs.promises.readFile(p) }
function fsUnlink(p: string) { fs.unlinkSync(p) }
