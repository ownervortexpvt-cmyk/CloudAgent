/**
 * v95 — Cloud Vault on Cloudflare R2 (the owner's choice: "Amarto budget nei,
 * R2 te storage er price kom ase" + "firebase R2 bad diye").
 *
 * WHY R2: free tier 10 GB storage/month + ZERO egress fees (Firebase/GCS
 * charges for downloads; R2 never does) — S3-compatible REST API.
 *
 * Implementation — NO new npm deps, NO aws-sdk (disk discipline):
 *   Auth  — AWS Signature Version 4 (SigV4) computed with node:crypto
 *           HMAC-SHA256. R2 accepts SigV4 with region "auto", service "s3",
 *           endpoint https://<account_id>.r2.cloudflarestorage.com.
 *   API   — plain S3 REST: PUT object, GET object, DELETE object,
 *           ListObjectsV2 (GET ?list-type=2), HEAD bucket for the verify.
 *   Store — the R2 secret access key is AES-256-GCM encrypted at rest
 *           (lib/crypto.ts, the same strong tier as GitHub PATs / Firebase SA).
 *
 * Honest scope (identical to the Firebase vault):
 *   • Backup payload = the same JSON /api/backup produces (projects, files,
 *     runs, provider CONFIGS, non-security settings). API keys, GitHub
 *     tokens and lock secrets NEVER travel.
 *   • R2 does NOT grow the fixed 9.9 GB sandbox disk — it is a restore-point
 *     + artifact vault the owner controls from Cloudflare's dashboard.
 */
import crypto from 'crypto'
import fs from 'fs'
import { db } from './db'
import { encrypt, decrypt } from './crypto'
import { buildBackupPayload, restoreBackupPayload } from './backup-core'
import { localFreeMb, CRITICAL_DISK_MB } from './disk'
import { sigv4Sign, sha256hex, type Sigv4Creds } from './sigv4'

const S = {
  accountId: 'r2store.accountId',
  accessKeyId: 'r2store.accessKeyId',
  secretEnc: 'r2store.secretEnc',
  bucket: 'r2store.bucket',
  endpoint: 'r2store.endpoint', // v160: custom S3-compatible endpoint (JOY SERVICE etc.) — overrides the R2-derived one when set
  region: 'r2store.region', // v161: SigV4 region override ('default' for Joy/Ceph, 'auto' for R2)
  enabled: 'r2store.enabled',
  auto: 'r2store.auto',
  lastBackupAt: 'r2store.lastBackupAt',
  lastBackupNote: 'r2store.lastBackupNote',
}

export const R2_BACKUP_PREFIX = 'cloud-agent-backups/'
export const R2_ARTIFACT_PREFIX = 'publish-artifacts/'
export const R2_SOURCE_PREFIX = 'source-exports/'
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

/* ---------------------------- config handling ---------------------------- */

export interface R2ParsedConfig { accountId: string; bucket: string }

/**
 * Accepts the three values from Cloudflare dashboard (R2 → Manage API tokens /
 * Overview), one per line or key: value form — phone-friendly:
 *   Account ID: 32-hex
 *   Bucket: whatever the owner created ("cloud-agent")
 * Also tolerates a pasted endpoint URL containing the account id.
 */
