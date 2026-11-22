/**
 * v81 — Single source of truth for the 13 managed toolchains.
 *
 * Previously this registry lived inside /api/sdks/route.ts only; the v81
 * Add-Storage provisioning engine (lib/provision.ts) needs the same data
 * (probe paths, setup scripts, approximate install sizes for disk guards),
 * so it moved here. /api/sdks imports it too.
 */

export interface ManagedToolchain {
  name: string
  label: string
  /** path relative to /home/z/my-project — existence = installed */
  probe: string
  version: string
  /** scripts/setup-<name>.sh — idempotent, resumable (v79 wipe-proof) */
  setup: string
  /** rough installed size in MB — used by the provisioning disk guard */
  approxMb: number
}

export const MANAGED_TOOLCHAINS: ManagedToolchain[] = [
  { name: 'jdk',     label: 'JDK 17 (Temurin)',          probe: 'sdk/jdk-17/bin/javac',                        version: '17.0.20', setup: 'setup-jdk.sh',     approxMb: 330 },
  { name: 'flutter', label: 'Flutter SDK',               probe: 'sdk/flutter-sdk/bin/flutter',                 version: '3.50.0',  setup: 'setup-flutter.sh', approxMb: 2300 },
  { name: 'android', label: 'Android SDK + Build-Tools', probe: 'sdk/android-sdk/cmdline-tools/latest/bin/sdkmanager', version: '36.0.0', setup: 'setup-android.sh', approxMb: 2400 },
  { name: 'ndk',     label: 'Android NDK',               probe: 'sdk/android-sdk/ndk',                         version: 'r27c',    setup: 'setup-ndk.sh',     approxMb: 3000 },
  { name: 'dotnet',  label: '.NET SDK (Roslyn/NuGet/MSBuild/Runtime)', probe: 'sdk/dotnet-sdk/dotnet',         version: '8.0.425', setup: 'setup-dotnet.sh',  approxMb: 600 },
  { name: 'gradle',  label: 'Gradle',                    probe: 'sdk/gradle/bin/gradle',                       version: '8.12',    setup: 'setup-gradle.sh',  approxMb: 150 },
  { name: 'kotlin',  label: 'Kotlin compiler',           probe: 'sdk/kotlin/bin/kotlinc',                      version: '2.1.0',   setup: 'setup-kotlin.sh',  approxMb: 95 },
  { name: 'cmake',   label: 'CMake',                     probe: 'sdk/cmake/bin/cmake',                         version: '3.31.2',  setup: 'setup-cmake.sh',   approxMb: 180 },
  { name: 'ninja',   label: 'Ninja build tool',          probe: 'sdk/ninja/bin/ninja',                         version: '1.12.1',  setup: 'setup-ninja.sh',   approxMb: 2 },
  { name: 'go',      label: 'Go',                        probe: 'sdk/go-sdk/bin/go',                           version: '1.27.x',  setup: 'setup-go.sh',      approxMb: 290 },
  { name: 'php',     label: 'PHP CLI + Composer',        probe: 'sdk/php/php',                                 version: '8.5.x',   setup: 'setup-php.sh',     approxMb: 35 },
  { name: 'maven',   label: 'Maven',                     probe: 'sdk/maven/maven/bin/mvn',                     version: '3.9.16',  setup: 'setup-maven.sh',   approxMb: 12 },
  { name: 'rust',    label: 'Rust (rustup/cargo)',       probe: 'sdk/cargo-home/bin/cargo',                    version: '1.85',    setup: 'setup-rust.sh',    approxMb: 310 },
]

export function toolchainByName(name: string): ManagedToolchain | undefined {
  return MANAGED_TOOLCHAINS.find(t => t.name === name)
}
