'use client'

/**
 * v114 — SPEED REBUILD of the app shell.
 *
 * WHY: this page used to statically import the Dashboard AND all 12 dialogs,
 * which dragged ~1.7MB of JS (recharts, xterm, editors, swarm UI…) into the
 * welcome screen's critical path. On a real phone that meant 10-60s of
 * "the page looks ready but every button is dead" — hydration hadn't finished.
 *
 * NOW: only WelcomeView (the first screen) is critical; every dialog and the
 * Dashboard are split into lazy chunks that load on first open. A warm-up
 * preloads the common ones during browser idle time so first clicks stay
 * instant without blocking interaction.
 */
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { WelcomeView } from '@/components/cloud-agent/welcome/WelcomeView'
import { PlatformBanner } from '@/components/cloud-agent/PlatformBanner'

const lazyComponent = (loader: () => Promise<{ default: React.ComponentType<any> }>) =>
  dynamic(loader, { ssr: false })

// v127 — plan expiry renewal nudge (own client fetch; lazy like the dialogs)
const PlanExpiryBanner = lazyComponent(
  () => import('@/components/cloud-agent/PlanExpiryBanner')
)

const Dashboard = lazyComponent(
  () => import('@/components/cloud-agent/dashboard/Dashboard').then(m => ({ default: m.Dashboard }))
)
const ProviderManagerDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/ProviderManagerDialog').then(m => ({ default: m.ProviderManagerDialog }))
)
const PublishDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/PublishDialog').then(m => ({ default: m.PublishDialog }))
)
const ExportDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/ExportDialog').then(m => ({ default: m.ExportDialog }))
)
const GitHubPanel = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/GitHubPanel').then(m => ({ default: m.GitHubPanel }))
)
const MarketDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/MarketDialog').then(m => ({ default: m.MarketDialog }))
)
const CollabDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/CollabDialog').then(m => ({ default: m.CollabDialog }))
)
const SettingsDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/SettingsDialog').then(m => ({ default: m.SettingsDialog }))
)
const SecretsManagerDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/SecretsManagerDialog').then(m => ({ default: m.SecretsManagerDialog }))
)
const DeveloperModeDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/DeveloperModeDialog').then(m => ({ default: m.DeveloperModeDialog }))
)
const MultiAgentPanel = lazyComponent(
  () => import('@/components/cloud-agent/multiagent/MultiAgentPanel').then(m => ({ default: m.MultiAgentPanel }))
)
const GrowthStudioDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/GrowthStudioDialog').then(m => ({ default: m.GrowthStudioDialog }))
)
const PromptLibraryDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/PromptLibraryDialog').then(m => ({ default: m.PromptLibraryDialog }))
)
const HelpDialog = lazyComponent(
  () => import('@/components/cloud-agent/dialogs/HelpDialog').then(m => ({ default: m.HelpDialog }))
)
const CommandPalette = lazyComponent(
  () => import('@/components/cloud-agent/dashboard/CommandPalette').then(m => ({ default: m.CommandPalette }))
)

export default function Home() {
  const {
    view, activeProject,
    providerManagerOpen, publishDialogOpen, exportDialogOpen, githubPanelOpen, settingsOpen,
    secretsOpen, developerModeOpen, multiAgentOpen, growthStudioOpen,
    promptLibraryOpen, helpOpen, marketOpen, collabOpen,
  } = useAppStore()

  // v122 — useIdleAutoLock() REMOVED (owner request): the Settings Security
  // app-lock that auto-signed-out the whole builder is gone for good.

  // Apply persisted theme on first paint
  useEffect(() => {
    const t = localStorage.getItem('ca:theme') as 'dark' | 'light' | null
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(t || 'dark')
  }, [])

  // v161 — auto-reopen the last project after a reload, so a flaky tunnel /
  // mobile refresh doesn't dump a working user back on the welcome screen
  // ("onek shomoy automatic back hoy"). Only restores for a valid session —
  // signed-out visitors stay on welcome.
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((d) => { if (d?.ok) useAppStore.getState().restoreLastProject() })
      .catch(() => {})
  }, [])

  // v62: first-run getting-started — auto-open once on the welcome screen
  useEffect(() => {
    if (view !== 'welcome') return
    try {
      if (!localStorage.getItem('ca:helpSeen')) {
        useAppStore.getState().setHelpOpen(true)
        localStorage.setItem('ca:helpSeen', '1')
      }
    } catch {}
  }, [view])

  // v114 — warm the lazy chunks AFTER first paint so the first dialog open
  // doesn't wait on a cold network. Idle + 2.5s delay keeps interaction #1 fast.
  useEffect(() => {
    const warm = () => {
      void import('@/components/cloud-agent/dashboard/CommandPalette')
      void import('@/components/cloud-agent/dialogs/HelpDialog')
      void import('@/components/cloud-agent/dialogs/ProviderManagerDialog')
      void import('@/components/cloud-agent/dialogs/SettingsDialog')
    }
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 2500)
    return () => {
      if (w.requestIdleCallback) return
      clearTimeout(id as ReturnType<typeof setTimeout>)
    }
  }, [])

  return (
    <>
      <PlatformBanner />
      <PlanExpiryBanner />
      {view === 'welcome' && <WelcomeView />}
      {view === 'dashboard' && activeProject && <Dashboard project={activeProject} />}

      {providerManagerOpen && <ProviderManagerDialog />}
      {publishDialogOpen && activeProject && <PublishDialog projectId={activeProject.id} />}
      {exportDialogOpen && activeProject && (
        <ExportDialog projectId={activeProject.id} projectName={activeProject.name} />
      )}
      {githubPanelOpen && <GitHubPanel />}
      {marketOpen && <MarketDialog />}
      {collabOpen && activeProject && <CollabDialog />}
      {settingsOpen && <SettingsDialog />}
      {secretsOpen && <SecretsManagerDialog />}
      {developerModeOpen && <DeveloperModeDialog />}
      {multiAgentOpen && activeProject && (
        <MultiAgentPanel projectId={activeProject.id} projectName={activeProject.name} />
      )}
      {growthStudioOpen && activeProject && (
        <GrowthStudioDialog projectId={activeProject.id} projectName={activeProject.name} />
      )}
      {promptLibraryOpen && <PromptLibraryDialog />}
      {helpOpen && <HelpDialog />}

      <CommandPalette />
    </>
  )
}
