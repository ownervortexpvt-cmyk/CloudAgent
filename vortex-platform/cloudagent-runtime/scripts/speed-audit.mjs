/**
 * Speed audit — measures the real per-turn payload weights that dominate
 * time-to-first-token: tool definitions JSON, system prompt, and how they
 * scale across a run (they are re-sent EVERY turn).
 */
const { TOOLS, toolDefsForModel } = await import('../src/lib/ai/tools.ts').catch(() => ({}))

// tools.ts is TS — compile-free rough parse instead: count via regex on the defs builder
import fs from 'fs'
const src = fs.readFileSync('/home/z/my-project/src/lib/ai/tools.ts', 'utf8')

// Count tool defs + rough schema weight
const defMatches = [...src.matchAll(/^  ([a-z_0-9]+): \{$/gm)].map(m => m[1])
console.log('tool definition entries in tools.ts (approx):', defMatches.length)

const agent = fs.readFileSync('/home/z/my-project/src/lib/ai/agent.ts', 'utf8')
const sysStart = agent.indexOf('function buildSystemPrompt')
const sysEnd = agent.indexOf('function ', sysStart + 10)
const sysFn = agent.slice(sysStart, sysEnd)
console.log('buildSystemPrompt function size:', sysFn.length, 'chars ≈', Math.round(sysFn.length / 4), 'tokens')

// Tool description weight: extract all description: '...' strings from tools.ts
const descs = [...src.matchAll(/description:\s*['"`]([\s\S]*?)['"`],?\n/gm)].map(m => m[1])
const descChars = descs.reduce((n, d) => n + d.length, 0)
console.log('total tool description chars:', descChars, '≈', Math.round(descChars / 4), 'tokens (sent EVERY turn)')
console.log('tool count with descriptions:', descs.length)

// Average params schema weight
const paramBlocks = [...src.matchAll(/parameters:\s*\{[\s\S]*?\n    \},\n/gm)].map(m => m[0])
const paramChars = paramBlocks.reduce((n, p) => n + p.length, 0)
console.log('parameters schema chars (rough):', paramChars, '≈', Math.round(paramChars / 4), 'tokens')

// pack files add more tools
let packChars = 0, packTools = 0
for (const f of ['v3-tools', 'v4-tools', 'v5-tools', 'v6-tools', 'v24-tools', 'v26-tools', 'v27-tools', 'v28-tools', 'enterprise-tools', 'auto-api-tools']) {
  const s = fs.readFileSync(`/home/z/my-project/src/lib/ai/${f}.ts`, 'utf8')
  const d = [...s.matchAll(/description:\s*['"`]([\s\S]*?)['"`],?\n/gm)].map(m => m[1])
  const c = d.reduce((n, x) => n + x.length, 0)
  packTools += d.length
  packChars += c
  console.log(`  ${f}: ${d.length} descs, ${Math.round(c / 4)} tokens`)
}
console.log('packs total:', packTools, 'descs ≈', Math.round(packChars / 4), 'tokens')
console.log('GRAND TOTAL tool text ≈', Math.round((descChars + packChars) / 4), 'tokens re-sent EVERY model turn')
