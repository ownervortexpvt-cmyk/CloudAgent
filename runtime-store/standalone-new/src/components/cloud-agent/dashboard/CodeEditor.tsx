'use client'

import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react'
import { X, Circle, Loader2, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Eye, Code2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import { useAppStore } from '@/lib/store'

interface CodeEditorProps {
  projectId: string
}

interface Marker {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning' | 'info'
  source?: string
}

/** v63: the Settings → Editor tab (font size / word wrap / minimap) wrote
 *  localStorage keys NOTHING read — three dead controls. Now the editor
 *  actually boots from them and follows ca:settings-changed live. */
function readEditorPrefs() {
  if (typeof window === 'undefined') return { fontSize: 13, wordWrap: true, minimap: true }
  return {
    fontSize: parseInt(localStorage.getItem('ca:fontSize') || '13', 10) || 13,
    wordWrap: localStorage.getItem('ca:wordWrap') !== 'false',
    minimap: localStorage.getItem('ca:minimap') !== 'false',
  }
}

export function CodeEditor({ projectId }: CodeEditorProps) {
  const { openTabs, activeTabPath, setActiveTab, closeTab, updateTabContent } = useAppStore()
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const markerListenerRef = useRef<{ dispose: () => void } | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [showErrors, setShowErrors] = useState(true)
  const [saving, setSaving] = useState(false)
  // v62: markdown live preview (split view) for .md tabs
  const [mdPreview, setMdPreview] = useState(false)
  // v62: the editor theme follows the app theme (light mode used to leave
  // Monaco stuck in dark)
  const [editorTheme, setEditorTheme] = useState<'cloud-agent-dark' | 'cloud-agent-light'>(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('light') ? 'cloud-agent-light' : 'cloud-agent-dark')
  // v63: live editor preferences from the Settings → Editor tab
  const [editorPrefs, setEditorPrefs] = useState(readEditorPrefs)

  // v63: Settings → Editor writes fire ca:settings-changed — re-read here so
  // font size / word wrap / minimap apply to OPEN files immediately, not
  // "on the next file open" as the old dead controls claimed.
  useEffect(() => {
    const on = () => setEditorPrefs(readEditorPrefs())
    window.addEventListener('ca:settings-changed', on)
    return () => window.removeEventListener('ca:settings-changed', on)
  }, [])

  // Watch <html class> for dark/light flips and retune Monaco live
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const light = document.documentElement.classList.contains('light')
      setEditorTheme(light ? 'cloud-agent-light' : 'cloud-agent-dark')
      monacoRef.current?.editor.setTheme(light ? 'cloud-agent-light' : 'cloud-agent-dark')
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco
    editorRef.current = editor
    // Configure Monaco for the dark theme
    monaco.editor.defineTheme('cloud-agent-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5a6372', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f5b942' },
        { token: 'string', foreground: '8ec5c5' },
        { token: 'number', foreground: 'd4a464' },
        { token: 'type', foreground: '5ec8c8' },
        { token: 'function', foreground: 'e6c168' },
        { token: 'variable', foreground: 'cdd3df' },
      ],
      colors: {
        'editor.background': '#0a0e14',
        'editor.foreground': '#cdd3df',
        'editorLineNumber.foreground': '#3a3f4b',
        'editorLineNumber.activeForeground': '#7a808c',
        'editor.selectionBackground': '#2a3142',
        'editor.inactiveSelectionBackground': '#1f2430',
        'editorCursor.foreground': '#f5b942',
        'editor.lineHighlightBackground': '#11161e',
        'editorIndentGuide.background': '#1a1f2a',
        'editorIndentGuide.activeBackground': '#2a3142',
        'editorWidget.background': '#11161e',
        'editorWidget.border': '#1f2430',
        'editorSuggestWidget.background': '#11161e',
        'editorSuggestWidget.selectedBackground': '#1f2430',
        'input.background': '#11161e',
        'input.border': '#1f2430',
        'scrollbarSlider.background': '#2a314255',
        'scrollbarSlider.hoverBackground': '#3a415255',
      },
    })
    monaco.editor.setTheme('cloud-agent-dark')
    // v62: light theme — tuned to the app's light palette
    monaco.editor.defineTheme('cloud-agent-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'b45309' },
        { token: 'string', foreground: '0f766e' },
        { token: 'number', foreground: '9a3412' },
        { token: 'type', foreground: '0369a1' },
        { token: 'function', foreground: '7c3aed' },
        { token: 'variable', foreground: '1f2937' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1f2937',
        'editorLineNumber.foreground': '#9ca3af',
        'editorLineNumber.activeForeground': '#4b5563',
        'editor.selectionBackground': '#dbeafe',
        'editor.inactiveSelectionBackground': '#eff6ff',
        'editorCursor.foreground': '#b45309',
        'editor.lineHighlightBackground': '#f3f4f6',
        'editorIndentGuide.background': '#e5e7eb',
        'editorIndentGuide.activeBackground': '#d1d5db',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#e5e7eb',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.selectedBackground': '#eff6ff',
        'input.background': '#ffffff',
        'input.border': '#e5e7eb',
        'scrollbarSlider.background': '#d1d5db88',
        'scrollbarSlider.hoverBackground': '#9ca3af88',
      },
    })

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useAppStore.getState().activeTabPath
      if (path) {
        // Format code first, then save AFTER formatting completes so the
        // formatted result is what lands on disk.
        const fmt = editor.getAction('editor.action.formatDocument')?.run()
        Promise.resolve(fmt)
          .catch(() => {})
          .finally(() => saveNow(path))
      }
    })
    // Add command for search across project
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      window.dispatchEvent(new CustomEvent('ca:search-project'))
    })
    // Listen for marker changes (errors/warnings) and update our panel.
    // `onDidChangeMarkers` is a static method on `monaco.editor`, not on the
    // editor instance. Dispose the previous listener first — onMount re-runs
    // on every tab switch (Editor is keyed by path) and listeners accumulate.
    markerListenerRef.current?.dispose()
    markerListenerRef.current = monaco.editor.onDidChangeMarkers(() => {
      try {
        const model = editor.getModel()
        if (!model) return
        const uri = model.uri
        const ms = monaco.editor.getModelMarkers({ resource: uri })
        const mapped: Marker[] = (ms || []).map(m => ({
          line: m.startLineNumber,
          column: m.startColumn,
          message: m.message || '',
          severity: m.severity === monaco.MarkerSeverity.Error ? 'error' :
                    m.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'info',
          source: m.source,
        }))
        setMarkers(mapped)
      } catch {}
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      // Quick open - dispatch a custom event the parent can listen for
      window.dispatchEvent(new CustomEvent('ca:quick-open'))
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      const path = useAppStore.getState().activeTabPath
      if (path && editorRef.current) {
        const lineInput = prompt('Go to line:')
        if (lineInput) {
          const ln = parseInt(lineInput, 10)
          if (!isNaN(ln)) editorRef.current.revealLineInCenter(ln)
        }
      }
    })
  }

  // Auto-save with debounce
  function scheduleSave(path: string) {
    // v63: the Settings → General "Auto-save files" switch wrote
    // ca:autoSave which NOTHING read — the debounce ran unconditionally.
    // Off now really means manual: Ctrl+S or Save All (Ctrl+Shift+S).
    try { if (localStorage.getItem('ca:autoSave') === 'false') return } catch {}
    if (saveTimers.current[path]) clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(() => saveNow(path), 800)
  }

  /**
   * Save the current tab. ALWAYS reads fresh state via useAppStore.getState()
   * — reading the render-closure `openTabs` captured pre-edit content and both
   * wiped the user's edits (Ctrl+S wrote stale content back over the model)
   * and saved one keystroke behind (debounced auto-save).
   */
  async function saveNow(path: string) {
    const tab = useAppStore.getState().openTabs.find(t => t.path === path)
    if (!tab) return
    if (!tab.dirty) return // nothing to persist — avoids pointless PUTs
    const contentToSave = tab.content
    setSaving(true)
    try {
      const res = await fetch('/api/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path, content: contentToSave }),
      })
      if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`)
      // Only flip the dirty flag — never push content back into the store,
      // the model already has the latest text and a stale write would revert it.
      useAppStore.getState().markTabSaved(path)
    } catch (e) {
      console.error('save failed', e)
      toast.error('Could not save file — is the server running?')
    } finally {
      setSaving(false)
    }
  }

  // Clear markers when switching tabs (otherwise the problems panel shows
  // the previous file's errors until a new marker event fires).
  useEffect(() => {
    setMarkers([])
  }, [activeTabPath])

  // v62: markdown preview only makes sense for .md tabs — reset on switch
  useEffect(() => {
    const tab = useAppStore.getState().openTabs.find(t => t.path === activeTabPath)
    if (!tab || !tab.path.toLowerCase().endsWith('.md')) setMdPreview(false)
  }, [activeTabPath])

  // When the active tab changes, focus the editor
  useEffect(() => {
    if (editorRef.current && activeTabPath) {
      const model = editorRef.current.getModel()
      if (model) editorRef.current.focus()
    }
  }, [activeTabPath])

  if (openTabs.length === 0) {
    return (
      <div className="h-full grid place-items-center bg-background ca-grid-bg">
        <div className="text-center max-w-md px-6">
          <div className="mx-auto w-16 h-16 rounded-xl bg-primary/10 border border-primary/30 grid place-items-center mb-4">
            <svg viewBox="0 0 64 64" className="w-10 h-10">
              <path d="M14 22 L32 12 L50 22 L50 42 L32 52 L14 42 Z" stroke="currentColor" strokeWidth="2" fill="none" className="text-primary"/>
              <circle cx="32" cy="32" r="6" fill="currentColor" className="text-accent"/>
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Cloud Agent Editor</h3>
          <p className="text-sm text-muted-foreground">
            Open a file from the sidebar to start editing, or use the AI agent below to ask Cloud Agent to build something for you.
          </p>
          <div className="text-xs text-muted-foreground mt-6 space-y-1 text-left max-w-xs mx-auto">
            <div><kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">⌘P</kbd> Quick open file</div>
            <div><kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">⌘G</kbd> Go to line</div>
            <div><kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">⌘S</kbd> Save (auto-saves every 800ms)</div>
          </div>
        </div>
      </div>
    )
  }

  const activeTab = openTabs.find(t => t.path === activeTabPath)
  const isMd = !!activeTab && (activeTab.path || '').toLowerCase().endsWith('.md')

  // Editor options — extracted so the markdown split-view and the plain
  // editor share ONE truth (the old inline literal existed twice).
  // v63: font size / word wrap / minimap come from the Settings tab (live).
  const editorOptions = {
    fontSize: editorPrefs.fontSize,
    fontFamily: 'var(--font-geist-mono), Menlo, Consolas, monospace',
    minimap: { enabled: editorPrefs.minimap, scale: 1, renderCharacters: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth' as const,
    fontLigatures: true,
    padding: { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
    glyphMargin: true,
    tabSize: 2,
    automaticLayout: true,
    wordWrap: editorPrefs.wordWrap ? ('on' as const) : ('off' as const),
    wrappingIndent: 'indent' as const,
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestSelection: 'first' as const,
    // Format helpers
    formatOnPaste: true,
    formatOnType: true,
    // Multi-cursor support
    multiCursorModifier: 'ctrlCmd' as const,
    // Code folding
    folding: true,
    foldingStrategy: 'indentation' as const,
    showFoldingControls: 'always' as const,
    // Go-to-definition: open the editor directly instead of peek
    definitionLinkOpensInPeek: false,
    // Find/replace
    find: { addExtraSpaceOnTop: false, autoFindInSelection: 'never' as const, seedSearchStringFromSelection: 'always' as const },
    // Sticky scroll
    stickyScroll: { enabled: true },
    // Inline suggestions
    inlineSuggest: { enabled: true },
    // Bracket pair guides + colorization (declared once — duplicate
    // keys silently shadowed earlier values)
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true, bracketPairsHorizontal: true },
    // Code lens
    codeLens: true,
    // Auto-indent & auto-closing
    autoIndent: 'full' as const,
    autoClosingBrackets: 'always' as const,
    autoClosingQuotes: 'always' as const,
    autoSurround: 'languageDefined' as const,
    // Linked editing (rename tag in HTML)
    linkedEditing: true,
    // Snippet suggestions
    snippetSuggestions: 'inline' as const,
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tabs */}
      <div className="flex items-stretch border-b border-border bg-card/30 overflow-x-auto">
        {openTabs.map(tab => {
          const isActive = tab.path === activeTabPath
          return (
            <div
              key={tab.path}
              className={`group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-border whitespace-nowrap ${isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50'}`}
              onClick={() => setActiveTab(tab.path)}
            >
              {tab.dirty && <Circle className="w-2 h-2 fill-primary text-primary" />}
              <span className="truncate max-w-[160px]">{tab.name}</span>
              <button
                className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path) }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {/* v62: markdown live-preview toggle — only for .md tabs */}
        {isMd && (
          <div className="ml-auto flex items-center px-2 shrink-0">
            <Button
              size="sm" variant={mdPreview ? 'default' : 'ghost'}
              className="h-6 px-2 text-[10px]"
              onClick={() => setMdPreview(p => !p)}
              title="Toggle rendered markdown preview"
            >
              {mdPreview ? <><Code2 className="w-3 h-3 mr-1" />Source</> : <><Eye className="w-3 h-3 mr-1" />Preview</>}
            </Button>
          </div>
        )}
      </div>
      {/* Editor */}
      <div className="flex-1 min-h-0 relative">
        {activeTab && isMd && mdPreview ? (
          <div className="h-full flex flex-col sm:flex-row">
            <div className="flex-1 min-h-0 sm:border-r border-b sm:border-b-0 border-border">
              <Editor
                key={activeTab.path}
                height="100%"
                path={activeTab.path}
                language={activeTab.language}
                defaultValue={activeTab.content}
                value={activeTab.content}
                theme={editorTheme}
                onMount={onMount}
                onChange={(value) => {
                  if (!activeTab) return
                  updateTabContent(activeTab.path, value || '', true)
                  scheduleSave(activeTab.path)
                }}
                loading={
                  <div className="grid place-items-center h-full bg-background">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-xs">Loading editor…</span>
                    </div>
                  </div>
                }
                options={{ ...editorOptions, minimap: { enabled: false } }}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 prose prose-sm prose-invert max-w-none [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
              <ReactMarkdown>{activeTab.content}</ReactMarkdown>
            </div>
          </div>
        ) : activeTab ? (
          <Editor
            key={activeTab.path}
            height="100%"
            path={activeTab.path}
            language={activeTab.language}
            defaultValue={activeTab.content}
            value={activeTab.content}
            theme={editorTheme}
            onMount={onMount}
            onChange={(value) => {
              if (!activeTab) return
              updateTabContent(activeTab.path, value || '', true)
              scheduleSave(activeTab.path)
            }}
            loading={
              <div className="grid place-items-center h-full bg-background">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-xs">Loading editor…</span>
                </div>
              </div>
            }
            options={editorOptions}
          />
        ) : null}
      </div>

      {/* Error/warning panel — shows all Monaco markers with line/column/message.
          Toggleable via the chevron button. Click a marker to jump to it. */}
      {activeTab && markers.length > 0 && (
        <div className="border-t border-border bg-card/30 shrink-0" style={{ maxHeight: '30%' }}>
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b border-border cursor-pointer hover:bg-muted/30"
            onClick={() => setShowErrors(!showErrors)}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs font-medium text-red-500">
                  {markers.filter(m => m.severity === 'error').length} errors
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                <span className="text-xs font-medium text-yellow-500">
                  {markers.filter(m => m.severity === 'warning').length} warnings
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">{activeTabPath?.split('/').pop()}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-5 w-5">
              {showErrors ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </Button>
          </div>
          {showErrors && (
            <div className="overflow-y-auto" style={{ maxHeight: '150px' }}>
              {markers.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-3 py-1 text-xs hover:bg-muted/30 cursor-pointer border-b border-border/50"
                  onClick={() => {
                    if (editorRef.current) {
                      editorRef.current.revealLineInCenter(m.line)
                      editorRef.current.setPosition({ lineNumber: m.line, column: m.column })
                      editorRef.current.focus()
                    }
                  }}
                >
                  {m.severity === 'error' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />
                  )}
                  <span className="text-muted-foreground font-mono shrink-0">
                    {m.line}:{m.column}
                  </span>
                  <span className={`truncate ${m.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                    {m.message}
                  </span>
                  {m.source && (
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {m.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
