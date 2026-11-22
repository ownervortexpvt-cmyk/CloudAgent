/**
 * v81 — Google Play Store real upload via a service account.
 *
 * The operator's OWN service account (Google removed anonymous publish APIs
 * long ago). Pattern is identical to the Firebase vault lib (fbstore.ts):
 * credentials are pasted once into Cloud Agent, stored in UserSetting, and
 * never leave the sandbox.
 *
 * Setup (one-time, ~4 min):
 *   1. console.cloud.google.com → create project → enable "Google Play Android Developer API"
 *   2. IAM & Admin → Service Accounts → create → Keys → add JSON key (download)
 *   3. Google Cloud → OAuth consent screen not needed for service accounts.
 *   4. play.google.com/console → Users & permissions → invite the service
 *      account email (…@…iam.gserviceaccount.com) with "Release to production /
 *      testing tracks" permission.
 *   5. Paste the downloaded JSON into Cloud Agent (Publish → Google Play → Connect).
 *
 * Upload flow (androidpublisher v3, zero new deps — fetch + node:crypto):
 *   JWT RS256 → token → edits.insert → bundles.upload (media) →
 *   tracks.update (internal/closed/production) → edits.commit
 */

import crypto from 'crypto'
import fs from 'fs'
import { db } from '@/lib/db'

const SETTING_KEY = 'play_service_account_json'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'

export interface PlayStatus { configured: boolean; clientEmail: string | null; projectIdHint: string | null }

interface ServiceAccount { client_email?: string; private_key?: string; project_id?: string; [k: string]: unknown }

async function readAccount(): Promise<ServiceAccount | null> {
  try {
    const raw = (await db.userSetting.findUnique({ where: { key: SETTING_KEY } }))?.value
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

export async function playStatus(): Promise<PlayStatus> {
  const acc = await readAccount()
  return {
    configured: !!(acc?.client_email && acc?.private_key),
    clientEmail: acc?.client_email || null,
    projectIdHint: acc?.project_id || null,
  }
}

export async function savePlayCredentials(json: string): Promise<{ ok: boolean; error?: string; clientEmail?: string }> {
  let acc: ServiceAccount
  try { acc = JSON.parse(json) } catch { return { ok: false, error: 'not valid JSON — paste the downloaded service-account key file content' } }
  if (!acc.client_email || !acc.private_key) {
    return { ok: false, error: 'missing client_email or private_key — paste the FULL service-account JSON key' }
  }
  if (!String(acc.private_key).includes('BEGIN PRIVATE KEY')) {
    return { ok: false, error: 'private_key does not look like a PEM key — re-download the JSON key from Google Cloud' }
  }
  await db.userSetting.upsert({ where: { key: SETTING_KEY }, update: { value: json }, create: { key: SETTING_KEY, value: json } })
  return { ok: true, clientEmail: String(acc.client_email) }
}

export async function clearPlayCredentials(): Promise<void> {
  await db.userSetting.deleteMany({ where: { key: SETTING_KEY } })
}

/** JWT RS256 bearer token for androidpublisher. */
async function getAccessToken(): Promise<{ token: string } | { error: string }> {
  const acc = await readAccount()
  if (!acc?.client_email || !acc?.private_key) return { error: 'service account not configured' }
  const now = Math.floor(Date.now() / 1000)
  const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64u(JSON.stringify({
    iss: acc.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  let signed: string
  try {
    const signer = crypto.createSign('RSA-SHA256')
    signer.update(`${header}.${claims}`)
    signer.end()
    signed = signer.sign(String(acc.private_key), 'base64url')
  } catch (e: any) {
    return { error: `could not sign JWT with private_key: ${e?.message || e}` }
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signed}` }),
  })
  const data = await res.json().catch(() => ({} as any))
  if (!res.ok || !data.access_token) {
    return { error: `token exchange failed (${res.status}): ${data.error_description || data.error || 'unknown'}` }
  }
  return { token: data.access_token as string }
}

async function api(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  })
  const text = await res.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text.slice(0, 500) } }
  return { ok: res.ok, status: res.status, data }
}

export interface PlayUploadResult {
  ok: boolean
  error?: string
  hint?: string
  versionCode?: number
  editId?: string
  track?: string
}

/**
 * Upload an .aab and release it to a track (default: internal testing).
 * The AAB must already be built (publish target 'aab').
 */
export async function uploadAabToPlay(opts: {
  aabPath: string
  packageName: string
  track?: string
  releaseName?: string
}): Promise<PlayUploadResult> {
  const packageName = String(opts.packageName || '').trim()
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(packageName)) {
    return { ok: false, error: `invalid package name '${packageName}' — it must look like com.example.app (the applicationId in the AAB)` }
  }
  if (!fs.existsSync(opts.aabPath)) {
    return { ok: false, error: `AAB not found at ${opts.aabPath} — build the Android AAB target first` }
  }
  const sizeMb = Math.round(fs.statSync(opts.aabPath).size / 1048576)
  if (sizeMb < 1) return { ok: false, error: 'AAB file is suspiciously small (<1MB) — rebuild the AAB target' }

  const tok = await getAccessToken()
  if ('error' in tok) return { ok: false, error: tok.error }
  const token = tok.token

  // 1. open an edit
  const edit = await api(token, `/applications/${encodeURIComponent(packageName)}/edits`, { method: 'POST' })
  if (!edit.ok) {
    return {
      ok: false,
      error: `could not open a Play edit for '${packageName}' (${edit.status}): ${edit.data?.error?.message || 'unknown'}`,
      hint: edit.status === 404
        ? 'package not found — create the app in play.google.com/console first (package name must match exactly), and confirm the API is enabled'
        : edit.status === 401 || edit.status === 403
          ? 'the service account must be invited in Play Console → Users & permissions with release rights, and "Google Play Android Developer API" enabled in Google Cloud'
          : undefined,
    }
  }
  const editId = edit.data.id as string

  try {
    // 2. upload the bundle (simple media upload)
    const buf = fs.readFileSync(opts.aabPath)
    const upRes = await fetch(`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${editId}/bundles?uploadType=media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
      body: new Uint8Array(buf),
    })
    const upData = await upRes.json().catch(() => ({} as any))
    if (!upRes.ok) {
      return { ok: false, error: `AAB upload failed (${upRes.status}): ${upData?.error?.message || 'unknown'}`, hint: upRes.status === 403 ? 'check the service-account invite + API enablement' : undefined }
    }
    const versionCode = upData.versionCode as number | undefined

    // 3. assign to track
    const track = opts.track || 'internal'
    const rel: Record<string, unknown> = { versionCodes: versionCode ? [versionCode] : [] }
    if (opts.releaseName) rel.name = opts.releaseName
    if (track === 'production') rel.status = 'completed'
    const trRes = await api(token, `/applications/${encodeURIComponent(packageName)}/edits/${editId}/tracks/${encodeURIComponent(track)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track, releases: [rel] }),
    })
    if (!trRes.ok) {
      return { ok: false, error: `bundle uploaded (versionCode ${versionCode}) but track assignment failed (${trRes.status}): ${trRes.data?.error?.message || 'unknown'}` }
    }

    // 4. commit the edit
    const commit = await api(token, `/applications/${encodeURIComponent(packageName)}/edits/${editId}:commit`, { method: 'POST' })
    if (!commit.ok) {
      return { ok: false, error: `edit commit failed (${commit.status}): ${commit.data?.error?.message || 'unknown'}` }
    }
    return { ok: true, editId, versionCode, track }
  } catch (e: any) {
    return { ok: false, error: `upload failed: ${e?.message || e}` }
  }
}
