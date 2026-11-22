const crypto = require('crypto')
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex')
  return salt + ':' + hash
}
async function main() {
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient()
  try {
    const email = 'mdhonabali61@gmail.com'
    let u = await db.authUser.findUnique({ where: { email } })
    if (!u) {
      u = await db.authUser.create({ data: { email, name: 'Owner', passwordHash: hashPassword('Owner123'), role: 'admin', plan: 'ultra_pro_max', planKind: 'lifetime', planStartedAt: new Date(), status: 'active' } })
      console.log('CREATED', u.id, u.email)
    } else {
      const upd = await db.authUser.update({ where: { id: u.id }, data: { passwordHash: hashPassword('Owner123'), status: 'active' } })
      console.log('UPDATED', upd.id, upd.email, 'role=' + upd.role)
    }
    try { const r = await db.authSession.deleteMany({ where: { userId: u.id } }); console.log('SESSIONS_REVOKED', r.count) } catch (e) { console.log('SESSION_SKIP', e.message) }
  } finally { await db.$disconnect() }
}
main().catch(e => { console.error('ERROR', e.message); process.exit(1) })
