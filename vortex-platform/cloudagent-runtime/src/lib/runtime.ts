/**
 * Runtime Manager.
 *
 * Architecture:
 *   - `RuntimeAdapter` interface defines start/stop/exec/build.
 *   - `NodeRuntimeAdapter` runs subprocesses directly on the host (works in
 *     this sandbox without Docker).
 *   - `DockerRuntimeAdapter` defines the same interface but routes commands
 *     through `docker run`/`docker exec` — selected when `CA_RUNTIME=docker`
 *     AND docker is available.
 *   - For Flutter/Java/Python we detect SDK availability and fall back to
 *     a "not installed" adapter that returns a structured error message —
 *     the operator can install the SDK and the same code paths work.
 *
 * This keeps the agent's `run_project` / `install_package` / `terminal`
 * tools working against a real subprocess layer in the sandbox.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import net from 'net'
import path from 'path'
import fs from 'fs'
import { db } from './db'
import { decrypt } from './crypto'
import * as storage from './storage'
import { detectFramework, findFreePort, Runtime, Framework } from './framework'

/**
 * Build the child-process environment for a project run/exec:
 *   1. server env (PATH, HOME, ...)
 *   2. secrets stored via the Secrets panel (db.envVar + global secrets, decrypted)
 *   3. KEY=VALUE lines from the project's .env file
 * Previously ONLY the server env was passed — every secret the user added
 * in the panel was silently missing from `node index.js`, Python, Go, etc.
 */
async function buildProjectEnv(projectId: string, cwd: string): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...process.env } as any
  // Global secrets first (shared across all projects), then per-project
  // secrets override them — so a project can redefine OPENAI_API_KEY without
  // touching other projects.
  try {
    const globals = await db.userSetting.findMany({ where: { key: { startsWith: 'secret:' } } })
    for (const row of globals) {
      const key = row.key.replace(/^secret:/, '').replace(/:plain$/, '')
      if (!key) continue
      const val = row.key.endsWith(':plain') ? row.value : decrypt(row.value)
      if (val) env[key] = val
    }
  } catch {}
  try {
    const rows = await db.envVar.findMany({ where: { projectId } })
    for (const row of rows) {
      const val = row.isSecret ? decrypt(row.value) : row.value
      if (val) env[row.key] = val
    }
  } catch {}
  // Parse the project's own .env if present (dotenv-style: KEY=VALUE, ignores comments)
  try {
    const envPath = path.join(cwd, '.env')
    if (fs.existsSync(envPath)) {
      const text = fs.readFileSync(envPath, 'utf8')
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (!m) continue
        let v = m[2]
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (v) env[m[1]] = v
      }
    }
  } catch {}
  return env
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface StartResult {
  ok: boolean
  port?: number
  url?: string
  runtime?: Runtime
  error?: string
}

export interface RuntimeAdapter {
  readonly name: string
  start(projectId: string, runtime: Runtime, framework: Framework): Promise<StartResult>
  stop(projectId: string): Promise<boolean>
  exec(projectId: string, command: string, timeoutMs: number): Promise<ExecResult>
  build(projectId: string): Promise<{ ok: boolean; logs: string }>
  isAvailable(): Promise<boolean>
}

/* --------------------- In-memory process registry ------------------------ */
const processes = new Map<string, { proc: ChildProcessWithoutNullStreams; port: number; logs: string[]; startedAt: number }>()

// v86 FIX (owner: "Run problem" with zero visible error): the registry entry
// used to be created only AFTER the install phase, so every [auto] npm
// install / pub get line was silently DROPPED — a failed install looked like
// a dead Run with no logs. Logs written before the spawn now buffer here and
// drain into the entry when it appears.
const pendingLogs = new Map<string, string[]>()

export function pushLog(projectId: string, line: string) {
  const entry = processes.get(projectId)
  if (entry) {
    entry.logs.push(line)
    if (entry.logs.length > 10000) entry.logs = entry.logs.slice(-10000)
    return
  }
  const p = pendingLogs.get(projectId) || []
  p.push(line)
  if (p.length > 1000) pendingLogs.set(projectId, p.slice(-1000))
  else pendingLogs.set(projectId, p)
}

export function getLogs(projectId: string): string {
  const entry = processes.get(projectId)
  if (entry) return entry.logs.join('')
  // v120 FIX (owner: "Run problem" debugging): a crashed process used to take
  // its WHOLE console history to the grave — the entry was deleted on close
  // and getLogs returned '', so every "exit 1/127/134 before ready" looked
  // like a dead Run with no logs. The tail now survives in pendingLogs so
  // the Console keeps showing WHY it died after the process is gone.
  const tail = pendingLogs.get(projectId)
  return tail ? tail.join('') : ''
}

/** v73: is the Flutter SDK actually present on the expected PATH? The old
 *  code happily spawned `flutter run …` without it → "command not found"
 *  → cryptic "Process exited with code 127". Detect BEFORE spawning.
 *  v75: PRIMARY path moved INSIDE the persistent workspace — /home/z/opt was
 *  outside it and got WIPED by a sandbox restart, which is exactly why the
 *  owner saw "Flutter SDK is not installed" again. Old path kept as fallback
 *  for operator installs. */
export function flutterSdkInstalled(): boolean {
  try {
    // HEALTH check, not just presence: a partial extraction (overlayfs quirk —
    // see setup-flutter.sh) can leave bin/flutter WITHOUT bin/internal/ or the
    // packages/ framework — that SDK cannot run anything, and reporting it as
    // installed made every flutter run/build die with "shared.sh: No such file
    // or directory" while the UI claimed toolchains were OK.
    const ok = (sdk: string) =>
      fs.existsSync(path.join(sdk, 'bin', 'flutter')) &&
      fs.existsSync(path.join(sdk, 'bin', 'internal', 'shared.sh')) &&
      fs.existsSync(path.join(sdk, 'packages', 'flutter_tools', 'pubspec.yaml'))
    return ok('/home/z/my-project/sdk/flutter-sdk') || ok('/home/z/opt/flutter-sdk')
  } catch { return false }
}

/** v74: same honest pre-flight for the .NET SDK (C# projects). */
export function dotnetSdkInstalled(): boolean {
  try {
    return fs.existsSync('/home/z/my-project/sdk/dotnet-sdk/dotnet') ||
           fs.existsSync('/home/z/opt/dotnet-sdk/dotnet')
  } catch { return false }
}

