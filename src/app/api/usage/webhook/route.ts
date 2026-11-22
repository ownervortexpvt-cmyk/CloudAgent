/**
 * /api/usage/webhook — v60 run-finished webhook settings.
 *  GET  → { ok, url, hasSecret }   (the secret itself never leaves the server)
 *  POST { url, secret }            (either may be '' to clear)
 * Enforcement lives in lib/webhook.ts — fire-and-forget POST on every
 * finished run with an HMAC signature when a secret is set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { WEBHOOK_URL_KEY, WEBHOOK_SECRET_KEY } from '@/lib/webhook'

export async function GET() {
  const url = (await db.userSetting.findUnique({ where: { key: WEBHOOK_URL_KEY } }).catch(() => null))?.value || ''
  const hasSecret = !!(await db.userSetting.findUnique({ where: { key: WEBHOOK_SECRET_KEY } }).catch(() => null))?.value
  return NextResponse.json({ ok: true, url, hasSecret })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const url = String(body?.url || '').trim()
  const secret = String(body?.secret ?? '').trim()
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: 'url must start with http:// or https://' }, { status: 400 })
  }
  await db.userSetting.upsert({
    where: { key: WEBHOOK_URL_KEY },
    create: { key: WEBHOOK_URL_KEY, value: url },
    update: { value: url },
  })
  await db.userSetting.upsert({
    where: { key: WEBHOOK_SECRET_KEY },
    create: { key: WEBHOOK_SECRET_KEY, value: secret },
    update: { value: secret },
  })
  return NextResponse.json({ ok: true, url, hasSecret: !!secret })
}
