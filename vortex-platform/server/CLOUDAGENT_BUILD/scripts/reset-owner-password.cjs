#!/usr/bin/env node
/** Reset owner password to Owner123 using the app's scrypt scheme (salt:hash). */
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verify(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':')
    const h = crypto.scryptSync(String(pw), salt, 64).toString('hex')
    return h === hash
  } catch { return false }
}

const db = new PrismaClient()
const OWNER_PASSWORD = 'Owner123'

async function main() {
  const users = await db.authUser.findMany()
  const owners = users.filter(u =>
    (u.role || '').toLowerCase() === 'owner' ||
    (u.role || '').toLowerCase() === 'admin' ||
    /mdhonabali61@gmail\.com/i.test(u.email || '')
  )
  if (!owners.length) {
    console.log('NO OWNER ROW FOUND. users:', users.map(u => `${u.email}/${u.role}`).join(', '))
    return
  }
  for (const o of owners) {
    const oldWorked = o.passwordHash ? verify(OWNER_PASSWORD, o.passwordHash) : false
    if (oldWorked) {
      console.log(`${o.email}: already Owner123 — no change`)
      continue
    }
    await db.authUser.update({ where: { id: o.id }, data: { passwordHash: hashPassword(OWNER_PASSWORD) } })
    const fresh = await db.authUser.findUnique({ where: { id: o.id } })
    console.log(`${o.email}: reset -> Owner123 (verify: ${verify(OWNER_PASSWORD, fresh.passwordHash)})`)
  }
}

main().finally(() => db.$disconnect())