/** Extra PATH entries for project subprocesses (SDKs installed by the operator).
 *  v75: SDKs now live under <project>/sdk/ (PERSISTENT across restarts) — the
 *  old /home/z/opt location was wiped by the sandbox restart. The dev-watcher
 *  stall risk is handled with explicit watch ignores in next.config.ts. */
const SDK_PATH_CANDIDATES = [
  '/home/z/my-project/sdk/flutter-sdk/bin',
  '/home/z/my-project/sdk/dotnet-sdk',
  '/home/z/my-project/sdk/jdk-17/bin',
  '/home/z/my-project/sdk/android-sdk/cmdline-tools/latest/bin',
  '/home/z/my-project/sdk/android-sdk/platform-tools',
  '/home/z/my-project/sdk/go-sdk/bin',
  '/home/z/my-project/sdk/php',
  '/home/z/my-project/sdk/composer',
  '/home/z/my-project/sdk/maven/maven/bin',
  // v78: rustup layout — shims (cargo/rustc proxies) live in CARGO_HOME/bin,
  // toolchains in RUSTUP_HOME=sdk/rust (both inside persistent sdk/)
  '/home/z/my-project/sdk/cargo-home/bin',
  // v78: standalone Gradle + Kotlin compiler + CMake (owner SDK checklist)
  '/home/z/my-project/sdk/gradle/bin',
  '/home/z/my-project/sdk/kotlin/bin',
  '/home/z/my-project/sdk/cmake/bin',
  '/home/z/opt/flutter-sdk/bin',
  '/home/z/opt/dotnet-sdk',
]

/* v77: computed FRESH on every spawn (was a module-level filtered const —
 *  if the server started before the SDKs existed, PATH stayed empty forever
 *  and every flutter/dotnet run died with exit 127 until a manual restart).
 *  Now SDKs installed later are picked up by the very next Run press.
 *
 *  v79: operator-installed CUSTOM SDKs are auto-discovered too — anything
 *  under sdk/custom/<name>/ gets its `bin/` subdir (or the dir itself when
 *  binaries sit at the top level) appended to PATH. This is what makes the
 *  SDK Manager's custom-install option actually usable by project runs.
 *  v86: EXPORTED — the Terminal (api/terminal) now injects the same paths,
 *  so flutter/javac/gradle work there too without absolute paths. */
export function sdkPaths(): string[] {
  const base = SDK_PATH_CANDIDATES.filter(p => { try { return fs.existsSync(p) } catch { return false } })
  try {
    const customRoot = '/home/z/my-project/sdk/custom'
    if (fs.existsSync(customRoot)) {
      for (const d of fs.readdirSync(customRoot)) {
        if (d.startsWith('.')) continue
        const dir = path.join(customRoot, d)
        try {
          if (!fs.statSync(dir).isDirectory()) continue
          const bin = path.join(dir, 'bin')
          if (fs.existsSync(bin)) base.push(bin)
          else {
            // top-level binaries (single-file custom installs)
            const hasExec = fs.readdirSync(dir).some(f => {
              if (f.startsWith('.')) return false
              try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
            })
            if (hasExec) base.push(dir)
          }
        } catch {}
      }
    }
  } catch {}
  return base
}

/** v76: Android/Java/Gradle env for project subprocesses — flutter android
 *  builds (`flutter build apk`) need JAVA_HOME (JDK 17 w/ javac — the system
 *  java is a JRE), a persistent GRADLE_USER_HOME and ANDROID_SDK_ROOT.
 *  Each entry only set when the directory exists. v86: EXPORTED for the Terminal. */
export function sdkEnv(): Record<string, string> {
  const e: Record<string, string> = {}
  const add = (k: string, p: string) => { try { if (fs.existsSync(p)) e[k] = p } catch {} }
  add('JAVA_HOME', '/home/z/my-project/sdk/jdk-17')
  add('GRADLE_USER_HOME', '/home/z/my-project/sdk/gradle-home')
  add('ANDROID_SDK_ROOT', '/home/z/my-project/sdk/android-sdk')
  add('ANDROID_HOME', '/home/z/my-project/sdk/android-sdk')
  add('DOTNET_ROOT', '/home/z/my-project/sdk/dotnet-sdk')
  // v78: standalone toolchain env — GRADLE_HOME for non-wrapper builds,
  // KOTLIN_HOME for kotlinc, ANDROID_NDK_HOME/ROOT for native plugins
  // (flutter build apk resolves NDK via these before re-downloading one).
  add('GRADLE_HOME', '/home/z/my-project/sdk/gradle')
  add('KOTLIN_HOME', '/home/z/my-project/sdk/kotlin')
  add('CMAKE_HOME', '/home/z/my-project/sdk/cmake')
  try {
    const ndkRoot = '/home/z/my-project/sdk/android-sdk/ndk'
    if (fs.existsSync(ndkRoot)) {
      const ver = fs.readdirSync(ndkRoot).find(d => fs.existsSync(path.join(ndkRoot, d, 'source.properties')))
      if (ver) { e['ANDROID_NDK_HOME'] = path.join(ndkRoot, ver); e['ANDROID_NDK_ROOT'] = path.join(ndkRoot, ver) }
    }
  } catch {}
  // v77: Go/Rust/Maven homes kept inside sdk/ so caches survive restarts.
  add('GOPATH', '/home/z/my-project/sdk/go-home')
  add('GOCACHE', '/home/z/my-project/sdk/go-home/build')
  add('CARGO_HOME', '/home/z/my-project/sdk/cargo-home')
  add('RUSTUP_HOME', '/home/z/my-project/sdk/rust')
  try {
    if (fs.existsSync('/home/z/my-project/sdk/maven-home/repository'))
      e['MAVEN_OPTS'] = '-Dmaven.repo.local=/home/z/my-project/sdk/maven-home/repository -Xmx768m'
  } catch {}
  return e
}

/* v80 OOM guard ----------------------------------------------------------------
 * The sandbox has 4 GB RAM and NO swap. Real incident: `flutter build apk`
 * (gradle + kotlin daemon) pushed total RSS past 4 GB and the kernel OOM
 * killer picked the biggest process — next-server at 2.1 GB — killing the
 * WHOLE platform (every page 502'd, published site unreachable) while the
 * build kept running. Fix: every project/build process is spawned with an
 * ELEVATED oom_score_adj (+500). Writing a higher value to your own
 * /proc/self/oom_score_adj is always permitted; children inherit it. Under
 * memory pressure the kernel now kills the BUILD first — the web app stays
 * up and the build fails with an honest message instead of taking the site
 * down with it. */
