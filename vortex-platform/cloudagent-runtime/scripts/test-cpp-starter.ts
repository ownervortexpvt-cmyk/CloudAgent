/**
 * Compile-test the C++ starter emitted from src/lib/languages.ts.
 * Extracts main.cpp + Makefile content via bun's TS import, then
 * compiles with g++ and smoke-tests the HTTP server.
 */
import { getLanguage } from '../src/lib/languages'

async function main() {
  const lang = getLanguage('cpp')
  if (!lang?.files) {
    console.error('FAIL: cpp language or files missing')
    process.exit(1)
  }
  const mainCpp = lang.files.find(f => f.path === 'main.cpp')!
  const makefile = lang.files.find(f => f.path === 'Makefile')!

  const cs = getLanguage('csharp')
  if (!cs?.files?.length) {
    console.error('FAIL: csharp language or files missing')
    process.exit(1)
  }
  console.log('csharp files:', cs.files.map(f => f.path).join(', '))
  console.log('cpp files:', lang.files.map(f => f.path).join(', '))

  await Bun.write('/tmp/cpp-test/main.cpp', mainCpp.content)
  await Bun.write('/tmp/cpp-test/Makefile', makefile.content)

  // 1. Compile via the Makefile (exactly what the runtime does)
  const make = Bun.spawnSync(['make'], { cwd: '/tmp/cpp-test' })
  const makeOut = new TextDecoder().decode(make.stderr) + new TextDecoder().decode(make.stdout)
  console.log('make exit:', make.exitCode)
  if (make.exitCode !== 0) {
    console.error('MAKE FAILED:\n', makeOut)
    process.exit(1)
  }
  console.log('make OK — first lines:', makeOut.trim().split('\n')[0])

  // 2. Run the server on a test port
  const proc = Bun.spawn(['./app'], { cwd: '/tmp/cpp-test', env: { ...process.env, PORT: '4999' }, stdout: 'pipe', stderr: 'pipe' })
  await new Promise(r => setTimeout(r, 700))

  let pass = 0, fail = 0
  async function check(url: string, expect: string, label: string, expectStatus = 200) {
    try {
      const res = await fetch(url)
      const text = await res.text()
      if (res.status === expectStatus && text.includes(expect)) { console.log(`PASS ${label}`); pass++ }
      else { console.error(`FAIL ${label} — status ${res.status}, body: ${text.slice(0, 120)}`); fail++ }
    } catch (e: any) {
      console.error(`FAIL ${label} — ${e.message}`)
      fail++
    }
  }

  await check('http://127.0.0.1:4999/', 'C++ app is running', 'GET / serves HTML')
  await check('http://127.0.0.1:4999/?XTransformPort=4999', 'C++ app is running', 'GET /?XTransformPort (proxy style) serves HTML')
  await check('http://127.0.0.1:4999/api/health', '"healthy"', 'GET /api/health')
  await check('http://127.0.0.1:4999/api/hello?name=CloudAgent', '"hello":"CloudAgent"', 'GET /api/hello?name')
  await check('http://127.0.0.1:4999/nope', '"error":"not found","path":"/nope"', 'GET /nope → 404 json', 404)

  proc.kill()
  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
