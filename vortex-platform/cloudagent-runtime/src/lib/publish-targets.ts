interface PublishTarget {
  id: string
  label: string
  format: string
  platform: string
  free: boolean
  icon: string
  /** 'build' = Cloud Agent builds an artifact; 'workflow' = guided store/desktop steps */
  mode?: 'build' | 'workflow'
  /** Grouping for the Publish dialog grid. */
  group: 'Web' | 'Android' | 'iOS' | 'Stores' | 'Desktop'
}

/**
 * IMPORTANT: every target with mode 'build' MUST be handled by
 * /api/publish (POST). Store targets (mode 'workflow') return guided
 * instructions. Targets not implemented anywhere must NOT be listed here —
 * dead buttons that 400 on click erode trust.
 *
 * The full shelf (v81 + v141 VORTEX ecosystem):
 * web + pwa + source-archive (build) · apk + aab (build, Flutter) ·
 * ipa-export (build — unsigned iOS kit for Mac/CI compile+sign) ·
 * exe-windows (build attempt for Electron) · macos-dmg + linux-appimage (workflow) ·
 * 9 store shelves (workflow; google-play upgrades itself to a REAL upload
 * when the operator connects a service account in Publish → Google Play) ·
 * vortex-website (build — deploys the site to the VORTEX WEBSITE platform) ·
 * appverse (build — uploads the APK to the APPVERSE store, review gate follows).
 */
export const PUBLISH_TARGETS: PublishTarget[] = [
  // ── Web (build) ────────────────────────────────────────────────────────
  // v157 — THE publish path (owner decision: no third-party platform, ever).
  // The platform itself IS the hosting — live at /sites/<slug>/ on its own URL.
  { id: 'self-host', label: 'Live INSIDE Vortex (Self-Host)', format: 'live URL', platform: 'Published INSIDE Vortex Cloud Agent — served by the platform itself at /sites/<slug>/, zero third-party', free: true, icon: '🏠', mode: 'build', group: 'Web' },
  { id: 'web', label: 'Web Build', format: '.zip', platform: 'Browser / static host', free: true, icon: '🌐', mode: 'build', group: 'Web' },
  { id: 'vortex-website', label: 'VORTEX Website', format: 'live URL', platform: 'VORTEX ecosystem — versioned deploy on your own platform', free: true, icon: '🌀', mode: 'build', group: 'Web' },
  { id: 'pwa', label: 'PWA Installable', format: '.zip', platform: 'Installable web app (manifest + service worker)', free: true, icon: '📲', mode: 'build', group: 'Web' },
  { id: 'source-archive', label: 'Source Archive', format: '.zip', platform: 'Full source code backup', free: true, icon: '🗄️', mode: 'build', group: 'Web' },

  // ── Android (build) ────────────────────────────────────────────────────
  { id: 'apk', label: 'Android APK', format: '.apk', platform: 'Android (Sideload)', free: true, icon: '🤖', mode: 'build', group: 'Android' },
  { id: 'aab', label: 'Android AAB', format: '.aab', platform: 'Google Play Store', free: true, icon: '▶️', mode: 'build', group: 'Android' },
  { id: 'appverse', label: 'APPVERSE', format: '.apk', platform: 'VORTEX APPVERSE store — upload + review gate + distribution', free: true, icon: '🛰️', mode: 'build', group: 'Android' },

  // ── iOS (build kit + workflow) ─────────────────────────────────────────
  { id: 'ipa-export', label: 'iOS Export Kit', format: '.zip', platform: 'Unsigned iOS build kit — compile + sign on any Mac/CI (Codemagic)', free: true, icon: '🍏', mode: 'build', group: 'iOS' },
  { id: 'app-store', label: 'App Store', format: '.ipa', platform: 'Apple', free: false, icon: '🍎', mode: 'workflow', group: 'iOS' },

  // ── Desktop (build + workflow) ─────────────────────────────────────────
  { id: 'exe-windows', label: 'Windows EXE', format: '.exe', platform: 'Windows desktop (Electron)', free: true, icon: '🪟', mode: 'build', group: 'Desktop' },
  { id: 'macos-dmg', label: 'macOS DMG', format: '.dmg', platform: 'macOS desktop', free: true, icon: '🖥️', mode: 'workflow', group: 'Desktop' },
  { id: 'linux-appimage', label: 'Linux AppImage', format: '.AppImage', platform: 'Linux desktop', free: true, icon: '🐧', mode: 'workflow', group: 'Desktop' },

  // ── Store shelves (workflow; google-play = real upload when connected) ─
  { id: 'google-play', label: 'Google Play', format: '.aab', platform: 'Google Play — direct upload with a service account', free: false, icon: '🎮', mode: 'workflow', group: 'Stores' },
  { id: 'galaxy-store', label: 'Galaxy Store', format: '.apk', platform: 'Samsung', free: false, icon: '📱', mode: 'workflow', group: 'Stores' },
  { id: 'appgallery', label: 'AppGallery', format: '.apk', platform: 'Huawei', free: false, icon: '🏬', mode: 'workflow', group: 'Stores' },
  { id: 'amazon-appstore', label: 'Amazon Appstore', format: '.apk', platform: 'Amazon', free: false, icon: '📦', mode: 'workflow', group: 'Stores' },
  { id: 'f-droid', label: 'F-Droid', format: '.apk', platform: 'F-Droid (FOSS)', free: true, icon: '🦌', mode: 'workflow', group: 'Stores' },
  { id: 'apkpure', label: 'APKPure', format: '.apk', platform: 'APKPure', free: true, icon: '🧪', mode: 'workflow', group: 'Stores' },
  { id: 'uptodown', label: 'Uptodown', format: '.apk', platform: 'Uptodown', free: true, icon: '⬇️', mode: 'workflow', group: 'Stores' },
  { id: 'microsoft-store', label: 'Microsoft Store', format: '.msix', platform: 'Windows Store', free: false, icon: '🏬', mode: 'workflow', group: 'Stores' },
]

export const PUBLISH_TARGET_IDS = PUBLISH_TARGETS.map(t => t.id)
