import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const lockHash = await db.userSetting.findUnique({ where: { key: 'lock_hash' } })
  const lockSecret = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
  const recoveryHash = await db.userSetting.findUnique({ where: { key: 'recovery_hash' } })
  console.log('lock_hash:', lockHash ? lockHash.value.slice(0, 12) + '...' : 'EMPTY')
  console.log('lock_secret:', lockSecret ? 'SET(' + lockSecret.value.length + ')' : 'EMPTY')
  console.log('recovery_hash:', recoveryHash ? recoveryHash.value.slice(0, 12) + '...' : 'EMPTY')
  const projects = await db.project.count()
  const runs = await db.agentRun.count()
  const settings = await db.userSetting.findMany({ select: { key: true } })
  console.log('projects:', projects, '| agentRuns:', runs)
  console.log('userSetting keys:', settings.map((s) => s.key).join(', '))
  await db.$disconnect()
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1) })
