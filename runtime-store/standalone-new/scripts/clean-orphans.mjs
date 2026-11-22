import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const db = new PrismaClient()
const orphans = await db.project.findMany({ where: { OR: [{ name: { contains: 'e2e' } }, { name: { contains: 'v9-' } }, { name: 'v85 full-product probe' }, { name: 'scratch run test' }] } })
console.log('found', orphans.length, 'orphan test projects:')
for (const p of orphans) {
  const dir = path.join('projects', p.id)
  if (fs.existsSync(dir)) { execSync(`rm -rf ${JSON.stringify(dir)}`); console.log('  disk removed:', p.id.slice(0, 10)) }
  await db.project.delete({ where: { id: p.id } })
  console.log(' DEL', p.name)
}
const left = await db.project.count()
console.log('projects remaining:', left)
await db.$disconnect()
