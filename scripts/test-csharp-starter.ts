/**
 * C# starter live test: emit Api.csproj + Program.cs from languages.ts,
 * dotnet run it on a test port, curl the endpoints.
 */
import { getLanguage } from '../src/lib/languages'

async function main() {
  const cs = getLanguage('csharp')
  if (!cs?.files) { console.error('FAIL: csharp files missing'); process.exit(1) }
  for (const f of cs.files) await Bun.write('/tmp/cs-test/' + f.path, f.content)

  const proc = Bun.spawn(['dotnet', 'run'], {
    cwd: '/tmp/cs-test',
    env: { ...process.env, PORT: '4998', PATH: `/home/z/my-project/sdk/dotnet-sdk:${process.env.PATH}`, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
    stdout: 'pipe', stderr: 'pipe',
  })
  // first run = restore + build, allow up to 3 min
  let up = false
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const res = await fetch('http://127.0.0.1:4998/')
      if (res.ok) { up = true; break }
    } catch {}
  }
  if (!up) {
    const err = new TextDecoder().decode(await new Response(proc.stderr).text())
    console.error('FAIL: server never came up. stderr:\n' + err.slice(-1200))
    proc.kill(); process.exit(1)
  }

  let pass = 0, fail = 0
  const check = async (url: string, expect: string, label: string) => {
    try {
      const res = await fetch(url)
      const t = await res.text()
      if (res.status === 200 && t.includes(expect)) { console.log('PASS ' + label); pass++ }
      else { console.error(`FAIL ${label} — ${res.status} ${t.slice(0, 120)}`); fail++ }
    } catch (e: any) { console.error(`FAIL ${label} — ${e.message}`); fail++ }
  }
  await check('http://127.0.0.1:4998/', 'C# app is running', 'GET / json')
  await check('http://127.0.0.1:4998/api/health', '"healthy"', 'GET /api/health')
  await check('http://127.0.0.1:4998/api/hello?name=CSharp', '"hello":"CSharp"', 'GET /api/hello?name')

  proc.kill()
  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}
main()
