/**
 * Global Cloud Agent client state.
 * Stores the current view (welcome | dashboard), the active project, the
 * open editor tabs, and provider/runtime preferences.
 */
import { create } from 'zustand'

export interface ProjectMeta {
  id: string
  name: string
  description?: string | null
  framework?: string | null
  language?: string | null
  runtime?: string | null
  status?: string
  entryPort?: number | null
  lastOpenedAt?: string
  createdAt?: string
  updatedAt?: string // v62: trash shows when a project was soft-deleted
}

export type View = 'welcome' | 'dashboard' | 'settings'

export interface EditorTab {
  path: string
  name: string
  content: string
  dirty: boolean
  language?: string
}

interface AppState {
  view: View
  activeProject: ProjectMeta | null
  openTabs: EditorTab[]
  activeTabPath: string | null
  treeVersion: number
  aiAgentOpen: boolean
  terminalOpen: boolean
  settingsOpen: boolean
  settingsTabRequest: string // v119: one-shot deep-link (e.g. 'refer') consumed by SettingsDialog on mount/open
  providerManagerOpen: boolean
  publishDialogOpen: boolean
  exportDialogOpen: boolean
  githubPanelOpen: boolean
  secretsOpen: boolean
  developerModeOpen: boolean
  multiAgentOpen: boolean
  multiAgentPrompt: string // v58: one-shot prompt preset — history “Run again” fills the Army panel
  pendingChatPrompt: string // v63: one-shot prompt handoff — Prompt Library "Use in chat" survives welcome→project mounts (the old window event died when AgentPanel wasn't mounted yet)
  growthStudioOpen: boolean
  versionHistoryOpen: boolean // v60: editor time-travel dialog
  promptLibraryOpen: boolean // v62: reusable prompt library
  helpOpen: boolean // v62: getting-started / help dialog
  sdkManagerOpen: boolean // v79: SDK Manager — toolchain status + custom binary install
  marketOpen: boolean // v123: template marketplace dialog
  collabOpen: boolean // v123: collaboration (invite/peers) dialog
  notifications: RunNotification[] // v60: run-finished center (persisted)

  setView: (v: View) => void
  openProject: (p: ProjectMeta) => void
  closeProject: () => void
  restoreLastProject: () => void
  openTab: (tab: EditorTab) => void
  closeTab: (path: string) => void
  setActiveTab: (path: string | null) => void
  updateTabContent: (path: string, content: string, dirty?: boolean) => void
  markTabSaved: (path: string) => void
  markAllSaved: () => void
  bumpTree: () => void
  setAIAgentOpen: (b: boolean) => void
  setTerminalOpen: (b: boolean) => void
  setSettingsOpen: (b: boolean) => void
  setSettingsTabRequest: (t: string) => void
  setProviderManagerOpen: (b: boolean) => void
  setPublishDialogOpen: (b: boolean) => void
  setExportDialogOpen: (b: boolean) => void
  setGithubPanelOpen: (b: boolean) => void
  setSecretsOpen: (b: boolean) => void
  setDeveloperModeOpen: (b: boolean) => void
  setMultiAgentOpen: (b: boolean) => void
  setMultiAgentPrompt: (s: string) => void
  setPendingChatPrompt: (s: string) => void
  setGrowthStudioOpen: (b: boolean) => void
  setVersionHistoryOpen: (b: boolean) => void
  setPromptLibraryOpen: (b: boolean) => void
  setHelpOpen: (b: boolean) => void
  setSdkManagerOpen: (b: boolean) => void
  setMarketOpen: (b: boolean) => void
  setCollabOpen: (b: boolean) => void
  pushNotification: (n: Omit<RunNotification, 'id' | 'at' | 'read'>) => void
  markNotifsRead: () => void
  clearNotifs: () => void
}

/** v60 — one finished-run entry in the notification center. */
export interface RunNotification {
  id: string
  kind: 'single' | 'swarm'
  ok: boolean
  title: string
  detail: string
  at: number
  read: boolean
}

const NOTIFS_KEY = 'ca:notifs'
// v161 — remember the last open project so a page reload (flaky tunnel,
// mobile browser refresh, 502 auto-retry) doesn't dump the user back on the
// welcome screen — reported as "onek shomoy automatic back hoy".
const LAST_PROJECT_KEY = 'ca:lastProject'

function saveLastProject(p: ProjectMeta | null) {
  try {
    if (p) localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify(p))
    else localStorage.removeItem(LAST_PROJECT_KEY)
  } catch {}
}

function loadLastProject(): ProjectMeta | null {
  try {
    const raw = localStorage.getItem(LAST_PROJECT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p === 'object' && typeof p.id === 'string' ? p : null
  } catch { return null }
}

/** Persisted notification center — real run-finished events only. */
function loadNotifs(): RunNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.slice(0, 50) : []
  } catch { return [] }
}

function saveNotifs(list: RunNotification[]) {
  try { localStorage.setItem(NOTIFS_KEY, JSON.stringify(list.slice(0, 50))) } catch {}
}