export function parseR2Config(raw: string): R2ParsedConfig | { error: string } {
  const text = String(raw || '').trim()
  if (!text) return { error: 'Paste the Account ID and bucket name (Cloudflare dashboard → R2 → Overview)' }
  const salvage: any = {}
  // key: value pairs
  const pairRe = /([A-Za-z_ -][\w -]*)\s*[:=]\s*["']?([\w./-]+)["']?/g
  let m: RegExpExecArray | null
  while ((m = pairRe.exec(text))) salvage[m[1].trim().toLowerCase().replace(/[\s_-]+/g, '')] = m[2]
  // bare 32-hex account id anywhere
  let accountId = salvage.accountid || ''
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    const bare = text.match(/\b[a-f0-9]{32}\b/i)
    if (bare) accountId = bare[0]
  }
  // endpoint URL form: https://<accid>.r2.cloudflarestorage.com
  const ep = text.match(/([a-f0-9]{32})\.r2\.cloudflarestorage\.com/i)
  if (!accountId && ep) accountId = ep[1]
  // bucket: named pair first; else, when a URL is present, any remaining
  // bare token that looks like a bucket name (phone paste "URL my-bucket")
  let bucket = salvage.bucket || salvage.bucketname || ''
  if (!bucket && ep) {
    const rest = text.replace(/[a-f0-9]{32}\.r2\.cloudflarestorage\.com[^\s]*/gi, ' ')
      .replace(/https?:\/\//gi, ' ')
    const token = rest.split(/[\s,;]+/).map(t => t.replace(/^["':=,]+|["':=,]+$/g, '')).find(t => /^[a-z0-9][a-z0-9._-]{2,62}$/i.test(t) && !/^(account|bucket|id|r2)$/i.test(t) && !/^[a-f0-9]{32}$/i.test(t))
    if (token) bucket = token
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return { error: 'Account ID not found — it is the 32-character hex under Cloudflare dashboard → R2 → Overview → Account details' }
  if (!bucket || !/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket)) return { error: 'Bucket name not found — create one in Cloudflare dashboard → R2 → Create bucket (e.g. cloud-agent), then paste its name here' }
  return { accountId, bucket }
}

export interface R2StatusInput {
  accountId: string
  bucket: string
  endpoint: string
  region: string
  enabled: boolean
  auto: boolean
  lastBackupAt: string | null
  lastBackupNote: string | null
  connected: boolean
}

async function loadCreds(): Promise<Sigv4Creds | null> {
  const [id, enc] = await Promise.all([getSetting(S.accessKeyId), getSetting(S.secretEnc)])
  if (!id || !enc) return null
  try {
    const secret = decrypt(enc)
    if (secret) return { accessKeyId: id, secretAccessKey: secret }
  } catch {}
  return null
}

export async function getR2StatusInput(): Promise<R2StatusInput> {
  const [accountId, bucket, enabled, auto, lastBackupAt, lastBackupNote, endpoint, region] = await Promise.all([
    getSetting(S.accountId), getSetting(S.bucket), getSetting(S.enabled), getSetting(S.auto),
    getSetting(S.lastBackupAt), getSetting(S.lastBackupNote),
    getSetting(S.endpoint),
    getSetting(S.region),
  ])
  const creds = await loadCreds()
  return {
    accountId: accountId || '',
    bucket: bucket || '',
    endpoint: endpoint || '',
    region: region || '',
    enabled: enabled !== '0', // default ON once connected
    auto: auto === '1',
    lastBackupAt: lastBackupAt || null,
    lastBackupNote: lastBackupNote || null,
    connected: Boolean(creds && bucket && (accountId || endpoint)),
  }
}

export async function saveR2Config(raw: string) {
  const parsed = parseR2Config(raw)
  if ('error' in parsed) return parsed
  await setSetting(S.accountId, parsed.accountId)
  await setSetting(S.bucket, parsed.bucket)
  // v160 — custom S3-compatible endpoint support (JOY SERVICE, Wasabi, DO
  // Spaces, MinIO …): a pasted https:// endpoint that is NOT a Cloudflare R2
  // URL is stored as the vault endpoint and used for signing + requests.
  const custom = String(raw || '').match(/https:\/\/[a-z0-9.-]+(?:\:\d+)?(?:\/[^\s]*)?/i)
  if (custom && !/r2\.cloudflarestorage\.com/i.test(custom[0])) {
    await setSetting(S.endpoint, custom[0].replace(/\/$/, ''))
  }
  return parsed
}

/** v160 — set/clear a custom S3-compatible endpoint directly. */
export async function saveVaultEndpoint(raw: string) {
  const url = String(raw || '').trim().replace(/\/$/, '')
  if (!url) { await setSetting(S.endpoint, ''); return { ok: true, endpoint: '' } }
  if (!/^https:\/\//i.test(url)) return { error: 'endpoint must start with https://' }
  await setSetting(S.endpoint, url)
  return { ok: true, endpoint: url }
}

/** Validate + store the S3 API token (Access Key ID + Secret Access Key). */
export async function saveR2Keys(raw: string): Promise<{ accessKeyId: string } | { error: string }> {
  const text = String(raw || '').trim()
  if (!text) return { error: 'Paste the Access Key ID and Secret Access Key (Cloudflare dashboard → R2 → Manage API tokens → Create API token)' }
  let accessKeyId = ''
  let secretAccessKey = ''
  const pairRe = /access\s*key\s*id\s*[:=]\s*["']?([\w-]+)["']?\s*(?:,|\n|$)\s*(?:secret\s*access\s*key\s*[:=]\s*["']?([\w/+=-]+)["']?)?/i
  const m = text.match(pairRe)
  if (m) {
    accessKeyId = m[1] || ''
    secretAccessKey = m[2] || ''
  }
  if (!accessKeyId || !secretAccessKey) {
    // two non-empty lines: first = key id (starts with a word), second = secret
    const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
    const json = (() => { try { return JSON.parse(text) } catch { return null } })()
    if (json && typeof json === 'object') {
      accessKeyId = String(json.accessKeyId || json.AccessKeyId || json.access_key_id || '')
      secretAccessKey = String(json.secretAccessKey || json.SecretAccessKey || json.secret_access_key || '')
    } else if (lines.length >= 2) {
      accessKeyId = lines[0]
      secretAccessKey = lines[1]
    }
  }
  accessKeyId = accessKeyId.trim()
  secretAccessKey = secretAccessKey.trim()
  if (!accessKeyId || !secretAccessKey) return { error: 'Both values needed: the Access Key ID and the Secret Access Key (token shows it ONLY once when created)' }
  if (/\s/.test(accessKeyId) || /\s/.test(secretAccessKey)) return { error: 'Keys must not contain spaces — copy each value separately' }
  await setSetting(S.accessKeyId, accessKeyId)
  await setSetting(S.secretEnc, encrypt(secretAccessKey))
  return { accessKeyId }
}

export async function disconnectR2Store() {
  await clearSettings([S.accountId, S.accessKeyId, S.secretEnc, S.bucket, S.endpoint, S.region, S.enabled, S.auto, S.lastBackupAt, S.lastBackupNote])
}

export async function setR2Enabled(on: boolean) { await setSetting(S.enabled, on ? '1' : '0') }
export async function setR2Auto(on: boolean) { await setSetting(S.auto, on ? '1' : '0') }

/* ------------------------------ S3 REST calls ---------------------------- */

function r2Endpoint(accountId: string, customEndpoint?: string) {
  if (customEndpoint) return customEndpoint // v160: any S3-compatible provider
  return `https://${accountId}.r2.cloudflarestorage.com`
}

/** Host + origin used for sigv4 signing and the request URL (v160: custom endpoint aware). */
function resolveEndpoint(st: { accountId?: string; endpoint?: string }) {
  if (st.endpoint) {
    try {
      const u = new URL(st.endpoint)
      return { host: u.host, origin: st.endpoint.replace(/\/$/, '') }
    } catch { /* fall through to R2 */ }
  }
  return { host: `${st.accountId}.r2.cloudflarestorage.com`, origin: r2Endpoint(String(st.accountId || '')) }
}

async function r2Fetch(
  st: { accountId?: string; endpoint?: string },
  creds: Sigv4Creds,
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  pathForUri: string, // e.g. "/<bucket>" or "/<bucket>/<key...>"
  query: URLSearchParams,
  body: Buffer | null,
  mime = 'application/octet-stream',
  timeoutMs = 30000,
): Promise<Response> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const { host, origin } = resolveEndpoint(st)
  // v161 — SigV4 region: saved override → Joy/Ceph endpoints use 'default',
  // anything else (R2) stays 'auto'. Wrong region = SignatureDoesNotMatch.
  const region =
    (st as any).region ||
    (/joy\.services/i.test(st.endpoint || '') ? 'default' : 'auto')
  const { authorization } = sigv4Sign(method, pathForUri, query.toString(), host, body, creds, amzDate, region)
  const url = `${origin}${pathForUri}${query.toString() ? `?${query.toString()}` : ''}`
  const headers: Record<string, string> = {
    authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': sha256hex(body ?? ''),
  }
  if (body && method === 'PUT') headers['content-type'] = mime
  const res = await fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  return res
}

function friendlyError(status: number, bodyText: string): string {
  if (status === 404) return `bucket not found (HTTP 404) — create it first: Cloudflare dashboard → R2 → Create bucket`
  if (status === 401 || status === 403) return `permission denied (HTTP ${status}) — the API token needs Object Read & Write on the bucket, and the Account ID / keys must match`
  const code = (bodyText.match(/<Code>([^<]+)<\/Code>/) || [])[1]
  const msg = (bodyText.match(/<Message>([^<]+)<\/Message>/) || [])[1]
  return `R2 request failed (HTTP ${status})${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`
}

/** Verify the vault: creds + bucket reachable. */
export async function r2TestConnection(): Promise<{ ok: true; bucket: string; location?: string } | { ok: false; error: string }> {
  const st = await getR2StatusInput()
  const creds = await loadCreds()
  if (!creds || (!st.accountId && !st.endpoint) || !st.bucket) return { ok: false, error: 'not configured — save the bucket config and API keys first' }
  try {
    // ListObjectsV2 with max-keys=1 proves auth + bucket existence + read ACL
    const q = new URLSearchParams({ 'list-type': '2', 'max-keys': '1' })
    const res = await r2Fetch(st, creds, 'GET', `/${st.bucket}`, q, null, 'application/xml', 20000)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: friendlyError(res.status, t) }
    }
    return { ok: true, bucket: st.bucket }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/** PUT one object (simple single-shot; backups are ≤ hundreds of MB). */
export async function r2UploadObject(key: string, buf: Buffer, mime = 'application/json'): Promise<{ name: string; sizeKb: number }> {
  const st = await getR2StatusInput()
  const creds = await loadCreds()
  if (!creds || (!st.accountId && !st.endpoint) || !st.bucket) throw new Error('R2 vault is not connected')
  const res = await r2Fetch(st, creds, 'PUT', `/${st.bucket}/${key}`, new URLSearchParams(), buf, mime, 300_000)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(res.status, t))
  }
  return { name: key, sizeKb: Math.round(buf.length / 1024) }
}

export interface R2BackupInfo { name: string; sizeKb: number; updated: string; exportedAt: string | null }

/** List restore points under the backup prefix (newest first). */
export async function r2ListBackups(): Promise<{ items: R2BackupInfo[]; usedKb: number }> {
  const st = await getR2StatusInput()
  const creds = await loadCreds()
  if (!creds || (!st.accountId && !st.endpoint) || !st.bucket) throw new Error('R2 vault is not connected')
  const items: R2BackupInfo[] = []
  let usedKb = 0
  let continuation = ''
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix: R2_BACKUP_PREFIX, 'max-keys': '100' })
    if (continuation) q.set('continuation-token', continuation)
    const res = await r2Fetch(st, creds, 'GET', `/${st.bucket}`, q, null, 'application/xml', 25000)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(friendlyError(res.status, t))
    }
    const xml = await res.text()
    // minimal XML walk (no parser dep): <Contents>…<Key>..</Key><Size>..</Size><LastModified>..</LastModified>…
    for (const chunk of xml.split('<Contents>').slice(1)) {
      const key = (chunk.match(/<Key>([^<]+)<\/Key>/) || [])[1] || ''
      const size = Number((chunk.match(/<Size>([^<]+)<\/Size>/) || [])[1] || 0)
      const lm = (chunk.match(/<LastModified>([^<]+)<\/LastModified>/) || [])[1] || ''
      const sizeKb = Math.round(size / 1024)
      usedKb += sizeKb
      const ts = Date.parse(lm)
      items.push({ name: key, sizeKb, updated: lm, exportedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null })
    }
    continuation = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || ''
  } while (continuation && items.length < 300)
  items.sort((a, b) => (a.updated < b.updated ? 1 : -1))
  return { items, usedKb }
}

