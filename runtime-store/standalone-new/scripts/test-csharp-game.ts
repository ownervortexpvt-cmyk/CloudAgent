/** v76: compile-test the csharp-game (Snake) template with the real .NET SDK. */
import { getTemplate } from '../src/lib/templates'
import { spawnSync } from 'child_process'
import fs from 'fs'

const tpl = getTemplate('csharp-game')
if (!tpl) { console.error('template not found'); process.exit(1) }
const dir = '/tmp/cs-snake-test'
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
for (const f of tpl.files) fs.writeFileSync(`${dir}/${f.path}`, f.content)

const env = { ...process.env, PATH: `/home/z/my-project/sdk/dotnet-sdk:${process.env.PATH}`, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_CLI_HOME: '/tmp/dotnet-home' }
const r = spawnSync('dotnet', ['build', '-v', 'q'], { cwd: dir, env, encoding: 'utf8', timeout: 240000 })
console.log('--- build tail ---')
console.log((r.stdout + r.stderr).split('\n').slice(-8).join('\n'))
const dll = fs.existsSync(`${dir}/bin/Debug/net8.0/snake.dll`)
console.log(dll ? 'PASS: snake.dll built' : 'FAIL: snake.dll missing')
process.exit(dll && r.status === 0 ? 0 : 1)
