/**
 * v53 — Provider Vault: disk-backed survival for AI provider keys.
 *
 * WHY: this platform's environment resets have repeatedly wiped the database
 * (Tasks 50, 51 worklog) while workspace files / .env / git survived every
 * single time. The user's real ModelScope key was lost twice that way. The
 * fix is a write-through mirror: every provider mutation is also written to
 * a small JSON file under <cwd>/data/, and when the DB is ever found empty
 * the vault silently re-seeds it.
 *
 * Threat model covered:
 *  - DB wiped, files intact  → restoreIfEmpty() reseeds rows verbatim.
 *  - Key deleted by the user → syncVault() removes it from the file too
 *    (delete is a real delete; the vault never resurrects user deletions).
 *
 * Security: apiKeyEnc is stored as AES-256-GCM ciphertext (see lib/crypto).
 * The vault file never contains plaintext keys, and data/ is gitignored.
 *
 * Failure policy: the vault is best-effort. Any vault error is logged and
 * swallowed — a broken vault must never break the providers API itself.
 */
import fs from 'fs'
import path from 'path'

const VAULT_DIR = path.join(process.cwd(), 'data')
const VAULT_PATH = path.join(VAULT_DIR, 'provider-vault.json')
const VAULT_VERSION = 1

/** Rows mirrored into the vault — a faithful copy of the AIProvider columns. */
export type VaultProvider = {
  id: string
  name: string
  kind: string
  endpoint: string | null
  apiKeyEnc: string | null
  model: string
  systemPrompt: string | null
  temperature: number
  maxTokens: number | null
  isDefault: boolean
  role: string
  category: string | null
  tag: string | null
  workspaceId: string | null
}

type VaultFile = {
  version: number
  savedAt: string
  providers: VaultProvider[]
}

function readVaultFile(): VaultFile | null {
  try {
    if (!fs.existsSync(VAULT_PATH)) return null
    const raw = fs.readFileSync(VAULT_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== VAULT_VERSION || !Array.isArray(parsed.providers)) return null
    return parsed as VaultFile
  } catch {
    return null
  }
}

function writeVaultFile(vf: VaultFile): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true })
  // Atomic write: tmp file + rename, so a crash mid-write can't corrupt the vault.
  const tmp = VAULT_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(vf, null, 2), 'utf8')
  fs.renameSync(tmp, VAULT_PATH)
}

/**
 * Mirror the full current DB provider table into the vault file.
 * Called after EVERY provider mutation (create / update / delete).
 */
export async function syncVault(): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db')
    const rows = await db.aIProvider.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, kind: true, endpoint: true, apiKeyEnc: true,
        model: true, systemPrompt: true, temperature: true, maxTokens: true,
        isDefault: true, role: true, category: true, tag: true, workspaceId: true,
      },
    })
    const vf: VaultFile = {
      version: VAULT_VERSION,
      savedAt: new Date().toISOString(),
      providers: rows as VaultProvider[],
    }
    writeVaultFile(vf)
    return true
  } catch (e) {
    console.warn('[provider-vault] syncVault failed:', (e as Error)?.message)
    return false
  }
}

let restoreInFlight: Promise<number> | null = null

/**
 * If the provider table is EMPTY but the vault still holds providers
 * (i.e. a platform reset wiped the DB), re-seed the table from the vault.
 * Returns how many rows were restored (0 = nothing to do).
 *
 * Guarded by an in-flight promise so parallel requests can't double-seed.
 */
export async function restoreIfEmpty(): Promise<number> {
  if (restoreInFlight) return restoreInFlight
  restoreInFlight = (async () => {
    try {
      const { db } = await import('@/lib/db')
      const count = await db.aIProvider.count()
      if (count > 0) return 0
      const vf = readVaultFile()
      if (!vf || vf.providers.length === 0) return 0

      // Drop workspace references that no longer exist (FK would reject them).
      let liveWorkspaceIds: Set<string> | null = null
      try {
        const ws = await db.workspace.findMany({ select: { id: true } })
        liveWorkspaceIds = new Set(ws.map(w => w.id))
      } catch {}

      let restored = 0
      for (const p of vf.providers) {
        try {
          await db.aIProvider.create({
            data: {
              id: p.id,
              name: p.name,
              kind: p.kind,
              endpoint: p.endpoint,
              apiKeyEnc: p.apiKeyEnc,
              model: p.model,
              systemPrompt: p.systemPrompt,
              temperature: p.temperature ?? 0.7,
              maxTokens: p.maxTokens,
              isDefault: !!p.isDefault,
              role: p.role || 'work',
              category: p.category,
              tag: p.tag,
              workspaceId: p.workspaceId && liveWorkspaceIds?.has(p.workspaceId) ? p.workspaceId : null,
            },
          })
          restored++
        } catch (e) {
          // A single bad row must not block the rest of the rescue.
          console.warn('[provider-vault] restore row failed:', (e as Error)?.message)
        }
      }
      if (restored > 0) {
        console.log(`[provider-vault] DB was empty — restored ${restored} provider(s) from vault`)
      }
      return restored
    } catch (e) {
      console.warn('[provider-vault] restoreIfEmpty failed:', (e as Error)?.message)
      return 0
    } finally {
      restoreInFlight = null
    }
  })()
  return restoreInFlight
}

/** E2E/testing helper: read the vault's current contents without decrypting. */
export function peekVault(): { exists: boolean; savedAt?: string; count?: number; ids?: string[] } {
  const vf = readVaultFile()
  if (!vf) return { exists: false }
  return { exists: true, savedAt: vf.savedAt, count: vf.providers.length, ids: vf.providers.map(p => p.id) }
}