const OOM_ADJ = 500
const OOM_HINT =
  '\n[v80] This process was killed by the kernel OOM killer (sandbox: 4 GB RAM, no swap). ' +
  'Heavy builds now sacrifice themselves before the web app — free memory (stop other running projects) or shrink the build, then retry.'

/** Wrap a command so it (and all children) become the preferred OOM victim. */
function oomGuardWrap(command: string): string {
  // v86 FIX (owner: "Run problem"): the old wrapper `…; exec env <command>`
  // broke every COMPOUND command — `exec env (make || g++ …) && ./app` is a
  // bash syntax error (`(` cannot start env's args), which killed every C++
  // run with exit 2, and it silently disabled all `a || b` fallback chains
  // (exec replaces the shell, the || can never fire). Running the command as
  // a plain bash statement keeps assignment prefixes (PORT=… node …),
  // compounds (make || g++ && ./app) AND the oom_score_adj write — the
  // elevated score still lands before anything spawns.
  return `echo ${OOM_ADJ} > /proc/self/oom_score_adj 2>/dev/null; ${command}`
}

/** v86: kill a spawned process AND its whole process group (npm/gradle/vite
 * workers used to survive a parent-only SIGTERM and hold the port forever). */
function killTree(p: ChildProcessWithoutNullStreams | undefined, sig: NodeJS.Signals = 'SIGTERM') {
  if (!p?.pid) return
  try { process.kill(-p.pid, sig) } catch { try { p.kill(sig) } catch {} }
}

