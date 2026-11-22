/**
 * v89 — backup/restore core, extracted verbatim from /api/backup.
 *
 * WHY: the Firebase Cloud Vault (src/lib/fbstore.ts) needs the SAME payload
 * builder for (a) manual "Back up now", (b) the daily auto-backup loop —
 * which runs on a timer with NO incoming request, so it cannot call the
 * lock-guarded route over HTTP. The route now delegates here; behavior is
 * byte-identical (security settings and provider API keys still never leave
 * the machine; restore stays additive & idempotent).
 */
import { db } from './db'

const SECURITY_SETTING_KEYS = /^(lock|recovery)/i

/** Scalar fields of a Project we carry in a backup (no relations). */
function projectScalars(p: {
  id: string
  name: string
  description: string | null
  framework: string | null
  language: string | null
  runtime: string | null
  entryPort: number | null
  status: string
  workspaceId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    framework: p.framework,
    language: p.language,
    runtime: p.runtime,
    entryPort: p.entryPort,
    status: p.status,
    workspaceId: p.workspaceId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

export async function buildBackupPayload(): Promise<{ backup: any; durationMs: number }> {
  const started = Date.now()
  const [projects, providers, userSettings] = await Promise.all([
    db.project.findMany({
      orderBy: { lastOpenedAt: 'desc' },
      include: {
        files: { orderBy: { path: 'asc' } },
        settings: true,
        envVars: true,
        agents: { orderBy: { createdAt: 'asc' } },
      },
    }),
    db.aIProvider.findMany({ orderBy: { createdAt: 'asc' } }),
    db.userSetting.findMany({ orderBy: { key: 'asc' } }),
  ])

  const strippedProviders = providers.map((p) => {
    // apiKeyEnc is deliberately DELETED here — the backup file must never
    // carry API keys, not even the encrypted form (defense in depth).
    const { apiKeyEnc, ...rest } = p
    return rest
  })
  const safeSettings = userSettings.filter((s) => !SECURITY_SETTING_KEYS.test(s.key))
  const skippedSecurity = userSettings.length - safeSettings.length

  const fileCount = projects.reduce((n, p) => n + p.files.length, 0)
  const runCount = projects.reduce((n, p) => n + p.agents.length, 0)

  const backup = {
    kind: 'cloud-agent-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    note:
      'API keys and GitHub tokens are NEVER exported (they stay on the machine that created them). ' +
      'Re-enter keys after restoring on a new device. Lock/security settings are not exported either.',
    counts: {
      projects: projects.length,
      files: fileCount,
      providers: strippedProviders.length,
      settings: safeSettings.length,
      skippedSecuritySettings: skippedSecurity,
      runs: runCount,
    },
    data: {
      projects: projects.map((p) => ({
        ...projectScalars(p),
        files: p.files.map((f) => ({ path: f.path, content: f.content, isDir: f.isDir, createdAt: f.createdAt, updatedAt: f.updatedAt })),
        settings: p.settings.map((s) => ({ key: s.key, value: s.value })),
        envVars: p.envVars.map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret, workspaceId: e.workspaceId })),
        runs: p.agents.map((r) => ({
          id: r.id,
          prompt: r.prompt,
          status: r.status,
          model: r.model,
          provider: r.provider,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          toolCalls: r.toolCalls,
          response: r.response,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      })),
      providers: strippedProviders,
      userSettings: safeSettings,
    },
    durationMs: Date.now() - started,
  }

  return { backup, durationMs: backup.durationMs }
}

/** Upsert one file row by (projectId, path); content from the backup wins. */
async function upsertFile(projectId: string, f: { path: string; content: string; isDir: boolean }) {
  const existing = await db.file.findUnique({ where: { projectId_path: { projectId, path: f.path } } })
  if (existing) {
    await db.file.update({ where: { id: existing.id }, data: { content: f.content, isDir: f.isDir } })
    return 'updated' as const
  }
  await db.file.create({ data: { projectId, path: f.path, content: f.content, isDir: f.isDir } })
  return 'created' as const
}

async function upsertEnvVar(projectId: string, e: { key: string; value: string; isSecret: boolean }, workspaceId: string | null) {
  const existing = await db.envVar.findUnique({ where: { projectId_key: { projectId, key: e.key } } })
  if (existing) {
    await db.envVar.update({ where: { id: existing.id }, data: { value: e.value, isSecret: e.isSecret } })
    return 'updated' as const
  }
  await db.envVar.create({ data: { projectId, key: e.key, value: e.value, isSecret: e.isSecret, workspaceId } })
  return 'created' as const
}

async function upsertProjectSetting(projectId: string, s: { key: string; value: string }) {
  const existing = await db.projectSetting.findUnique({ where: { projectId_key: { projectId, key: s.key } } })
  if (existing) {
    await db.projectSetting.update({ where: { id: existing.id }, data: { value: s.value } })
    return 'updated' as const
  }
  await db.projectSetting.create({ data: { projectId, key: s.key, value: String(s.value ?? '') } })
  return 'created' as const
}

export interface RestoreStats {
  projectsCreated: number
  projectsUpdated: number
  filesUpserted: number
  envVarsUpserted: number
  projectSettingsUpserted: number
  runsImported: number
  runsSkippedExisting: number
  providersUpdated: number
  providersCreated: number
  userSettingsUpserted: number
  securitySettingsSkipped: number
}

/**
 * Additive & idempotent restore — identical to the POST /api/backup contract.
 * Exported so the Cloud Vault can restore a downloaded backup without an
 * internal HTTP round-trip.
 */
export async function restoreBackupPayload(backup: any): Promise<{ ok: true; stats: RestoreStats; durationMs: number }> {
  const started = Date.now()
  const stats: RestoreStats = {
    projectsCreated: 0,
    projectsUpdated: 0,
    filesUpserted: 0,
    envVarsUpserted: 0,
    projectSettingsUpserted: 0,
    runsImported: 0,
    runsSkippedExisting: 0,
    providersUpdated: 0,
    providersCreated: 0,
    userSettingsUpserted: 0,
    securitySettingsSkipped: 0,
  }

  // Existing workspace ids (for sanitising dangling FK references)
  const workspaceIds = new Set((await db.workspace.findMany({ select: { id: true } })).map((w) => w.id))
  const sanitizeWs = (id: string | null | undefined) => (id && workspaceIds.has(id) ? id : null)

  /* ---- 1. User settings (never security keys) ---- */
  for (const s of backup.data.userSettings || []) {
    if (!s || typeof s.key !== 'string') continue
    if (SECURITY_SETTING_KEYS.test(s.key)) {
      stats.securitySettingsSkipped++
      continue
    }
    await db.userSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: String(s.value ?? '') },
      update: { value: String(s.value ?? '') },
    })
    stats.userSettingsUpserted++
  }

  /* ---- 2. Providers — config restored, keys NEVER touched ---- */
  for (const p of backup.data.providers || []) {
    if (!p || typeof p.name !== 'string') continue
    const ws = sanitizeWs(p.workspaceId)
    const match = await db.aIProvider.findFirst({ where: { name: p.name, endpoint: p.endpoint ?? null } })
    if (match) {
      await db.aIProvider.update({
        where: { id: match.id },
        data: {
          kind: p.kind ?? match.kind,
          model: p.model ?? match.model,
          systemPrompt: p.systemPrompt ?? match.systemPrompt,
          temperature: typeof p.temperature === 'number' ? p.temperature : match.temperature,
          maxTokens: p.maxTokens ?? match.maxTokens,
          isDefault: Boolean(p.isDefault),
          role: p.role ?? match.role,
          category: p.category ?? match.category,
          tag: p.tag ?? match.tag,
        },
      })
      stats.providersUpdated++
    } else {
      // apiKeyEnc intentionally absent → the row is honest "key not entered yet"
      await db.aIProvider.create({
        data: {
          name: p.name,
          kind: p.kind || 'custom',
          endpoint: p.endpoint ?? null,
          model: p.model || 'unknown',
          systemPrompt: p.systemPrompt ?? null,
          temperature: typeof p.temperature === 'number' ? p.temperature : 0.7,
          maxTokens: p.maxTokens ?? null,
          isDefault: Boolean(p.isDefault),
          role: p.role || 'work',
          category: p.category ?? null,
          tag: p.tag ?? null,
          workspaceId: ws,
        },
      })
      stats.providersCreated++
    }
  }

  /* ---- 3. Projects + nested rows ---- */
  for (const p of backup.data.projects || []) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue
    const ws = sanitizeWs(p.workspaceId)
    const existing = await db.project.findUnique({ where: { id: p.id } })
    if (existing) {
      await db.project.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          description: p.description ?? existing.description,
          framework: p.framework ?? existing.framework,
          language: p.language ?? existing.language,
          runtime: p.runtime ?? existing.runtime,
          entryPort: p.entryPort ?? existing.entryPort,
        },
      })
      stats.projectsUpdated++
    } else {
      await db.project.create({
        data: {
          id: p.id,
          name: p.name,
          description: p.description ?? null,
          framework: p.framework ?? null,
          language: p.language ?? null,
          runtime: p.runtime ?? null,
          entryPort: p.entryPort ?? null,
          status: typeof p.status === 'string' ? p.status : 'stopped',
          workspaceId: ws,
        },
      })
      stats.projectsCreated++
    }

    for (const f of p.files || []) {
      if (!f || typeof f.path !== 'string') continue
      await upsertFile(p.id, { path: f.path, content: typeof f.content === 'string' ? f.content : '', isDir: Boolean(f.isDir) })
      stats.filesUpserted++
    }
    for (const e of p.envVars || []) {
      if (!e || typeof e.key !== 'string') continue
      await upsertEnvVar(p.id, { key: e.key, value: String(e.value ?? ''), isSecret: Boolean(e.isSecret) }, sanitizeWs(e.workspaceId))
      stats.envVarsUpserted++
    }
    for (const s of p.settings || []) {
      if (!s || typeof s.key !== 'string') continue
      await upsertProjectSetting(p.id, { key: s.key, value: String(s.value ?? '') })
      stats.projectSettingsUpserted++
    }
    for (const r of p.runs || []) {
      if (!r || typeof r.id !== 'string') continue
      const runExists = await db.agentRun.findUnique({ where: { id: r.id } })
      if (runExists) {
        stats.runsSkippedExisting++
        continue
      }
      await db.agentRun.create({
        data: {
          id: r.id,
          projectId: p.id,
          prompt: typeof r.prompt === 'string' ? r.prompt : '',
          status: typeof r.status === 'string' ? r.status : 'completed',
          model: r.model ?? null,
          provider: r.provider ?? null,
          tokensIn: Number(r.tokensIn) || 0,
          tokensOut: Number(r.tokensOut) || 0,
          toolCalls: Number(r.toolCalls) || 0,
          response: typeof r.response === 'string' ? r.response : '',
          createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
          updatedAt: r.updatedAt ? new Date(r.updatedAt) : undefined,
        },
      })
      stats.runsImported++
    }
  }

  return { ok: true, stats, durationMs: Date.now() - started }
}
