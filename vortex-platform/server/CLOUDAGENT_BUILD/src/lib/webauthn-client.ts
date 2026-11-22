/**
 * Browser-side WebAuthn helpers for the owner lock (no Node imports).
 * Wraps navigator.credentials with base64url conversion.
 */

export function b64uToBuf(s: string): ArrayBuffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

export function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
}

/**
 * True when the app runs inside a cross-origin iframe (embedded preview).
 * Best-effort: browsers throw on cross-origin window.top access — that throw
 * itself proves we are framed.
 */
export function isEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/**
 * Browsers refuse WebAuthn inside cross-origin frames unless the PARENT page
 * grants `publickey-credentials-create` / `-get` via its Permissions Policy
 * ("The 'publickey-credentials-create' feature is not enabled in this
 * document…"). We cannot change the parent's iframe attributes, so detect
 * this exact failure and guide the user to the standalone-tab flow instead.
 */
export function isFramePermissionError(msg: string): boolean {
  return /publickey-credentials|Permissions Policy|cross-origin child frames|not enabled in this document/i.test(msg || '')
}

// ─── v30 — in-app browser / WebView environment detection ────────────────────
//
// Fingerprint (WebAuthn) does not only fail inside cross-origin IFRAMES — it
// is equally impossible inside in-app browsers and WebViews (Instagram,
// Facebook, WhatsApp, LINE, TikTok… built-in browsers, Android WebView,
// iOS WKWebView). These environments look "top-level" to isEmbeddedIframe()
// and Chromium-based ones even expose window.PublicKeyCredential, so the old
// checks showed "supported" and every attempt died with a raw NotAllowedError
// ("Passkey setup cancelled") — the exact "lock kaj korsena" report.
// Detection below reads the UA at CALL time (test-shimmable), classifies the
// environment honestly, and openStandaloneTab() gives the user a real path
// into an environment where fingerprint DOES work (Chrome / Safari / PWA).

const IN_APP_SIGNATURES: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/FBAV\/|FBAN\/|FBIOS|FB_IAB/i, 'Facebook'],
  [/WhatsApp/i, 'WhatsApp'],
  [/\bLine\/(\d+)/i, 'LINE'],
  [/LinkedIn/i, 'LinkedIn'],
  [/Snapchat/i, 'Snapchat'],
  [/Musical_Ly|TikTok|Bytedance|trill/i, 'TikTok'],
  [/TwitterAndroid|Twitter for iPhone/i, 'X (Twitter)'],
  [/\bGSA\/|GmailApp/i, 'Google app'],
  [/Viber/i, 'Viber'],
  [/Messenger/i, 'Messenger'],
  [/Telegram-(iOS|Android|Desktop)/i, 'Telegram'],
]

/** Human name of the in-app browser / webview we are running inside — null in a real browser. */
export function inAppBrowserName(ua?: string): string | null {
  if (typeof navigator === 'undefined') return null
  const u = ua || navigator.userAgent || ''
  for (const [re, name] of IN_APP_SIGNATURES) {
    if (re.test(u)) return `${name} in-app browser`
  }
  // Android WebView: Chrome UA + "; wv)" marker (real Chrome never has it)
  if (/;\s*wv\)/.test(u) && /Chrome\//.test(u)) return 'Android WebView'
  // iOS WKWebView: AppleWebKit + Mobile/ but NO "Version/" (real Safari has it;
  // third-party iOS browsers ship CriOS/FxiOS/EdgiOS markers instead)
  if (/iPhone|iPad|iPod/.test(u) && /AppleWebKit/.test(u) && !/Version\//.test(u) && !/CriOS|FxiOS|EdgiOS|OPiOS|Mercury/.test(u)) {
    return 'iOS in-app browser (WKWebView)'
  }
  return null
}

export function isInAppBrowser(ua?: string): boolean {
  return inAppBrowserName(ua) !== null
}

/**
 * Why passkeys cannot run in THIS environment — null when they can.
 * Order matters: in-app browsers/webviews are top-level (the iframe check
 * alone misses them), so they are classified first.
 */
export function passkeyEnvironmentIssue(): string | null {
  const app = inAppBrowserName()
  if (app) return app
  if (typeof window !== 'undefined') {
    try {
      if (window.self !== window.top) return 'Embedded preview iframe'
    } catch {
      return 'Embedded preview iframe'
    }
  }
  if (!passkeySupported()) return 'Browser without passkey support'
  return null
}

/**
 * Escape hatch into an environment where fingerprint works.
 *  - Android: intent:// URL targeted at Chrome (falls back to the default
 *    browser when Chrome is absent) — in-app browsers routinely BLOCK
 *    window.open, and plain navigation keeps us trapped in the webview.
 *  - Everywhere else: normal new tab.
 * Returns what happened so the UI can offer "Copy link" on failure.
 */
export function openStandaloneTab(): 'chrome-intent' | 'new-tab' | 'failed' {
  if (typeof window === 'undefined') return 'failed'
  const target = window.location.origin + '/'
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  if (/Android/.test(ua)) {
    try {
      const withoutScheme = target.replace(/^https?:\/\//, '')
      const fallback = encodeURIComponent(target)
      window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`
      return 'chrome-intent'
    } catch { /* fall through to the generic path */ }
  }
  try {
    const w = window.open(target, '_blank', 'noopener')
    if (w) return 'new-tab'
  } catch { /* popup blocked */ }
  return 'failed'
}

/** Copy the builder URL so the user can paste it into Chrome/Safari manually. */
export async function copyCurrentLink(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const url = window.location.origin + '/'
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = url
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** Register a new passkey. Returns the payload for POST /api/lock/passkey register. */
export async function createPasskey(options: Record<string, unknown>): Promise<Record<string, string>> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: options.rp as { name: string; id?: string },
      user: {
        id: b64uToBuf((options.user as { id: string }).id),
        name: (options.user as { name: string }).name,
        displayName: (options.user as { displayName: string }).displayName,
      },
      challenge: b64uToBuf(options.challenge as string),
      pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
      authenticatorSelection: options.authenticatorSelection as Record<string, unknown>,
      attestation: (options.attestation as 'none') || 'none',
      timeout: (options.timeout as number) || 180000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey creation cancelled')
  const resp = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    clientDataJSON: bufToB64u(resp.clientDataJSON),
    attestationObject: bufToB64u(resp.attestationObject),
  }
}

/** Request an assertion from an enrolled passkey. Payload for POST auth. */
export async function getPasskeyAssertion(options: Record<string, unknown>): Promise<Record<string, string>> {
  const allow = ((options.allowCredentials as { id: string; transports?: string[] }[]) || []).map(c => ({
    type: 'public-key' as const,
    id: b64uToBuf(c.id),
  }))
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64uToBuf(options.challenge as string),
      rpId: options.rpId as string,
      allowCredentials: allow,
      userVerification: (options.userVerification as UserVerificationRequirement) || 'required',
      timeout: (options.timeout as number) || 180000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey prompt cancelled')
  const resp = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    clientDataJSON: bufToB64u(resp.clientDataJSON),
    authenticatorData: bufToB64u(resp.authenticatorData),
    signature: bufToB64u(resp.signature),
    userHandle: resp.userHandle ? bufToB64u(resp.userHandle) : '',
  }
}