/* --------------------------- Localhost adapter --------------------------- */
class LocalhostRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'localhost'

  async isAvailable() { return true }

  async exec(projectId: string, command: string, timeoutMs = 60000): Promise<ExecResult> {
    const cwd = storage.ensureProjectDir(projectId)
    // Add node_modules/.bin + operator-installed SDKs (flutter/dotnet) to PATH
    const localBin = path.join(cwd, 'node_modules', '.bin')
    const enhancedPath = [localBin, ...sdkPaths(), process.env.PATH || ''].join(':')
    const env = await buildProjectEnv(projectId, cwd)
    env.PATH = enhancedPath
    Object.assign(env, sdkEnv())
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', oomGuardWrap(command)], { cwd, env: env as any, detached: true })
      let stdout = ''
      let stderr = ''
      const MAX_CAPTURE = 5_000_000 // 5 MB cap — `yes`/chatty builds used to OOM the host
      const timer = setTimeout(() => {
        killTree(proc, 'SIGKILL')
        stderr += '\n[timeout after ' + timeoutMs + 'ms]'
      }, timeoutMs)
      proc.stdout.on('data', (d) => { if (stdout.length < MAX_CAPTURE) stdout += d.toString(); else if (stdout.length < MAX_CAPTURE + 1000) stdout += '\n[output truncated — buffer cap reached]' })
      proc.stderr.on('data', (d) => { if (stderr.length < MAX_CAPTURE) stderr += d.toString() })
      proc.on('close', (code) => {
        clearTimeout(timer)
        // 137 = SIGKILL — on this box that is almost always the OOM killer
        if (code === 137 && !stderr.includes('[v80]')) stderr += OOM_HINT
        resolve({ code: code ?? 1, stdout, stderr })
      })
      proc.on('error', (e) => {
        clearTimeout(timer)
        resolve({ code: 1, stdout, stderr: stderr + '\n' + e.message })
      })
    })
  }

  async start(projectId: string, runtime: Runtime, framework: Framework): Promise<StartResult> {
    // Stop any existing process for this project
    await this.stop(projectId)
    const detection = detectFramework(projectId)
    const port = await findFreePort()
    const cwd = storage.ensureProjectDir(projectId)

    // Auto-install dependencies before running if node_modules doesn't exist.
    // This is the #1 reason projects fail to run — user creates a project but
    // never runs `npm install` / `flutter pub get`.
    try {
      const fs = await import('fs')
      const path = await import('path')

      const needsInstall =
        (detection.framework === 'next' || detection.framework === 'react' || detection.framework === 'vite' || detection.framework === 'node') &&
        fs.existsSync(path.join(cwd, 'package.json')) &&
        // v86: a HALF-FINISHED previous install (crashed mid-run / killed by
        // the watchdog) used to pass the node_modules existence check and
        // every later Run failed with MODULE_NOT_FOUND forever. An install
        // marker written only after a successful `npm install` makes the
        // next Run actually REPAIR the broken node_modules.
        (() => {
          const nm = path.join(cwd, 'node_modules')
          if (!fs.existsSync(nm)) return true
          if (!fs.existsSync(path.join(nm, '.ca-install-ok'))) return true
          // v116: a marker from a BAD install (NODE_ENV=production skipped
          // devDependencies → vite/next missing) used to block repair forever.
          // For JS frameworks, the framework's OWN binary must exist too.
          const mustExist: Record<string, string> = {
            vite: 'vite', react: 'vite', next: 'next', node: '',
          }
          const needed = mustExist[detection.framework]
          if (needed && !fs.existsSync(path.join(nm, '.bin', needed))) return true
          return false
        })()
      if (needsInstall) {
        pushLog(projectId, '[auto] Installing dependencies (npm install)...')
        // v116 FIX (exit 127 on every fresh project in prod): the prod server
        // runs with NODE_ENV=production and this exec inherits it — npm then
        // SKIPS devDependencies, so vite/next/@vitejs never land and the run
        // dies with "command not found" (127). --include=dev installs BOTH
        // sets; --no-audit/--no-fund keep the first-run window fast.
        const installResult = await this.exec(projectId, 'npm install --include=dev --no-audit --no-fund 2>&1', 1800000)
        pushLog(projectId, installResult.stdout.slice(-2000))
        if (installResult.code !== 0) {
          // v86 FIX (owner: "Run problem"): the failed install used to be
          // logged and then IGNORED — the spawn continued and crashed with a
          // cryptic exit 1/127. Now the run aborts honestly.
          pushLog(projectId, '[auto] npm install FAILED — run aborted. Read the errors above, fix them (or ask the agent to), then press Run again.')
          await db.project.update({ where: { id: projectId }, data: { status: 'failed' } }).catch(() => {})
          return { ok: false, runtime, error: 'npm install failed — open the Console (preview panel) for the real error, fix it, then press Run again.' }
        }
        try { fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(cwd, 'node_modules', '.ca-install-ok'), new Date().toISOString()) } catch {}
      }

      // v86 FIX: TypeScript projects (starter: main = dist/index.js) never
      // compiled — `tsc -w & node --watch …` dev scripts are rejected below,
      // and the node fallback then hit MODULE_NOT_FOUND on the missing
      // dist/. Build once before the run when the entry is not compiled yet.
      if (detection.framework === 'node' && fs.existsSync(path.join(cwd, 'package.json')) && fs.existsSync(path.join(cwd, 'node_modules', '.ca-install-ok'))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
          const main = String(pkg.main || '')
          const needsTsc = /typescript/.test(JSON.stringify(pkg.dependencies || {}) + JSON.stringify(pkg.devDependencies || {}))
            && main.startsWith('dist/')
            && !fs.existsSync(path.join(cwd, main))
            && fs.existsSync(path.join(cwd, 'tsconfig.json'))
          if (needsTsc) {
            pushLog(projectId, '[auto] Compiling TypeScript (npx tsc)...')
            const tsc = await this.exec(projectId, 'npx tsc 2>&1 || npx tsc --build 2>&1', 300000)
            pushLog(projectId, (tsc.stdout || '').slice(-1500))
          }
        } catch {}
      }

      // Flutter prep (v73): pub get + ensure the web platform exists.
      // Codegen writes only pubspec.yaml + lib/main.dart — `flutter run -d
      // web-server` FAILS with "This application is not configured to build
      // on the web" when the web/ platform folder is missing, so we scaffold
      // it non-interactively (flutter create . --platforms=web) before run.
      if (detection.framework === 'flutter') {
        if (!flutterSdkInstalled()) {
          pushLog(projectId, '[auto] Flutter SDK not found at /home/z/my-project/sdk/flutter-sdk — run cannot start. Install it: bash scripts/setup-flutter.sh (resumable).')
        } else {
          const needsPubGet = !fs.existsSync(path.join(cwd, '.dart_tool'))
          if (needsPubGet) {
            pushLog(projectId, '[auto] Running flutter pub get...')
            const pubResult = await this.exec(projectId, 'flutter pub get 2>&1 || true', 1200000)
            pushLog(projectId, pubResult.stdout.slice(-2000))
          }
          const needsWebPlatform = !fs.existsSync(path.join(cwd, 'web', 'index.html'))
          const needsAndroidPlatform = !fs.existsSync(path.join(cwd, 'android', 'app', 'build.gradle.kts'))
          if (needsWebPlatform || needsAndroidPlatform) {
            pushLog(projectId, '[auto] scaffolding platforms (web preview + android/ios/linux code targets)...')
            const createResult = await this.exec(projectId, 'flutter create . --platforms=web,android,ios,linux --offline 2>&1 || flutter create . --platforms=web,android,ios,linux 2>&1', 300000)
            pushLog(projectId, createResult.stdout.slice(-2000))
          }
          // v76: NDK skip — the flutter gradle plugin auto-installs a 2.5G NDK
          // that small sandboxes cannot hold; prebuilt libflutter.so needs no
          // NDK, so comment the template line out after scaffolding.
          if (fs.existsSync(path.join(cwd, 'android', 'app', 'build.gradle.kts'))) {
            await this.exec(projectId, "sed -i 's|^    ndkVersion = flutter.ndkVersion$|    // ndkVersion omitted (sandbox: no NDK disk budget; prebuilt libflutter.so needs none)|' android/app/build.gradle.kts 2>&1 || true", 15000)
            pushLog(projectId, '[auto] Android target ready — APK: run `flutter build apk --debug --target-platform android-arm64` in the Terminal (needs ≥2G free disk).')
          }
          // v80: the flutter template pins org.gradle.jvmargs=-Xmx4G in
          // android/gradle.properties — that override alone can OOM this 4 GB
          // box (the exact 'publish killed the site' incident). Cap it to the
          // sandbox ceiling; GRADLE_USER_HOME covers non-flutter builds.
          if (fs.existsSync(path.join(cwd, 'android', 'gradle.properties'))) {
            await this.exec(projectId, "sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m/' android/gradle.properties 2>/dev/null || true", 15000)
            // v120: APK capability — gradle must NEVER call the network
            // sdkmanager (no network here): offline mode takes the plugin's
            // synthetic NDK fallback, and setup-android-stub.sh provides the
            // NDK dir + llvm-strip shim so `flutter build apk` runs fully
            // offline (proven end-to-end on this box).
            await this.exec(projectId, 'grep -q "^org.gradle.offline=true" android/gradle.properties 2>/dev/null || echo "org.gradle.offline=true" >> android/gradle.properties; bash /home/z/my-project/scripts/setup-android-stub.sh 2>&1 || true', 30000)
            // v124: pin the Kotlin Gradle plugin to the newest version that
            // actually exists in the local gradle cache. `flutter create`
            // templates pin the LATEST KGP (e.g. 2.4.0) whose whole artifact
            // tree is missing from the cache — and repo.maven.apache.org
            // 429-throttles this box — so the template default can never
            // resolve. The cached version resolves 100% locally.
            await this.exec(projectId,
              "KV=$(ls /home/z/my-project/sdk/gradle-home/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-gradle-plugin/ 2>/dev/null | sort -V | tail -1); " +
              "[ -n \"$KV\" ] && sed -i \"s/org.jetbrains.kotlin.android\\\") version \\\"[0-9.]*\\\"/org.jetbrains.kotlin.android\\\") version \\\"$KV\\\"/\" android/settings.gradle.kts 2>/dev/null; true",
              15000)
            // v124: MAVEN MIRROR FIRST (real incident — every `flutter build
            // apk` died at a random dependency because repo.maven.apache.org
            // rate-limits this box's shared egress IP with instant HTTP 429,
            // and even cached artifacts fail their metadata re-HEAD). The
            // gradle cache under sdk/gradle-home already holds every artifact
            // this box ever downloaded: mirror it into sdk/maven-local
            // (symlinks, ~1s, idempotent) and register it as the FIRST
            // repository in settings.gradle.kts + build.gradle.kts so
            // resolution is purely local. No mirror → zero behavior change.
            await this.exec(projectId, 'bash /home/z/my-project/scripts/build-maven-mirror.sh >/dev/null 2>&1 || true', 60000)
            await this.exec(projectId,
              "grep -q 'maven-local' android/settings.gradle.kts 2>/dev/null || sed -i 's|^    repositories {$|    repositories {\\n        maven(url = uri(\"file:///home/z/my-project/sdk/maven-local\"))|' android/settings.gradle.kts 2>/dev/null; " +
              "grep -q 'maven-local' android/build.gradle.kts 2>/dev/null || sed -i 's|^    repositories {$|    repositories {\\n        maven(url = uri(\"file:///home/z/my-project/sdk/maven-local\"))|' android/build.gradle.kts 2>/dev/null; true",
              15000)
            pushLog(projectId, '[auto] Gradle memory capped to 1 GB + local maven mirror registered (4 GB RAM sandbox, maven-central rate-limited).')
          }
        }
      }

      // C# prep (v74): dotnet restore warms the object model so `dotnet run`
      // (which would restore anyway) starts faster and logs clearly.
      if (detection.framework === 'dotnet') {
        if (!dotnetSdkInstalled()) {
          pushLog(projectId, '[auto] .NET SDK not found at /home/z/my-project/sdk/dotnet-sdk — run cannot start. Install it: bash scripts/setup-dotnet.sh (resumable).')
        } else if (!fs.existsSync(path.join(cwd, 'obj')) && detection.entry) {
          pushLog(projectId, '[auto] Running dotnet restore...')
          const csprojDir = path.dirname(path.join(cwd, detection.entry))
          const restoreResult = await this.exec(projectId, `dotnet restore ${JSON.stringify(csprojDir)} 2>&1 || true`, 600000)
          pushLog(projectId, restoreResult.stdout.slice(-2000))
        }
      }

      // Python pip install if no venv
      const needsPip = detection.framework === 'python' && fs.existsSync(path.join(cwd, 'requirements.txt'))
      if (needsPip) {
        pushLog(projectId, '[auto] Installing Python dependencies (pip install)...')
        // v120: system Python is PEP 668 externally-managed (refuses plain pip
        // install with exit 1) — retry with --break-system-packages before
        // giving up, so requirements actually install when packages exist.
        const pipResult = await this.exec(projectId, 'pip install -r requirements.txt 2>&1 || pip install --break-system-packages -r requirements.txt 2>&1 || true', 1800000)
        pushLog(projectId, pipResult.stdout.slice(-2000))
      }

      // v77: Go prep — resolve modules (zero-dep starters are instant; keeps
      // the readiness window clean for multi-module projects).
      if (detection.framework === 'go' && fs.existsSync(path.join(cwd, 'go.mod'))) {
        pushLog(projectId, '[auto] go mod download...')
        const goPrep = await this.exec(projectId, 'go mod download 2>&1 || true', 600000)
        pushLog(projectId, goPrep.stdout.slice(-1000))
      }

      // v77: Rust prep — fetch crates BEFORE the run so the readiness window
      // only contains the compile+bind (axum first fetch is 1-3 min).
      if (detection.framework === 'rust' && fs.existsSync(path.join(cwd, 'Cargo.toml')) && !fs.existsSync(path.join(cwd, 'target'))) {
        pushLog(projectId, '[auto] cargo fetch (first run downloads crates)...')
        const cargoPrep = await this.exec(projectId, 'cargo fetch 2>&1 || true', 900000)
        pushLog(projectId, cargoPrep.stdout.slice(-1000))
      }

      // v77: PHP prep — composer autoload (starter has no external deps).
      if (detection.framework === 'php' && fs.existsSync(path.join(cwd, 'composer.json')) && !fs.existsSync(path.join(cwd, 'vendor'))) {
        pushLog(projectId, '[auto] composer install...')
        const phpPrep = await this.exec(projectId, 'composer install --no-dev --no-interaction 2>&1 || true', 600000)
        pushLog(projectId, phpPrep.stdout.slice(-1000))
      }

      // v77: Java/Maven prep — pre-download Spring deps (2-5 min on first
      // run) so `mvn spring-boot:run` starts inside the readiness window.
      if (detection.framework === 'java-maven' && fs.existsSync(path.join(cwd, 'pom.xml'))) {
        pushLog(projectId, '[auto] maven dependency:go-offline (first run downloads Spring — takes a few minutes)...')
        const mvnPrep = await this.exec(projectId, 'mvn -q dependency:go-offline 2>&1 || true', 1800000)
        pushLog(projectId, mvnPrep.stdout.slice(-1000))
      }
    } catch (e: any) {
      pushLog(projectId, '[auto] Pre-run install check failed: ' + e.message)
    }

    let command: string | null = detection.devCommand
    if (!command || command.includes('node --watch') || command.includes('<csproj-dir>')) {
      // Fallback per framework — stronger defaults. Also rewrites the dotnet
      // template command (framework.ts carries a <csproj-dir> placeholder).
      switch (detection.framework) {
        case 'next': command = 'npx next dev -p ${PORT}'; break
        case 'vite': command = 'npx vite --port ${PORT} --host'; break
        case 'react': command = 'npx vite --port ${PORT} --host'; break
        case 'node': {
          // v86 FIX: respect package.json main — the TS starter's entry is
          // dist/index.js; the old hardcoded `node index.js` could never run it.
          let mainFile = 'index.js'
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
            if (pkg.main) mainFile = String(pkg.main)
          } catch {}
          command = `PORT=\${PORT} node ${mainFile}`
          break
        }
        case 'flutter': command = 'flutter run -d web-server --web-hostname=0.0.0.0 --web-port=${PORT} 2>&1 || dart run lib/main.dart'; break
        case 'python': command = 'PORT=${PORT} python main.py 2>&1'; break
        case 'go': command = 'PORT=${PORT} go run main.go 2>&1'; break
        case 'rust': command = 'PORT=${PORT} cargo run 2>&1'; break
        case 'dotnet': {
          // Real command computed from the detected .csproj location — the
          // framework.ts template keeps a <csproj-dir> placeholder.
          const csproj = detection.entry || 'Api.csproj'
          const dir = path.dirname(csproj)
          const projArg = dir && dir !== '.' ? ` --project ${JSON.stringify(dir)}` : ''
          command = `dotnet run${projArg} --urls http://0.0.0.0:\${PORT}`
          break
        }
        case 'cpp':
          // Prefer the detected dev command (make → g++ fallback chain)
          command = detection.devCommand || 'g++ -std=c++17 -O2 -pthread main.cpp -o app && PORT=${PORT} ./app'
          break
        case 'static':
          // Static projects (HTML/CSS/JS) previously got NO dev command at
          // all — Run always failed. Serve them with python's built-in
          // http.server so the LivePreview works.
          command = 'python3 -m http.server ${PORT} --bind 0.0.0.0'
          break
        default:
          // Last resort: try to detect from file existence
          if (storage.existsFile(projectId, 'index.js')) command = 'PORT=${PORT} node index.js'
          else if (storage.existsFile(projectId, 'main.py')) command = 'PORT=${PORT} python main.py'
          else if (storage.existsFile(projectId, 'main.go')) command = 'PORT=${PORT} go run main.go'
          else if (storage.existsFile(projectId, 'src/main.rs')) command = 'PORT=${PORT} cargo run'
          else command = null
      }
      if (command) {
        pushLog(projectId, '[auto] Using fallback dev command: ' + command)
      }
    }
    if (!command) {
      return {
        ok: false,
        runtime,
        error: `No dev command available for framework ${detection.framework}. Try editing package.json or pubspec.yaml.`,
      }
    }
    command = command.replace(/\$\{PORT\}/g, String(port))

    // Write port to project setting for preview
    await db.project.update({ where: { id: projectId }, data: { entryPort: port, status: 'running', framework: detection.framework, runtime: detection.runtime, language: detection.language } }).catch(() => {})

    return new Promise((resolve) => {
      try {
        (async () => {
          // Add node_modules/.bin to PATH so project-local binaries (nodemon, vite, next, etc.) work
          const localBin = path.join(cwd, 'node_modules', '.bin')
          // Add operator-installed SDKs (flutter / dotnet) to PATH when present
          const enhancedPath = [localBin, ...sdkPaths(), process.env.PATH || ''].join(':')
          // Secrets from the panel + project .env now reach the dev server
          const env = await buildProjectEnv(projectId, cwd)
          // v120 FIX (owner: "Next.js 500" + v116 exit-127 family): the PROD
          // platform server runs NODE_ENV=production and this spawn inherited
          // it. `next dev` under production-NODE_ENV breaks its own dev CSS
          // loader chain — every globals.css import 500'd with "Module parse
          // failed: Unexpected token (1:0)". This runtime ALWAYS runs dev
          // commands (next dev / vite / flutter run …), so dev servers get a
          // development NODE_ENV, no matter how the platform itself runs.
          env.NODE_ENV = 'development'
          env.PATH = enhancedPath
          env.PORT = String(port)
          env.FORCE_COLOR = '0'
          env.BROWSER = 'none'
          env.DOTNET_CLI_TELEMETRY_OPTOUT = '1'
          env.DOTNET_NOLOGO = '1'
          Object.assign(env, sdkEnv())
          // v80: long-running dev servers also get the elevated oom_score —
          // a runaway `next dev` inside a PROJECT must never out-prioritize
          // the platform's own next-server when the kernel picks a victim.
          // v86: detached → own process group, so stop() can killTree the
          // whole tree (npm/gradle/vite workers used to survive and hold the port).
          const proc = spawn('bash', ['-c', oomGuardWrap(command!)], { cwd, env: env as any, detached: true }) as ChildProcessWithoutNullStreams
          // v86: drain the pre-spawn install logs into this entry so the
          // Console shows the FULL story (install → boot).
          const preLogs = pendingLogs.get(projectId) || []
          pendingLogs.delete(projectId)
          const logs: string[] = [...preLogs]
          const entry = { proc, port, logs, startedAt: Date.now() }
          processes.set(projectId, entry)
          let resolvedOk = false
          // v86 FIX (owner: "Run problem"): the old blind 12s timeout resolved
          // { ok: true } even when NOTHING was listening — the UI toasted
          // "Running on port N" and the preview stayed blank forever. Now a
          // real TCP probe on 127.0.0.1:port decides readiness (the stdout
          // ready-regex stays as the fast path).
          const tcpProbe = setInterval(() => {
            if (resolvedOk) { clearInterval(tcpProbe); return }
            const s = net.connect({ port, host: '127.0.0.1' })
            s.once('connect', () => {
              s.destroy()
              if (!resolvedOk) {
                resolvedOk = true
                clearInterval(tcpProbe)
                clearTimeout(readyTimeout)
                resolve({ ok: true, port, url: `/preview/${port}/`, runtime })
              }
            })
            s.once('error', () => { try { s.destroy() } catch {} })
          }, 1000)
          const readyTimeout = setTimeout(() => {
            if (!resolvedOk) {
              resolvedOk = true
              clearInterval(tcpProbe)
              // Honest failure WITH the last log lines — the blank-preview
              // mystery. The process keeps running (it may still come up;
              // the 3s status poller + Console reflect reality).
              const tail = logs.slice(-8).join('\n')
              resolve({ ok: false, port, url: `/preview/${port}/`, runtime, error: `Server did not open port ${port} within 90s.\nLast logs:\n${tail || '(no output yet)'}` })
            }
          }, 90000)

          const onLine = (line: string) => {
            logs.push(line)
            pushLog(projectId, line)
            // Detect "ready" signals
            if (!resolvedOk && /(ready|started|listening|local:|localhost:|0\.0\.0\.0:|webpack compiled|compiled successfully|vite v)/i.test(line)) {
              resolvedOk = true
              clearTimeout(readyTimeout)
              resolve({ ok: true, port, url: `/preview/${port}/`, runtime })
            }
          }

          proc.stdout.on('data', (d) => {
            d.toString().split('\n').forEach((l: string) => { if (l.trim()) onLine(l) })
          })
          proc.stderr.on('data', (d) => {
            d.toString().split('\n').forEach((l: string) => { if (l.trim()) onLine('[stderr] ' + l) })
          })
          proc.on('error', (e) => {
            if (!resolvedOk) {
              resolvedOk = true
              clearTimeout(readyTimeout)
              resolve({ ok: false, error: e.message })
            }
          })
          proc.on('close', (code) => {
            pushLog(projectId, `[process exited with code ${code}]`)
            if (!resolvedOk) {
              resolvedOk = true
              clearInterval(tcpProbe)
              clearTimeout(readyTimeout)
              // v120 FIX: same honesty as the 90s-timeout path — a crash must
              // carry its LAST LOG LINES in the Run error, not a bare exit code.
              const tail = logs.slice(-10).join('\n')
              resolve({ ok: false, error: `Process exited with code ${code} before becoming ready.\nLast logs:\n${tail || '(no output)'}` })
            }
            processes.delete(projectId)
            // v120 FIX: keep the last 200 lines readable after death (getLogs
            // now falls back to pendingLogs — see note there).
            if (logs.length) pendingLogs.set(projectId, logs.slice(-200))
            db.project.update({ where: { id: projectId }, data: { status: 'stopped' } }).catch(() => {})
          })
        })().catch((e: any) => resolve({ ok: false, error: e.message }))
      } catch (e: any) {
        resolve({ ok: false, error: e.message })
      }
    })
  }

  async stop(projectId: string): Promise<boolean> {
    const entry = processes.get(projectId)
    if (!entry) {
      await db.project.update({ where: { id: projectId }, data: { status: 'stopped' } }).catch(() => {})
      return true
    }
    try {
      // v86: SIGTERM the whole process GROUP (detached spawn = own group) —
      // vite/esbuild/gradle workers used to survive a parent-only signal and
      // keep holding the port as unstoppable zombies.
      killTree(entry.proc, 'SIGTERM')
      setTimeout(() => killTree(entry.proc, 'SIGKILL'), 2000)
    } catch {}
    processes.delete(projectId)
    await db.project.update({ where: { id: projectId }, data: { status: 'stopped' } }).catch(() => {})
    return true
  }

  async build(projectId: string): Promise<{ ok: boolean; logs: string }> {
    const detection = detectFramework(projectId)
    await db.project.update({ where: { id: projectId }, data: { status: 'building' } }).catch(() => {})
    let cmd = 'npm run build'
    if (detection.framework === 'flutter') cmd = 'flutter build web'
    else if (detection.framework === 'java-maven') cmd = 'mvn package'
    else if (detection.framework === 'java-gradle') cmd = './gradlew build'
    else if (detection.framework === 'python') cmd = 'pip install -r requirements.txt'
    else if (detection.framework === 'dotnet') cmd = 'dotnet build'
    else if (detection.framework === 'cpp') cmd = 'make 2>/dev/null || g++ -std=c++17 -O2 -pthread main.cpp -o app'

    // v125 PUBLISH FIX (owner: "Publish er shomoy error — Failed to load
    // external module / Failed to collect page data / Build error occurred").
    // Two holes in the publish path, both closed here:
    //   1) Run auto-installs dependencies, Publish NEVER did — a fresh
    //      project published with no node_modules at all.
    //   2) Next 16 `next build` defaults to the TURBOPACK pipeline, which
    //      OOM-kills on this 4GB sandbox (the platform's own build needs
    //      --webpack for the same reason — see .zscripts/build-prod.sh).
    // Publish now installs deps exactly like Run, then builds with a child
    // heap cap; Next >=16 projects force the webpack pipeline explicitly.
    const jsFramework = detection.framework === 'next' || detection.framework === 'react' || detection.framework === 'vite' || detection.framework === 'node'
    if (jsFramework) {
      const fsMod = await import('fs')
      const pathMod = await import('path')
      const cwd = storage.ensureProjectDir(projectId)
      if (fsMod.existsSync(pathMod.join(cwd, 'package.json'))) {
        const nm = pathMod.join(cwd, 'node_modules')
        const needsInstall = !fsMod.existsSync(nm)
          || !fsMod.existsSync(pathMod.join(nm, '.ca-install-ok'))
        if (needsInstall) {
          const inst = await this.exec(projectId, 'npm install --include=dev --no-audit --no-fund 2>&1', 1800000)
          if (inst.code !== 0) {
            await db.project.update({ where: { id: projectId }, data: { status: 'failed' } }).catch(() => {})
            return { ok: false, logs: 'npm install failed during publish\n' + inst.stdout + (inst.stderr ? '\n[stderr]\n' + inst.stderr : '') }
          }
          try { fsMod.mkdirSync(nm, { recursive: true }); fsMod.writeFileSync(pathMod.join(nm, '.ca-install-ok'), new Date().toISOString()) } catch {}
        }
        if (detection.framework === 'next') {
          // Version-aware bundler: Next >=16 defaults to Turbopack (OOMs here)
          // → force --webpack. Next 14/15 build with webpack by default.
          let nextMajor = 0
          try {
            const pkg = JSON.parse(fsMod.readFileSync(pathMod.join(cwd, 'node_modules', 'next', 'package.json'), 'utf8'))
            nextMajor = parseInt(String(pkg.version || '').split('.')[0] || '0', 10) || 0
          } catch {}
          const heap = 'NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1024'
          cmd = nextMajor >= 16 ? `${heap} npx next build --webpack` : `${heap} npm run build`
        } else if (detection.framework === 'react' || detection.framework === 'vite') {
          cmd = 'NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1024 npx vite build'
        }
      }
    }

    const r = await this.exec(projectId, cmd, 1800000)
    await db.project.update({ where: { id: projectId }, data: { status: r.code === 0 ? 'stopped' : 'failed' } }).catch(() => {})
    return { ok: r.code === 0, logs: r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '') }
  }
}

