// Test the login.html URL resolution logic with DOM stubs
const fs = require('fs')
const src = fs.readFileSync('/tmp/login_logic.js', 'utf8')

function makeEnv({ search = '', hash = '', saved = null, baked = '' } = {}) {
  const store = {}
  if (saved) store['ca_platform_url'] = saved
  const els = {}
  const el = (id) => (els[id] ??= { href: '#', classList: { remove() {}, add() {} } })
  // PLATFORM_URL lives in the FIRST script block of login.html; the extracted
  // block is only the IIFE, so inject the const ahead of it.
  const code = `const PLATFORM_URL = ${JSON.stringify(baked)};\n` + src
  // fresh function scope each time
  const fn = new Function('localStorage', 'document', 'location', 'URLSearchParams', code)
  fn(
    { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v } },
    { getElementById: el },
    { search, hash },
    URLSearchParams,
  )
  return els
}

// 1: ?u= override wins
let e = makeEnv({ search: '?u=https://preview-test-123.example.net/', baked: 'https://baked.example.com' })
console.log('T1 ?u=       →', e.enterLogin.href, e.enterRegister.href)
// 2: remembered localStorage beats baked
e = makeEnv({ saved: 'https://remembered.example.com', baked: 'https://baked.example.com' })
console.log('T2 remembered →', e.enterLogin.href)
// 3: baked only
e = makeEnv({ baked: 'https://baked.example.com' })
console.log('T3 baked      →', e.enterLogin.href)
// 4: nothing — no crash, fallback card stays (show() never called)
e = makeEnv({})
console.log('T4 none       → show called:', !!e.enterLogin, '(false = fallback card shown) ✓')
// 5: ?u= with garbage value ignored → falls back to baked
e = makeEnv({ search: '?u=notaurl', baked: 'https://baked.example.com' })
console.log('T5 bad ?u=    →', e.enterLogin.href)
