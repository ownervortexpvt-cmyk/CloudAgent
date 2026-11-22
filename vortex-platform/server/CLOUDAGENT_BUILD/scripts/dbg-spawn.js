/* Mimic runtime.start() spawn for the python project to expose the real error */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const ROOT = '/home/z/my-project'
const cwd = process.argv[2]
const cmd = process.argv[3] || 'python -m uvicorn main:app --port 4123'

function sdkPaths() {
  const out = []
  const base = path.join(ROOT, 'sdk')
  try {
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith('.')) continue
      const bin = path.join(base, d, 'bin')
      if (fs.existsSync(bin)) out.push(bin)
      const root = path.join(base, d)
      if (fs.existsSync(path.join(root, 'flutter'))) out.push(root)
    }
  } catch {}
  return out
}

const env = { ...process.env }
env.PATH = [path.join(cwd, 'node_modules', '.bin'), ...sdkPaths(), process.env.PATH || ''].join(':')
env.PORT = '4123'
env.FORCE_COLOR = '0'
env.BROWSER = 'none'
env.DOTNET_CLI_TELEMETRY_OPTOUT = '1'
env.DOTNET_NOLOGO = '1'
// sdkEnv additions
for (const [k, p] of Object.entries({
  JAVA_HOME: ROOT + '/sdk/jdk-17', GRADLE_USER_HOME: ROOT + '/sdk/gradle-home',
  ANDROID_SDK_ROOT: ROOT + '/sdk/android-sdk', ANDROID_HOME: ROOT + '/sdk/android-sdk',
  DOTNET_ROOT: ROOT + '/sdk/dotnet-sdk', GRADLE_HOME: ROOT + '/sdk/gradle',
  KOTLIN_HOME: ROOT + '/sdk/kotlin',
})) if (fs.existsSync(p)) env[k] = p

const wrapped = `echo 500 > /proc/self/oom_score_adj 2>/dev/null; ${cmd}`
console.log('CMD:', wrapped)
const p = spawn('bash', ['-c', wrapped], { cwd, env, detached: true })
let out = ''
p.stdout.on('data', d => { out += d; process.stdout.write('[out] ' + d) })
p.stderr.on('data', d => { out += d; process.stdout.write('[err] ' + d) })
p.on('close', code => { console.log('EXIT CODE:', code); process.exit(0) })
setTimeout(() => { console.log('STILL RUNNING AFTER 12s — killing'); process.kill(-p.pid, 'SIGKILL'); process.exit(0) }, 12000)
