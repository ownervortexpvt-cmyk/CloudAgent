/**
 * Owner lock RESET — wipes lock_hash + lock_secret (+ sessions/passkeys)
 * so the builder returns to first-run state and the OWNER creates a fresh
 * PIN on their next visit. Run manually via tsx when the owner is locked
 * out. There is deliberately NO in-app reset (that would defeat the lock).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const del = await db.userSetting.deleteMany({
    where: { key: { in: ['lock_hash', 'lock_secret'] } },
  })
  console.log(`deleted ${del.count} lock rows`)
  const tables = [
    db.lockSession?.deleteMany?.().then((r: { count: number }) => console.log(`sessions cleared: ${r.count}`)).catch(() => {}),
    db.lockPasskey?.deleteMany?.().then((r: { count: number }) => console.log(`passkeys cleared: ${r.count}`)).catch(() => {}),
  ].filter(Boolean)
  await Promise.all(tables as Promise<void>[])
  console.log('LOCK RESET DONE — next visit shows first-run setup')
}

main().finally(() => db.$disconnect())