/** Every readable/writable object must live under one of the vault prefixes. */
function assertR2Object(name: string) {
  const ok = name.startsWith(R2_BACKUP_PREFIX) || name.startsWith(R2_ARTIFACT_PREFIX) || name.startsWith(R2_SOURCE_PREFIX)
  if (!ok || name.includes('..')) throw new Error('invalid object name')
}

/** Download one vault object into memory (backup / artifact / source export). */
export async function r2DownloadObject(name: string): Promise<Buffer> {
  const st = await getR2StatusInput()
  const creds = await loadCreds()
  if (!creds || (!st.accountId && !st.endpoint) || !st.bucket) throw new Error('R2 vault is not connected')
  assertR2Object(name)
  const res = await r2Fetch(st, creds, 'GET', `/${st.bucket}/${name}`, new URLSearchParams(), null, 'application/xml', 120_000)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(res.status, t))
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 32) throw new Error('vault download came back empty')
  return buf
}

export async function r2DeleteObject(name: string): Promise<void> {
  const st = await getR2StatusInput()
  const creds = await loadCreds()
  if (!creds || (!st.accountId && !st.endpoint) || !st.bucket) throw new Error('R2 vault is not connected')
  assertR2Object(name)
  const res = await r2Fetch(st, creds, 'DELETE', `/${st.bucket}/${name}`, new URLSearchParams(), null, 'application/xml', 30000)
  if (!res.ok && res.status !== 404) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(res.status, t))
  }
}

