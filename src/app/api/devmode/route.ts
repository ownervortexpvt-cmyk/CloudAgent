import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Developer mode configuration.
 *   GET  → return current config (enabled, prompt, maxIterations, activePreset)
 *   POST → save config
 *
 * Stored as UserSetting rows with prefix `devmode:`.
 */
export async function GET() {
  const rows = await db.userSetting.findMany({ where: { key: { startsWith: 'devmode:' } } })
  const cfg: Record<string, any> = {}
  for (const r of rows) {
    const k = r.key.replace(/^devmode:/, '')
    if (k === 'enabled') cfg.enabled = r.value === 'true'
    else if (k === 'maxIterations') cfg.maxIterations = parseInt(r.value, 10)
    else cfg[k] = r.value
  }
  return NextResponse.json({
    enabled: cfg.enabled ?? false,
    prompt: cfg.prompt ?? '',
    maxIterations: cfg.maxIterations ?? 1000,
    activePreset: cfg.activePreset ?? 'default',
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { enabled, prompt, maxIterations, activePreset } = body
  await db.userSetting.upsert({
    where: { key: 'devmode:enabled' },
    create: { key: 'devmode:enabled', value: String(!!enabled) },
    update: { value: String(!!enabled) },
  })
  if (typeof prompt === 'string') {
    await db.userSetting.upsert({
      where: { key: 'devmode:prompt' },
      create: { key: 'devmode:prompt', value: prompt },
      update: { value: prompt },
    })
  }
  if (typeof maxIterations === 'number') {
    await db.userSetting.upsert({
      where: { key: 'devmode:maxIterations' },
      create: { key: 'devmode:maxIterations', value: String(maxIterations) },
      update: { value: String(maxIterations) },
    })
  }
  if (typeof activePreset === 'string') {
    await db.userSetting.upsert({
      where: { key: 'devmode:activePreset' },
      create: { key: 'devmode:activePreset', value: activePreset },
      update: { value: activePreset },
    })
  }
  return NextResponse.json({ ok: true })
}