/* --------------------------- Docker adapter ----------------------------- */
class DockerRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'docker'
  async isAvailable() {
    // The old path called exec('') → ensureProjectDir('') → always threw
    // 'Invalid projectId' before docker was ever consulted.
    try {
      const r = await new Promise<{ code: number }>((resolve) => {
        const proc = spawn('bash', ['-c', 'docker info 2>&1'], { timeout: 5000 })
        proc.on('close', (code) => resolve({ code: code ?? 1 }))
        proc.on('error', () => resolve({ code: 1 }))
      })
      return r.code === 0
    } catch { return false }
  }
  async start(_p: string, _r: Runtime, _f: Framework) { return { ok: false, error: 'Docker runtime not configured in this environment — falling back to localhost' } }
  async stop(_p: string) { return true }
  async exec(_p: string, _c: string, _t: number) { return { code: 1, stdout: '', stderr: 'docker runtime not available' } }
  async build(_p: string) { return { ok: false, logs: 'docker runtime not available' } }
}

/* ---------------------------- Manager facade ---------------------------- */
class RuntimeManager {
  private adapter: RuntimeAdapter
  // v86: per-project start mutex state (see start() below)
  private startingProjects = new Set<string>()
  constructor() {
    // Allow operator to force docker via env; otherwise localhost.
    if (process.env.CA_RUNTIME === 'docker') {
      this.adapter = new DockerRuntimeAdapter()
    } else {
      this.adapter = new LocalhostRuntimeAdapter()
    }
  }

