/**
 * v116 — MAINTENANCE screen (control-room kill-switch target).
 * The middleware rewrites every non-bypassed path here while the owner's
 * maintenance flag is on. Static, zero data, zero platform details —
 * it must look intentional, not broken.
 *
 * v117.2 — OWNER SELF-HEAL: the owner flipped his own kill-switch while
 * exploring the Control tab and then reported the screen as a bug ("Ei bug
 * ta ki — We'll be right back"). If an ADMIN session is viewing this page,
 * it now shows a one-tap "Turn maintenance off" control (the /api/auth and
 * /api/admin bypasses keep both calls alive during maintenance). Everyone
 * else sees exactly the same intentional static screen as before.
 */
export const dynamic = 'force-static'

import MaintenanceClient from './maintenance-client'

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-[#08080a] text-zinc-300 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="text-5xl" aria-hidden>🛠️</div>
        <h1 className="text-xl font-semibold text-zinc-100 font-mono tracking-tight">
          We&apos;ll be right back
        </h1>
        <p className="text-sm text-zinc-500 leading-relaxed">
          CloudAgent is getting a quick upgrade to serve you better.
          Everything you build is safe — sign-in, your apps and payments
          will be back within minutes.
        </p>
        <MaintenanceClient />
        <div className="text-[11px] font-mono text-zinc-600 pt-2">
          CloudAgent · AI app builder for India
        </div>
      </div>
    </div>
  )
}