/* --------------------------- backup / restore ---------------------------- */

export interface R2BackupResult { ok: true; object: string; sizeKb: number; counts: any; durationMs: number }

/** Compose the standard backup payload and push it to R2. */
export async function runR2Backup(trigger: 'manual' | 'auto' = 'manual'): Promise<R2BackupResult> {
  const started = Date.now()
  const { backup } = await buildBackupPayload()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') // safe in object keys
  const object = `${R2_BACKUP_PREFIX}ca-backup-${stamp}.json`
  const buf = Buffer.from(JSON.stringify(backup), 'utf8')
  if (buf.length > 400 * 1024 * 1024) throw new Error('backup payload too large for the vault (>400 MB)')
  await r2UploadObject(object, buf, 'application/json')
  const note = `${trigger} · ${backup.counts.projects} projects · ${backup.counts.files} files`
  await setSetting(S.lastBackupAt, new Date().toISOString())
  await setSetting(S.lastBackupNote, note)
  return { ok: true, object, sizeKb: Math.round(buf.length / 1024), counts: backup.counts, durationMs: Date.now() - started }
}

/** Pull one restore point from R2 and run the additive restore. */
export async function restoreFromR2(object: string) {
  const raw = await r2DownloadObject(object)
  let backup: any
  try { backup = JSON.parse(raw.toString('utf8')) } catch { throw new Error('vault object is not valid JSON — wrong file?') }
  if (backup?.kind !== 'cloud-agent-backup' || !backup?.data) throw new Error('not a Cloud Agent backup object')
  return restoreBackupPayload(backup)
}