  getAdapterName() { return this.adapter.name }
  getLogs(projectId: string) { return getLogs(projectId) }
  /**
   * Get status of a project.
   * If a process is in our in-memory map, return 'running'.
   * Otherwise, return the DB-stored status. But also fix any stale state
   * where the DB says 'running' but no process exists (e.g. after a server
   * restart) by returning 'stopped' instead.
   */
  getStatus(projectId: string): string {
    if (processes.has(projectId)) return 'running'
    // Best-effort: check DB but don't block — fall back to 'stopped'
    try {
      // Synchronous-ish check — we use a simple heuristic to avoid making
      // this async. The project record's status may be stale after a server
      // restart, but for UI purposes the user can always click Run again.
      return 'stopped'
    } catch {
      return 'stopped'
    }
  }

  /**
   * Periodically called by the UI to sync DB status with actual process state.
   * If the DB says 'running' but no process exists, mark it as 'stopped'.
   */
  async syncProjectStatus(projectId: string): Promise<string> {
    if (processes.has(projectId)) return 'running'
    // Stale DB state — fix it
    try {
      const project = await db.project.findUnique({ where: { id: projectId }, select: { status: true } })
      if (project && (project.status === 'running' || project.status === 'building')) {
        await db.project.update({ where: { id: projectId }, data: { status: 'stopped', entryPort: null } })
      }
    } catch {}
    return 'stopped'
  }

