/**
 * Framework detection + runtime selection.
 *
 * Looks at well-known manifest files to decide which runtime adapter
 * should own a given project. Pure functions, easily testable.
 */
import { existsFile, readFile, listTree } from './storage'

export type Framework =
  | 'next'
  | 'react'
  | 'vite'
  | 'node'
  | 'flutter'
  | 'python'
  | 'go'
  | 'rust'
  | 'java-maven'
  | 'java-gradle'
  | 'php'
  | 'dotnet'
  | 'cpp'
  | 'static'
  | 'unknown'

export type Runtime = 'node' | 'flutter' | 'python' | 'go' | 'rust' | 'java' | 'php' | 'dotnet' | 'cpp' | 'static' | 'unknown'

export interface DetectionResult {
  framework: Framework
  runtime: Runtime
  language: string
  entry: string | null
  devCommand: string | null
  buildCommand: string | null
  outputDir: string | null
  previewPort: number | null
  signals: string[]
}

export function detectFramework(projectId: string): DetectionResult {
  const signals: string[] = []
  // pubspec.yaml → Flutter/Dart
  if (existsFile(projectId, 'pubspec.yaml')) {
    signals.push('pubspec.yaml')
    return {
      framework: 'flutter',
      runtime: 'flutter',
      language: 'dart',
      entry: 'lib/main.dart',
      devCommand: 'flutter run -d web-server --web-hostname=0.0.0.0 --web-port=${PORT}',
      buildCommand: 'flutter build web',
      outputDir: 'build/web',
      previewPort: null,
      signals,
    }
  }
  // requirements.txt / pyproject.toml → Python
  if (existsFile(projectId, 'requirements.txt') || existsFile(projectId, 'pyproject.toml')) {
    signals.push('requirements.txt/pyproject.toml')
    const isFastApi = existsFile(projectId, 'main.py') || existsFile(projectId, 'app.py')
    return {
      framework: 'python',
      runtime: 'python',
      language: 'py',
      entry: existsFile(projectId, 'main.py') ? 'main.py' : 'app.py',
      devCommand: 'python -m uvicorn main:app --port ${PORT}' + (isFastApi ? '' : ' || python main.py'),
      buildCommand: 'pip install -r requirements.txt',
      outputDir: null,
      previewPort: null,
      signals,
    }
  }

  // go.mod → Go
  if (existsFile(projectId, 'go.mod')) {
    signals.push('go.mod')
    return {
      framework: 'go',
      runtime: 'go',
      language: 'go',
      entry: 'main.go',
      devCommand: 'go run . 2>&1 || go run main.go',
      buildCommand: 'go build -o app .',
      outputDir: null,
      previewPort: null,
      signals,
    }
  }

  // Cargo.toml → Rust
  if (existsFile(projectId, 'Cargo.toml')) {
    signals.push('Cargo.toml')
    return {
      framework: 'rust',
      runtime: 'rust',
      language: 'rs',
      entry: 'src/main.rs',
      devCommand: 'cargo run 2>&1',
      buildCommand: 'cargo build --release',
      outputDir: 'target/release',
      previewPort: null,
      signals,
    }
  }

  // composer.json → PHP
  if (existsFile(projectId, 'composer.json')) {
    signals.push('composer.json')
    return {
      framework: 'php',
      runtime: 'php',
      language: 'php',
      entry: 'index.php',
      devCommand: 'php -S 0.0.0.0:${PORT} -t . 2>&1',
      buildCommand: 'composer install --no-dev',
      outputDir: null,
      previewPort: null,
      signals,
    }
  }
  // pom.xml → Maven/Java
  if (existsFile(projectId, 'pom.xml')) {
    signals.push('pom.xml')
    return {
      framework: 'java-maven',
      runtime: 'java',
      language: 'java',
      entry: null,
      devCommand: 'mvn spring-boot:run -Dserver.port=${PORT}',
      buildCommand: 'mvn package',
      outputDir: 'target',
      previewPort: null,
      signals,
    }
  }
  // build.gradle → Gradle/Java/Android
  if (existsFile(projectId, 'build.gradle') || existsFile(projectId, 'build.gradle.kts')) {
    signals.push('build.gradle')
    return {
      framework: 'java-gradle',
      runtime: 'java',
      language: 'java',
      entry: null,
      devCommand: './gradlew bootRun --args=--server.port=${PORT}',
      buildCommand: './gradlew build',
      outputDir: 'build/libs',
      previewPort: null,
      signals,
    }
  }
  // *.csproj → C# / .NET (first .csproj wins; nested server/ ones included)
  {
    let csproj: string | null = null
    try {
      const tree = listTree(projectId, '.')
      const walk = (node: any, prefix: string): string | null => {
        for (const c of node.children || []) {
          const p = prefix ? `${prefix}/${c.name}` : c.name
          if (c.type === 'file' && c.name.endsWith('.csproj')) return p
          if (c.type === 'dir') {
            const hit = walk(c, p)
            if (hit) return hit
          }
        }
        return null
      }
      csproj = walk(tree, '')
    } catch { csproj = null }
    if (csproj) {
      signals.push(csproj)
      return {
        framework: 'dotnet',
        runtime: 'dotnet',
        language: 'csharp',
        entry: csproj,
        // ASP.NET honors --urls; PORT env is read by the starter Program.cs
        devCommand: 'dotnet run --project <csproj-dir> --urls http://0.0.0.0:${PORT}',
        buildCommand: 'dotnet build',
        outputDir: 'bin',
        previewPort: null,
        signals,
      }
    }
  }
  // C++ — main.cpp (root or src/), CMakeLists.txt or Makefile
  if (
    existsFile(projectId, 'main.cpp') ||
    existsFile(projectId, 'src/main.cpp') ||
    existsFile(projectId, 'CMakeLists.txt') ||
    existsFile(projectId, 'Makefile')
  ) {
    const entry = existsFile(projectId, 'main.cpp') ? 'main.cpp' : existsFile(projectId, 'src/main.cpp') ? 'src/main.cpp' : null
    signals.push(entry || 'Makefile/CMakeLists.txt')
    return {
      framework: 'cpp',
      runtime: 'cpp',
      language: 'cpp',
      entry,
      // Compile once (cached by make/timestamp) then serve. `||` chain keeps
      // legacy single-file layouts working even without a Makefile.
      devCommand:
        '(make 2>/dev/null || g++ -std=c++17 -O2 -pthread main.cpp -o app 2>&1) && PORT=${PORT} ./app',
      buildCommand: 'make 2>/dev/null || g++ -std=c++17 -O2 -pthread main.cpp -o app',
      outputDir: null,
      previewPort: null,
      signals,
    }
  }
  // package.json → Node ecosystem
  if (existsFile(projectId, 'package.json')) {
    signals.push('package.json')
    // A code-gen platform frequently produces malformed/empty package.json
    // (mid-write snapshots, agent typos). JSON.parse('') and JSON.parse('{')
    // both THROW — which used to 500 the project dashboard, ZIP import and
    // every runtime start. Fall back to generic-node detection instead.
    let pkg: any = {}
    try {
      pkg = JSON.parse(readFile(projectId, 'package.json') || '{}')
    } catch {
      pkg = {}
    }
    if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) pkg = {}
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    if (deps.next || (pkg.scripts && pkg.scripts.dev && pkg.scripts.dev.includes('next'))) {
      signals.push('next dependency')
      return {
        framework: 'next',
        runtime: 'node',
        language: 'ts',
        entry: 'src/app/page.tsx',
        devCommand: 'next dev -p ${PORT}',
        buildCommand: 'next build',
        outputDir: '.next',
        previewPort: null,
        signals,
      }
    }
    if (deps.vite || (pkg.scripts && pkg.scripts.dev && pkg.scripts.dev.includes('vite'))) {
      signals.push('vite dependency')
      return {
        framework: 'vite',
        runtime: 'node',
        language: 'ts',
        entry: 'index.html',
        devCommand: 'vite --port ${PORT} --host',
        buildCommand: 'vite build',
        outputDir: 'dist',
        previewPort: null,
        signals,
      }
    }
    if (deps.react) {
      signals.push('react dependency')
      return {
        framework: 'react',
        runtime: 'node',
        language: 'ts',
        entry: 'src/App.tsx',
        devCommand: pkg.scripts?.dev || 'vite --port ${PORT}',
        buildCommand: pkg.scripts?.build || 'vite build',
        outputDir: 'dist',
        previewPort: null,
        signals,
      }
    }
    // Generic Node project
    return {
      framework: 'node',
      runtime: 'node',
      language: 'js',
      entry: pkg.main || 'index.js',
      devCommand: pkg.scripts?.dev || pkg.scripts?.start ? `${pkg.scripts.dev || pkg.scripts.start}` : `node ${pkg.main || 'index.js'}`,
      buildCommand: pkg.scripts?.build || null,
      outputDir: null,
      previewPort: null,
      signals,
    }
  }
  // Static fallback (index.html at root, in public/, or inside a single
  // app-named subfolder — models often write "swiftchat/index.html").
  if (existsFile(projectId, 'index.html')) {
    signals.push('index.html')
    return {
      framework: 'static',
      runtime: 'static',
      language: 'html',
      entry: 'index.html',
      devCommand: null,
      buildCommand: null,
      outputDir: '.',
      previewPort: null,
      signals,
    }
  }
  if (existsFile(projectId, 'public/index.html')) {
    signals.push('public/index.html')
    return {
      framework: 'static',
      runtime: 'static',
      language: 'html',
      entry: 'public/index.html',
      devCommand: 'python3 -m http.server ${PORT} --bind 0.0.0.0 --directory public',
      buildCommand: null,
      outputDir: 'public',
      previewPort: null,
      signals,
    }
  }
  // Single subfolder holding the whole app (no other HTML anywhere)
  try {
    const SKIP = new Set(['converted', 'cloned-app', 'assets', 'scripts', 'docs', '.cloud-agent'])
    const tree = listTree(projectId, '.')
    const subs = (tree.children || []).filter(c => c.type === 'dir' && !SKIP.has(c.name)).map(c => c.name)
    const candidates = subs.filter(d => existsFile(projectId, `${d}/index.html`))
    if (candidates.length === 1) {
      signals.push(`${candidates[0]}/index.html`)
      return {
        framework: 'static',
        runtime: 'static',
        language: 'html',
        entry: `${candidates[0]}/index.html`,
        devCommand: `python3 -m http.server ${'${PORT}'} --bind 0.0.0.0 --directory ${candidates[0]}`,
        buildCommand: null,
        outputDir: candidates[0],
        previewPort: null,
        signals,
      }
    }
  } catch { /* fall through to unknown */ }
  return {
    framework: 'unknown',
    runtime: 'unknown',
    language: 'unknown',
    entry: null,
    devCommand: null,
    buildCommand: null,
    outputDir: null,
    previewPort: null,
    signals,
  }
}

/**
 * Find a free TCP port for the dev server to listen on.
 */
export async function findFreePort(start = 4000, end = 4100): Promise<number> {
  const net = await import('net')
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > end) {
        reject(new Error('No free port in range'))
        return
      }
      const srv = net.createServer()
      srv.unref()
      srv.on('error', () => tryPort(port + 1))
      srv.listen(port, '127.0.0.1', () => {
        const actual = (srv.address() as any).port
        srv.close(() => resolve(actual))
      })
    }
    tryPort(start)
  })
}
