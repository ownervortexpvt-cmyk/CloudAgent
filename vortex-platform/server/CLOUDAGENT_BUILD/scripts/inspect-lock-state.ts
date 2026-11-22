/**
 * Debug: inspect current lock state + live sessions (who is banging the door).
 * Run: bunx tsx scripts/inspect-lock-state.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const settings = await db.userSetting.findMany({
    where: { key: { in: ['lock_hash', 'lock_secret'] } },
    select: { key: true },
  })
  console.log('lock settings present:', settings.map(s => s.key))

  const sessions = await db.lockSession.findMany({
    orderBy: { lastSeenAt: 'desc' },
    take: 12,
  })
  console.log(`\nLockSession rows: ${sessions.length}`)
  for (const s of sessions) {
    console.log(`- device="${s.device}" ip="${s.ip}" created=${s.createdAt.toISOString()} lastSeen=${s.lastSeenAt.toISOString()}`)
  }

  const passkeys = await db.lockPasskey.count().catch(() => -1)
  console.log('\nlockPasskey count:', passkeys)
}

main().finally(() => db.$disconnect())