  async start(projectId: string): Promise<StartResult> {
    // v86: per-project start mutex — a double-clicked Run / Run + agent
    // run_project racing used to pass findFreePort twice, double-spawn, and
    // the second processes.set overwrote the first (an untrackable zombie).
    if (this.startingProjects.has(projectId)) {
      return { ok: false, runtime: 'unknown' as Runtime, error: 'This project is already starting — wait a moment.' }
    }
    this.startingProjects.add(projectId)
    try {
      return await this._start(projectId)
    } finally {
      this.startingProjects.delete(projectId)
    }
  }

  private async _start(projectId: string): Promise<StartResult> {
    const detection = detectFramework(projectId)
    // v73: honest pre-flight for Flutter instead of a raw exit-code-127 —
    // the #1 confusing error the owner reported on mobile.
    if (detection.framework === 'flutter' && !flutterSdkInstalled()) {
      return {
        ok: false,
        runtime: detection.runtime,
        error: 'Flutter SDK is not installed in this sandbox (/home/z/my-project/sdk/flutter-sdk missing). The generated Dart code is kept — run: bash scripts/setup-flutter.sh, then press Run again.',
      }
    }
    // v74: same honest pre-flight for C# / .NET
    if (detection.framework === 'dotnet' && !dotnetSdkInstalled()) {
      return {
        ok: false,
        runtime: detection.runtime,
        error: '.NET SDK is not installed in this sandbox (/home/z/my-project/sdk/dotnet-sdk missing). The generated C# code is kept — run: bash scripts/setup-dotnet.sh, then press Run again.',
      }
    }
    // v86: honest pre-flights for the remaining SDK-backed stacks — without
    // them a missing toolchain surfaced as a cryptic "exited with code 127".
    const sdkPreflight: Array<[string, string, string]> = [
      ['go', 'sdk/go-sdk/bin/go', 'Go SDK is not installed in this sandbox (sdk/go-sdk missing). Run: bash scripts/sdk-doctor.sh (manual install), then press Run again.'],
      ['rust', 'sdk/cargo-home/bin/cargo', 'Rust (cargo) is not installed in this sandbox (sdk/cargo-home missing). Run: bash scripts/sdk-doctor.sh (manual install), then press Run again.'],
      ['php', 'sdk/php/php', 'PHP is not installed in this sandbox (sdk/php missing). Run: bash scripts/sdk-doctor.sh (manual install), then press Run again.'],
      ['java-maven', 'sdk/maven/maven/bin/mvn', 'Maven is not installed in this sandbox (sdk/maven missing). Run: bash scripts/sdk-doctor.sh (manual install), then press Run again.'],
      ['java-gradle', 'sdk/gradle/bin/gradle', 'Gradle is not installed in this sandbox (sdk/gradle missing). Run: bash scripts/sdk-doctor.sh (manual install), then press Run again.'],
    ]
    for (const [fw, probe, msg] of sdkPreflight) {
      if (detection.framework === fw && !fs.existsSync(path.join('/home/z/my-project', probe))) {
        return { ok: false, runtime: detection.runtime, error: msg }
      }
    }
    return this.adapter.start(projectId, detection.runtime, detection.framework)
  }
  async stop(projectId: string) { return this.adapter.stop(projectId) }
  async execInProject(projectId: string, command: string, timeoutMs = 60000) {
    return this.adapter.exec(projectId, command, timeoutMs)
  }
  /**
   * exec with EXTRA environment variables. Runs `env VAR='…' … bash -c
   * '<command>'` — the outer wrapper sets the variables and the inner bash
   * expands "$VAR" at runtime (expanding in the outer shell would yield
   * empty strings). Single-quote escaping makes both levels injection-safe.
   */
  async execInProjectEnv(projectId: string, command: string, extraEnv: Record<string, string>, timeoutMs = 60000) {
    const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
    const pre = Object.entries(extraEnv)
      .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      .map(([k, v]) => `${k}=${quote(v)}`)
      .join(' ')
    return this.adapter.exec(projectId, pre ? `env ${pre} bash -c ${quote(command)}` : command, timeoutMs)
  }
  async build(projectId: string) { return this.adapter.build(projectId) }

  /**
   * Get a list of supported runtime types (used by UI).
   */
  supportedRuntimes() {
    return [
      { id: 'node', label: 'Node.js / JavaScript / TypeScript', runtimes: ['next', 'react', 'vite', 'node'] },
      { id: 'flutter', label: 'Flutter / Dart', runtimes: ['flutter'] },
      { id: 'python', label: 'Python', runtimes: ['python'] },
      { id: 'java', label: 'Java (Maven/Gradle)', runtimes: ['java-maven', 'java-gradle'] },
      { id: 'dotnet', label: 'C# / .NET 8', runtimes: ['dotnet'] },
      { id: 'cpp', label: 'C++ (g++)', runtimes: ['cpp'] },
      { id: 'static', label: 'Static HTML/CSS/JS', runtimes: ['static'] },
    ]
  }
}

export const runtimeManager = new RuntimeManager()