export const useAppStore = create<AppState>((set) => ({
  view: 'welcome',
  activeProject: null,
  openTabs: [],
  activeTabPath: null,
  treeVersion: 0,
  aiAgentOpen: true,
  terminalOpen: false,
  settingsOpen: false,
  settingsTabRequest: '',
  providerManagerOpen: false,
  publishDialogOpen: false,
  exportDialogOpen: false,
  githubPanelOpen: false,
  secretsOpen: false,
  developerModeOpen: false,
  multiAgentOpen: false,
  multiAgentPrompt: '',
  pendingChatPrompt: '',
  growthStudioOpen: false,
  versionHistoryOpen: false,
  promptLibraryOpen: false,
  helpOpen: false,
  sdkManagerOpen: false,
  marketOpen: false,
  collabOpen: false,
  notifications: typeof window !== 'undefined' ? loadNotifs() : [],

  setView: (v) => set({ view: v }),
  // v161 — every open/close also updates the localStorage last-project record
  openProject: (p) => { saveLastProject(p); set({ view: 'dashboard', activeProject: p, openTabs: [], activeTabPath: null }) },
  closeProject: () => { saveLastProject(null); set({ view: 'welcome', activeProject: null, openTabs: [], activeTabPath: null }) },
  // v161 — re-open the last project after a reload (call once on app mount);
  // silently no-ops when nothing was saved.
  restoreLastProject: () => {
    const p = loadLastProject()
    if (p) set({ view: 'dashboard', activeProject: p })
  },
  openTab: (tab) => set((s) => {
    const exists = s.openTabs.find(t => t.path === tab.path)
    if (exists) return { activeTabPath: tab.path }
    return { openTabs: [...s.openTabs, tab], activeTabPath: tab.path }
  }),
  closeTab: (path) => set((s) => {
    const idx = s.openTabs.findIndex(t => t.path === path)
    const newTabs = s.openTabs.filter(t => t.path !== path)
    let newActive = s.activeTabPath
    if (s.activeTabPath === path) {
      newActive = newTabs.length ? newTabs[Math.max(0, idx - 1)].path : null
    }
    return { openTabs: newTabs, activeTabPath: newActive }
  }),
  setActiveTab: (path) => set({ activeTabPath: path }),
  updateTabContent: (path, content, dirty) => set((s) => ({
    openTabs: s.openTabs.map(t => t.path === path ? { ...t, content, dirty: dirty ?? true } : t),
  })),
  markTabSaved: (path) => set((s) => ({
    openTabs: s.openTabs.map(t => t.path === path ? { ...t, dirty: false } : t),
  })),
  markAllSaved: () => set((s) => ({
    openTabs: s.openTabs.map(t => ({ ...t, dirty: false })),
  })),
  bumpTree: () => set((s) => ({ treeVersion: s.treeVersion + 1 })),
  setAIAgentOpen: (b) => set({ aiAgentOpen: b }),
  setTerminalOpen: (b) => set({ terminalOpen: b }),
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setSettingsTabRequest: (t) => set({ settingsTabRequest: t }),
  setProviderManagerOpen: (b) => set({ providerManagerOpen: b }),
  setPublishDialogOpen: (b) => set({ publishDialogOpen: b }),
  setExportDialogOpen: (b) => set({ exportDialogOpen: b }),
  setGithubPanelOpen: (b) => set({ githubPanelOpen: b }),
  setSecretsOpen: (b) => set({ secretsOpen: b }),
  setDeveloperModeOpen: (b) => set({ developerModeOpen: b }),
  setMultiAgentOpen: (b) => set({ multiAgentOpen: b }),
  setMultiAgentPrompt: (s) => set({ multiAgentPrompt: s }),
  setPendingChatPrompt: (s) => set({ pendingChatPrompt: s }),
  setGrowthStudioOpen: (b) => set({ growthStudioOpen: b }),
  setVersionHistoryOpen: (b) => set({ versionHistoryOpen: b }),
  setPromptLibraryOpen: (b) => set({ promptLibraryOpen: b }),
  setHelpOpen: (b) => set({ helpOpen: b }),
  setSdkManagerOpen: (b) => set({ sdkManagerOpen: b }),
  setMarketOpen: (b) => set({ marketOpen: b }),
  setCollabOpen: (b) => set({ collabOpen: b }),
  pushNotification: (n) => set((s) => {
    const item: RunNotification = {
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      read: false,
      ...n,
    }
    const list = [item, ...s.notifications].slice(0, 50)
    saveNotifs(list)
    return { notifications: list }
  }),
  markNotifsRead: () => set((s) => {
    const list = s.notifications.map(n => ({ ...n, read: true }))
    saveNotifs(list)
    return { notifications: list }
  }),
  clearNotifs: () => { saveNotifs([]); set({ notifications: [] }) },
}))

/** Helper: language hint from file extension for Monaco. */
export function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': return 'typescript'
    case 'tsx': return 'typescript'
    case 'js': return 'javascript'
    case 'jsx': return 'javascript'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': return 'html'
    case 'md': return 'markdown'
    case 'py': return 'python'
    case 'dart': return 'dart'
    case 'yaml': case 'yml': return 'yaml'
    case 'xml': return 'xml'
    case 'java': return 'java'
    case 'gradle': return 'groovy'
    case 'toml': return 'toml'
    case 'sh': return 'shell'
    case 'sql': return 'sql'
    default: return 'plaintext'
  }
}