/* ------------------------------ auto loop -------------------------------- */

declare global {
  var __caR2AutoLoop: NodeJS.Timeout | null | undefined
}

async function autoBackupTick() {
  try {
    const st = await getR2StatusInput()
    if (!st.connected || !st.enabled || !st.auto) return
    if (st.lastBackupAt && Date.now() - Date.parse(st.lastBackupAt) < AUTO_MAX_AGE_MS) return
    if (localFreeMb() < AUTO_MIN_FREE_MB) return
    await runR2Backup('auto')
  } catch (e: any) {
    console.error('[r2store] auto backup skipped:', e?.message || e)
  }
}

/** Start the vault-check loop once per server process. */
export function ensureR2AutoLoop() {
  if (globalThis.__caR2AutoLoop !== undefined) return
  const first = setTimeout(autoBackupTick, 45_000)
  first.unref?.()
  const timer = setInterval(autoBackupTick, AUTO_TICK_MS)
  timer.unref?.()
  globalThis.__caR2AutoLoop = timer
}

/* Disk helper re-exported for route honesty checks. */
export function r2LocalFreeMb() { return localFreeMb() }

/* ---------------------- artifact hook (publish flow) --------------------- */

export interface R2ArtifactResult { uploaded: boolean; object?: string; sizeKb?: number; removedLocal?: boolean; note?: string }

/**
 * v95 — the FIRST-choice cloud overflow for published artifacts when the
 * owner's R2 vault is connected (his decision: budget — R2 is cheaper).
 * Same policy as the Firebase hook: never blocks a publish; local copy is
 * dropped only when disk is critical; the build log marker drives the
 * GET /api/publish download fallback (r2:<key> marker).
 */
export async function maybeUploadArtifactToR2(buildId: string, artifactPath: string): Promise<R2ArtifactResult> {
  try {
    const st = await getR2StatusInput()
    if (!st.connected) return { uploaded: false, note: 'R2 vault not connected — artifact stays on local disk only' }
    if (!st.enabled) return { uploaded: false, note: 'R2 vault is switched OFF — artifact stays on local disk only' }
    if (!fs.existsSync(artifactPath)) return { uploaded: false }
    const buf = await fs.promises.readFile(artifactPath)
    if (buf.length < 1024) return { uploaded: false } // never sync junk
    const base = artifactPath.split('/').pop() || 'artifact.bin'
    const object = `${R2_ARTIFACT_PREFIX}${buildId}-${base}`
    const up = await r2UploadObject(object, buf, 'application/octet-stream')
    let removedLocal = false
    let note: string | undefined
    const after = localFreeMb()
    if (after < CRITICAL_DISK_MB) {
      try { fs.unlinkSync(artifactPath); removedLocal = true; note = `local copy removed (disk critical, ${after} MB free) — artifact lives in Cloudflare R2` } catch { /* keep local copy */ }
    }
    try {
      const b = await db.build.findUnique({ where: { id: buildId }, select: { logs: true } })
      await db.build.update({ where: { id: buildId }, data: { logs: (b?.logs || '') + `\n[vault] object=r2:${object} sizeKb=${up.sizeKb}${removedLocal ? ' localCopy=removed' : ''}` } })
    } catch { /* the caller still gets the object name */ }
    return { uploaded: true, object, sizeKb: up.sizeKb, removedLocal, note }
  } catch (e: any) {
    return { uploaded: false, note: `R2 upload skipped: ${e?.message || e}` }
  }
}
