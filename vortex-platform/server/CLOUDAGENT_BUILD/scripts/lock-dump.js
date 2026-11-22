/** Safe lock row dump → scripts/.lock-backup2.json (no delete). */
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const p = new PrismaClient()
p.userSetting.findMany({ where: { key: { in: ['lock_hash', 'lock_secret', 'recovery_hash'] } } })
  .then(async rows => {
    fs.writeFileSync('/home/z/my-project/scripts/.lock-backup2.json', JSON.stringify(rows, null, 1))
    console.log('dumped:', rows.map(r => r.key).join(','))
    await p.$disconnect()
  })
  .catch(e => { console.error(e.message); process.exit(1) })
