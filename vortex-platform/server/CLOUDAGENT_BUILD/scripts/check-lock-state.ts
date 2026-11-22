import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const rows = await db.userSetting.findMany({ where: { key: { startsWith: 'lock_' } } })
  if (!rows.length) {
    console.log('NO_LOCK_ROWS (first-run state — owner will create PIN on next visit)')
    return
  }
  for (const r of rows) {
    const v = r.value || ''
    console.log(`${r.key} = ${v.slice(0, 10)}… (len=${v.length}, updatedAt=${r.updatedAt?.toISOString?.()})`)
  }
}

main().finally(() => db.$disconnect())
