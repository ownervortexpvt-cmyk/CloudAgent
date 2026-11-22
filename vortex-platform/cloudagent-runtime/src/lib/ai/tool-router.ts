/**
 * Tool Router — v29 SPEED core.
 *
 * BEFORE: every model turn re-sent ~36,000 tokens of tool schemas (185+
 * tools) — the single biggest time-to-first-token cost of each turn.
 *
 * NOW: each run starts with the ~44 CORE tools (full schemas, everything an
 * active build loop needs) plus ONE meta-tool `more_tools` whose description
 * carries a compact catalog (name + one-line summary) of every other tool.
 * The model activates extras on demand; the run expands them in place.
 * Nothing is removed — every tool stays reachable, only the wire payload
 * gets smart.
 */
import { TOOLS, type ToolResult, type ProjectContext } from './tools'

/** Always loaded with full schemas — the everyday build loop. */
export const CORE_TOOL_NAMES = new Set<string>([
  // file surface
  'read_file', 'write_file', 'edit_file', 'delete_file', 'create_folder',
  'search_files', 'search_code', 'replace_in_files', 'inspect_project',
  // runtime & terminal
  'terminal', 'run_project', 'stop_project', 'restart_project', 'build_project', 'inspect_logs',
  // packages
  'install_package', 'install_sdk', 'update_dependencies',
  // git / github
  'git_status', 'git_diff', 'git_commit', 'git_push', 'git_pull', 'github_create_branch',
  // planning & swarm
  'architect', 'autonomous_dev', 'multi_agent', 'sub_agent_spawn',
  // quality loop
  'qa_squad', 'self_heal', 'screenshot_fix', 'convert_language', 'explain_error', 'explain_code',
  'lint_code', 'format_code', 'generate_tests',
  // assets & web
  'image_generate', 'logo_maker', 'web_search', 'http_request',
  // memory & safety
  'save_memory', 'recall_memory', 'snapshot', 'restore_snapshot', 'list_snapshots',
  // v73 FIX: auto API collection was INSTRUCTED ("call auto_collect_apis FIRST")
  // but lived OUTSIDE the core set — the model had to call more_tools first,
  // so it never did. Now it's core: "automatic API collect" actually happens.
  'auto_collect_apis', 'list_required_apis',
  // v142 — VORTEX ecosystem: backend auto-provision (auth+OTP / data / storage)
  'vortex_backend_provision',
])

/** One-line summary cache for the catalog text. */
let catalogCache: string | null = null

/** name — first sentence of the description, for every NON-core tool. */
export function toolCatalogText(): string {
  if (catalogCache) return catalogCache
  const lines: string[] = []
  for (const t of Object.values(TOOLS)) {
    if (!t || !t.name || CORE_TOOL_NAMES.has(t.name)) continue
    const first = String(t.description || '').split(/(?<=\.)\s/)[0] || ''
    lines.push(`- ${t.name}: ${first.slice(0, 110)}`)
  }
  catalogCache = lines.join('\n')
  return catalogCache
}

const MORE_TOOLS_DEF = {
  type: 'function' as const,
  function: {
    name: 'more_tools',
    description:
      `Load additional specialist tools on demand. Pass up to 12 tool names; their FULL schemas become available on your NEXT tool-call turn. ` +
      `Available specialist tools (name: summary):\n${toolCatalogText()}`,
    parameters: {
      type: 'object',
      properties: {
        names: { type: 'string', description: 'Comma-separated tool names to activate, e.g. "database_builder,payment_setup"' },
      },
      required: ['names'],
    },
  },
}

/** Core defs + the more_tools meta-tool. */
export function toolDefsCore() {
  const defs = Object.values(TOOLS)
    .filter(t => t && CORE_TOOL_NAMES.has(t.name))
    .map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  return [...defs, MORE_TOOLS_DEF as any]
}

/**
 * Expand the run's tool set in place with the requested specialist tools.
 * Returns the names that were actually added (deduped, must exist).
 */
export function expandToolSet(current: Map<string, any>, requestedNames: string[]): string[] {
  const added: string[] = []
  for (const raw of requestedNames.slice(0, 12)) {
    const name = String(raw || '').trim()
    if (!name || current.has(name) || !TOOLS[name]) continue
    current.set(name, {
      type: 'function' as const,
      function: { name: TOOLS[name].name, description: TOOLS[name].description, parameters: TOOLS[name].parameters },
    })
    added.push(name)
  }
  return added
}

/** Executor for the meta-tool (used when the agent loop delegates to executeTool). */
export async function executeMoreTools(args: any): Promise<ToolResult> {
  const names = String(args?.names || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (!names.length) return { ok: false, output: '', error: 'names required (comma-separated tool names)' }
  const known = names.filter((n: string) => !!TOOLS[n])
  const unknown = names.filter((n: string) => !TOOLS[n])
  return {
    ok: known.length > 0,
    output:
      (known.length ? `Activated with full schemas: ${known.join(', ')}. Call them like any other tool.` : 'No valid tool names.') +
      (unknown.length ? ` Unknown (not activated): ${unknown.join(', ')}.` : ''),
    data: { activated: known, unknown },
  }
}

/** Size report for tests/logs. */
export function toolPayloadStats() {
  const core = toolDefsCore()
  const all = Object.keys(TOOLS).length
  const bytes = (o: any) => Buffer.byteLength(JSON.stringify(o), 'utf8')
  return { coreCount: core.length, totalCount: all, coreBytes: bytes(core), fullBytes: bytes(toolDefsAllUnsafe()) }
}

function toolDefsAllUnsafe() {
  return Object.values(TOOLS).map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
