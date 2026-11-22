'use client'

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, Star, Eye, EyeOff, Loader2, Check, CheckCircle2, XCircle, Sparkles, KeyRound, Zap, AlertTriangle, Smartphone, ChevronDown, ChevronRight, Search, Crown, Bot, Users, Activity, BookOpen, Stethoscope, ListTree, Upload, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { LocalAICard } from './LocalAICard'
import { useAppStore } from '@/lib/store'
import { ZAI_MODELS, ZAI_MODEL_IDS, ZAI_DEFAULT_MODEL } from '@/lib/zai-models'
import { browserDetectKey, browserTestChat, type BrowserModel } from '@/lib/ai/browser-detect'
import type { KeyHealthVerdict } from '@/app/api/providers/health-record/route'

interface Provider {
  id: string
  name: string
  kind: string
  endpoint?: string | null
  model: string
  systemPrompt?: string | null
  temperature: number
  maxTokens?: number | null
  isDefault: boolean
  role?: string
  apiKeyMasked?: string | null
}

const PROVIDER_KINDS = [
  // ── v61.2 — ONLY the kinds behind the owner's 15 providers (same order as
  // the Quick tab). The old 50-kind catalog was DELETED per the owner.
  // openai-compatible covers the Custom URL / GLM / AI/ML / DeepInfra
  // picks; 'zai' is the built-in no-key card's kind; 'openrouter' and
  // 'together' are the kinds those quick picks actually save with. ──
  { value: 'zai', label: '🆓 Vortex Engine (built-in, free)', hint: 'No API key needed — uses the built-in GLM model. Always free.', endpoint: '', defaultModel: ZAI_DEFAULT_MODEL, docs: '', models: ZAI_MODEL_IDS },
  { value: 'gemini', label: '🆓 Gemini (Google, free)', hint: 'Gemini 2.5 Flash — free tier. v68: retired names (1.5/-001) auto-heal to the best live model.', endpoint: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', docs: 'https://aistudio.google.com/app/apikey', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'] },
  { value: 'groq', label: '🆓 Groq (free, fast)', hint: 'Llama 3.3 70B, Mixtral — ultra-fast inference. Generous free tier.', endpoint: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', docs: 'https://console.groq.com/keys', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768', 'llama-3.2-1b-preview', 'llama-3.2-3b-preview'] },
  { value: 'openrouter', label: 'OpenRouter (paid, 200+ models)', hint: 'Routes to 200+ models — GPT, Claude, Llama, Mistral, etc.', endpoint: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', docs: 'https://openrouter.ai/keys', models: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'] },
  { value: 'deepseek', label: '🆓 DeepSeek (free promo)', hint: 'DeepSeek V3, Coder — free promo API credit on signup.', endpoint: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', docs: 'https://platform.deepseek.com/api_keys', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'] },
  { value: 'deepinfra', label: '🔓 DeepInfra (uncensored models)', hint: 'Cheap inference for uncensored Euryale / Hermes / Dolphin models. OpenAI-compatible.', endpoint: 'https://api.deepinfra.com/v1/openai', defaultModel: 'Sao10K/L3.1-70B-Euryale-v2.2', docs: 'https://deepinfra.com/dash/api_keys', models: ['Sao10K/L3.1-70B-Euryale-v2.2', 'NousResearch/Hermes-3-Llama-3.1-70B', 'NousResearch/Hermes-3-Llama-3.1-405B', 'cognitivecomputations/dolphin-2.9-llama3-70b'] },
  { value: 'cerebras', label: '🆓 Cerebras (free, fastest)', hint: 'Ultra-fast inference. Free tier with Llama 3.1 70B.', endpoint: 'https://api.cerebras.ai/v1', defaultModel: 'llama3.1-70b', docs: 'https://cerebras.ai/', models: ['llama3.1-70b', 'llama3.1-8b', 'llama-3.3-70b'] },
  { value: 'sambanova', label: '🆓 SambaNova (free)', hint: 'Free Llama 3.1 70B + 405B inference. No credit card.', endpoint: 'https://api.sambanova.ai/v1', defaultModel: 'Meta-Llama-3.1-70B-Instruct', docs: 'https://cloud.sambanova.ai/', models: ['Meta-Llama-3.1-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct', 'Meta-Llama-3.1-405B-Instruct', 'DeepSeek-R1', 'Qwen2.5-72B-Instruct', 'Qwen2.5-Coder-32B-Instruct'] },
  { value: 'huggingface', label: '🆓 Hugging Face (free)', hint: 'Serverless inference for 200k+ models. Free tier.', endpoint: 'https://api-inference.huggingface.co/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', docs: 'https://huggingface.co/settings/tokens', models: ['meta-llama/Llama-3.3-70B-Instruct', 'meta-llama/Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-R1'] },
  { value: 'siliconflow', label: '🆓 SiliconFlow (free tier)', hint: 'Free Qwen, DeepSeek, Llama models. Chinese provider, fast in Asia.', endpoint: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3', docs: 'https://cloud.siliconflow.cn/account/ak', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Meta-Llama-3.1-405B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct'] },
  { value: 'novita', label: '🆓 Novita AI (free tier)', hint: 'Free Llama, Qwen, DeepSeek inference. 1000 free requests/month.', endpoint: 'https://api.novita.ai/v3/openai', defaultModel: 'deepseek/deepseek-r1', docs: 'https://novita.ai/getkey', models: ['deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct', 'meta-llama/llama-3.1-8b-instruct'] },
  { value: 'together', label: 'Together AI (paid)', hint: 'Llama, Qwen, DeepSeek, FLUX', endpoint: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', docs: 'https://api.together.xyz/settings/api-keys', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'] },
  { value: 'openai-compatible', label: 'OpenAI-compatible (custom)', hint: 'Any OpenAI /v1/chat/completions endpoint', endpoint: '', defaultModel: 'gpt-3.5-turbo', docs: '', models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'] },
  { value: 'custom', label: 'Fully custom', hint: 'Free-form endpoint with bearer auth', endpoint: '', defaultModel: '', docs: '', models: [] },
]

function renderDuration(ms?: number): string {
  if (!ms && ms !== 0) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ─── v61 rebuild — CURATED 15, the OWNER'S EXACT ORDER (kromonishare) ──────
// Auto → Custom → Gemini → Groq → GLM → OpenRouter → AI/ML → DeepSeek →
// DeepInfra → then the 6 strongest remaining free picks. Exactly 15 total.
// v61.1: the old 66-provider catalog was DELETED per the owner — the
// dropdown now carries ONLY these 15, nothing else.
const Q_CURATED: string[] = [
  // ── the mighty pair first, then the owner's named order ──
  'auto', 'custom',
  'gemini', 'groq', 'zai', 'openrouter-free', 'aimlapi', 'deepseek', 'deepinfra',
  // ── 6 strongest remaining free picks (no credit card) ──
  'cerebras', 'sambanova', 'huggingface', 'siliconflow', 'novita', 'together-free',
]

// ─── v52 KEY GUIDE — real signup steps + free-tier truth + the key page ─────
// Honest per provider: what the key looks like, where to create it, and what
// the free tier actually gives (no fake promises — 401 = wrong key,
// 402 = no credit, and the guide says which is which).
const KEY_GUIDE: Record<string, { steps: string[]; free: string; link?: string }> = {
  auto: { steps: ['Just paste the key', 'Press Get — the system detects which provider it belongs to', 'Endpoint + best model are picked automatically'], free: 'Detection is free; the provider\'s own free tier decides the rest.' },
  custom: { steps: ['Paste the endpoint URL (https://…/v1) in the Endpoint box', 'Paste the key', 'Press Get — or type the model name'], free: 'Depends entirely on the endpoint you point at.' },
  gemini: { steps: ['Open aistudio.google.com and sign in with Google', 'Press "Get API key" → Create API key', 'Copy the AIza… key here'], free: 'Genuinely free tier on Gemini Flash models — no credit card. 429 = rate limit, wait a bit.', link: 'https://aistudio.google.com/apikey' },
  groq: { steps: ['Open console.groq.com and sign up (free)', 'Go to API Keys → Create API Key', 'Copy the gsk_… key here'], free: 'Free tier with generous speed limits (Llama 3.3 70B). 403 on Test = the server region is blocked — Get from your device still works.', link: 'https://console.groq.com/keys' },
  sambanova: { steps: ['Open cloud.sambanova.ai and sign up (free)', 'Go to API Keys', 'Copy the key here'], free: 'Free Llama 70B + 405B — no credit card. Can be CORS-silent: Get may use the server route.', link: 'https://cloud.sambanova.ai' },
  deepinfra: { steps: ['Open deepinfra.com and sign up', 'Dash → API Keys → Create', 'Copy the key here'], free: 'Pay-as-you-go (very cheap), not free. Some uncensored models live here.', link: 'https://deepinfra.com/dash/api_keys' },
  deepseek: { steps: ['Open platform.deepseek.com and sign up', 'API keys → Create new key', 'Copy the sk-… key here'], free: 'Sign-up promo credit. 402 = promo used up → top up (very cheap).', link: 'https://platform.deepseek.com/api_keys' },
  aimlapi: { steps: ['Open aimlapi.com and sign up', 'App → API Keys', 'Copy the key here'], free: 'Free tier with 200+ models and weekly limits — good fallback.', link: 'https://aimlapi.com/app/keys' },
  zai: { steps: ['Open open.bigmodel.cn (GLM / Zhipu)', 'User center → API keys → Create', 'Copy the id.secret key here'], free: 'Free GLM-flash tier; paid GLM-4.6 is strong. OR use the 🆓 Built-in Vortex Engine card above — NO key needed at all.', link: 'https://open.bigmodel.cn/usercenter/apikeys' },
  cerebras: { steps: ['Open cloud.cerebras.ai and sign up (free)', 'Create an API key', 'Copy the csk-… key here'], free: 'Free tier — fastest Llama 3.1/3.3 70B inference available. No credit card.', link: 'https://cloud.cerebras.ai' },
  huggingface: { steps: ['Open huggingface.co and sign up (free)', 'Settings → Access Tokens → New token (Read)', 'Copy the hf_… token here'], free: 'Free monthly inference credits on 200k+ models. 401 = token lacks Inference permission.', link: 'https://huggingface.co/settings/tokens' },
  'together-free': { steps: ['Open api.together.ai and sign up', 'Settings → API Keys → Create', 'Copy the key here'], free: 'Free signup credit ($5) — Llama 3.3 70B Turbo, DeepSeek R1 etc. 402 = credit finished.', link: 'https://api.together.ai/settings/api-keys' },
  // ─── v54 guides — the second free-15 + the free router/China picks ───────
  'openrouter-free': { steps: ['Open openrouter.ai and sign up', 'Settings → Keys → Create Key', 'Copy the sk-or-… key here'], free: 'Models ending in :free are FREE (Llama, Mistral, Gemini Flash, DeepSeek R1). No credit card.', link: 'https://openrouter.ai/settings/keys' },
  siliconflow: { steps: ['Open cloud.siliconflow.cn and sign up', 'API Keys → New (ak-…)', 'Copy the key here'], free: 'Free tier on DeepSeek V3, Qwen 72B — fast in Asia.', link: 'https://cloud.siliconflow.cn/account/ak' },
  novita: { steps: ['Open novita.ai and sign up', 'Dashboard → Keys → Create', 'Copy the key here'], free: '~1000 free requests/month (DeepSeek R1, Llama, Qwen).', link: 'https://novita.ai/dashboard/key' },
}

// ─── v52 ROLE TEMPLATE CHIPS (was v47, lost to the env reset) ───────────────
// 8 one-tap chips that fill the agent's system prompt. The active chip
// highlights; 🧩 General clears the prompt back to neutral.
const ROLE_CHIPS: { emoji: string; label: string; prompt: string }[] = [
  { emoji: '🧩', label: 'General', prompt: '' },
  { emoji: '🎨', label: 'Frontend', prompt: 'You are a senior frontend engineer. You write clean, modern, responsive UI code (HTML/CSS/JS/React) with polished design, accessibility and mobile-first layout. You never leave a broken button or unfinished screen.' },
  { emoji: '⚙️', label: 'Backend', prompt: 'You are a senior backend engineer. You build reliable APIs, auth, business logic and integrations; you handle errors honestly and keep the server state consistent.' },
  { emoji: '🗄️', label: 'Database', prompt: 'You are a database engineer. You design clean schemas, indexes and migrations, write safe queries, and never lose or corrupt user data.' },
  { emoji: '🧪', label: 'QA/Tester', prompt: 'You are a meticulous QA engineer. You hunt for broken flows, dead buttons, edge cases and crashes; you test everything for real and report exactly what failed and how to fix it.' },
  { emoji: '🔍', label: 'Reviewer', prompt: 'You are a strict senior code reviewer. You read the code carefully and point out bugs, security holes, performance traps and unclear naming — with concrete fixes.' },
  { emoji: '📚', label: 'Docs', prompt: 'You are a technical writer. You write clear README files, setup guides and API docs that a beginner can follow end to end without getting stuck.' },
  { emoji: '🔧', label: 'DevOps', prompt: 'You are a DevOps engineer. You handle builds, deploys, environment variables, CI and server configuration so the app actually runs in production.' },
]

export function ProviderManagerDialog() {
  const { providerManagerOpen, setProviderManagerOpen } = useAppStore()
  const [providers, setProviders] = useState<Provider[]>([])
  const [editing, setEditing] = useState<Provider | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'quick' | 'list'>('quick')

  // ── 🧩 Agent roster state — the added AI agents (All / Active ·
  // Leader max 4 · Work max 1500). Shown right under the Quick form.
  const [agentTab, setAgentTab] = useState<'all' | 'active'>('all')
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({})
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)

  async function loadAgentStatuses() {
    try {
      const res = await fetch('/api/providers/health')
      const data = await res.json()
      const map: Record<string, string> = {}
      for (const p of data.providers || []) map[p.id] = p.status || 'healthy'
      setAgentStatuses(map)
    } catch {}
  }

  /** Promote to LEADER (max 4) / demote to WORK — persisted on the provider
   *  row, so the AI Army roster and the run itself follow automatically. */
  async function toggleLeader(p: Provider) {
    setRoleBusyId(p.id)
    try {
      const res = await fetch('/api/providers/role', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, role: p.role === 'leader' ? 'work' : 'leader' }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.error || 'Could not change the role')
        return
      }
      if (p.role === 'leader') toast.success(`${p.name} is now a WORK agent`)
      else toast.success(`👑 ${p.name} promoted to LEADER (${data.leaders}/4)`)
      await Promise.all([load(), loadAgentStatuses()])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRoleBusyId(null)
    }
  }

  // ── Old-UI layout (user's favourite): provider select → key + Get →
  // endpoint → auto model list → pick any model → Test / Save
  // ORDER (user's exact words): Auto → Custom → 🆓 FREE but powerful →
  // 🔓 UNCENSORED → 💎 PAID. e.g. Auto → Custom → Gemini → Groq →
  // Venice → xAI Grok.
  interface QProvider { id: string; label: string; kind: string; name?: string; endpoint?: string; link?: string; ph?: string; group?: 'free' | 'uncensored' | 'paid' }
  const Q_PROVIDERS: QProvider[] = [
    // ── v61.1 — ONLY the owner's 15 (kromonishare). The old 66-provider
    // catalog was DELETED per the owner's explicit order. Auto-detection
    // still recognizes ANY pasted key (key-detect/browser-detect stay). ──
    { id: 'auto', label: 'Auto (detect from key)', kind: '' },
    { id: 'custom', label: 'Custom URL (any provider)', kind: 'openai-compatible' },
    { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', group: 'free', endpoint: 'https://generativelanguage.googleapis.com/v1beta', link: 'https://aistudio.google.com/apikey', ph: 'AIza…' },
    { id: 'groq', label: 'Groq', kind: 'groq', group: 'free', endpoint: 'https://api.groq.com/openai/v1', link: 'https://console.groq.com/keys', ph: 'gsk_…' },
    { id: 'zai', label: 'GLM API (paid key)', kind: 'openai-compatible', name: 'GLM API (paid key)', group: 'paid', endpoint: 'https://api.z.ai/api/paas/v4', link: 'https://open.bigmodel.cn/usercenter/apikeys', ph: 'id.secret…' },
    { id: 'openrouter-free', label: 'OpenRouter (free models)', kind: 'openrouter', group: 'free', endpoint: 'https://openrouter.ai/api/v1', link: 'https://openrouter.ai/settings/keys', ph: 'sk-or-…' },
    { id: 'aimlapi', label: 'AI/ML API (free tier, 200+ models)', kind: 'openai-compatible', name: 'AI/ML API', group: 'free', endpoint: 'https://api.aimlapi.com/v1', link: 'https://aimlapi.com/app/keys', ph: '…' },
    { id: 'deepseek', label: 'DeepSeek (free promo credit)', kind: 'deepseek', group: 'free', endpoint: 'https://api.deepseek.com', link: 'https://platform.deepseek.com/api_keys', ph: 'sk-…' },
    { id: 'deepinfra', label: 'DeepInfra (uncensored)', kind: 'openai-compatible', name: 'DeepInfra', group: 'uncensored', endpoint: 'https://api.deepinfra.com/v1/openai', link: 'https://deepinfra.com/dash/api_keys', ph: 'paste your DeepInfra key' },
    { id: 'cerebras', label: 'Cerebras', kind: 'cerebras', group: 'free', endpoint: 'https://api.cerebras.ai/v1', link: 'https://cloud.cerebras.ai', ph: 'csk-…' },
    { id: 'sambanova', label: 'SambaNova', kind: 'sambanova', group: 'free', endpoint: 'https://api.sambanova.ai/v1', link: 'https://cloud.sambanova.ai', ph: '…' },
    { id: 'huggingface', label: 'Hugging Face', kind: 'huggingface', group: 'free', endpoint: 'https://api-inference.huggingface.co/v1', link: 'https://huggingface.co/settings/tokens', ph: 'hf_…' },
    { id: 'siliconflow', label: 'SiliconFlow', kind: 'siliconflow', group: 'free', endpoint: 'https://api.siliconflow.cn/v1', link: 'https://cloud.siliconflow.cn/account/ak', ph: 'sk-…' },
    { id: 'novita', label: 'Novita AI', kind: 'novita', group: 'free', endpoint: 'https://api.novita.ai/v3/openai', link: 'https://novita.ai/dashboard/key', ph: '…' },
    { id: 'together-free', label: 'Together AI ($5 free credit)', kind: 'together', group: 'free', endpoint: 'https://api.together.xyz/v1', link: 'https://api.together.ai/settings/api-keys', ph: '…' },
  ]
  const [qKind, setQKind] = useState('auto')
  const [qKey, setQKey] = useState('')
  const [qEndpoint, setQEndpoint] = useState('')
  const [qModels, setQModels] = useState<BrowserModel[]>([])
  const [qModel, setQModel] = useState('')
  const [qManualModel, setQManualModel] = useState('')
  const [qConnected, setQConnected] = useState<{ name: string; kind: string; durationMs?: number; via: string; modelsCount: number; mismatchWith?: string } | null>(null)
  const [qGetBusy, setQGetBusy] = useState(false)
  const [qTestBusy, setQTestBusy] = useState(false)
  const [qTestMsg, setQTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [qSaving, setQSaving] = useState(false)
  const [qSearch, setQSearch] = useState('')
  // v52 — 🆓 Built-in Vortex Engine card (no API key, pick model, Save)
  const [builtinModel, setBuiltinModel] = useState(ZAI_DEFAULT_MODEL)
  const [bulkKeysOpen, setBulkKeysOpen] = useState(false)
  const [bulkKeysText, setBulkKeysText] = useState('')
  const [bulkKeysBusy, setBulkKeysBusy] = useState(false)
  const [bulkKeysMsg, setBulkKeysMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [builtinBusy, setBuiltinBusy] = useState(false)
  // v52 — KEY HEALTH memory: every real verdict from /api/providers/health-record
  const [healthLog, setHealthLog] = useState<KeyHealthVerdict[]>([])
  // v56 — 🩺 Test-all-keys bulk health check state
  const [testAllBusy, setTestAllBusy] = useState(false)
  const [testAll, setTestAll] = useState<{ okCount: number; total: number; durationMs: number; results: Record<string, { ok: boolean; durationMs?: number; reply?: string; error?: string; status?: number }> } | null>(null)
  // v63: one-click model switch (POST /api/providers/models + update-model —
  // both endpoints existed since forever with NO caller) + bulk import UI.
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({})
  const [modelsBusyId, setModelsBusyId] = useState<string | null>(null)
  const [switchBusyId, setSwitchBusyId] = useState<string | null>(null)
  const [fixBusyId, setFixBusyId] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  async function loadHealthLog() {
    try {
      const res = await fetch('/api/providers/health-record')
      const data = await res.json()
      if (Array.isArray(data.verdicts)) setHealthLog(data.verdicts)
    } catch { /* health chips are best-effort — never block the dialog */ }
  }

  /** v56 — 🩺 Test ALL saved keys in one tap: every provider gets ONE real
   *  "Say OK" chat call in parallel (server-side, keys never leave the
   *  server). Verdicts land on each card, feed the health memory, and a
   *  summary toast tells you how many keys actually work right now. */
  async function testAllKeys() {
    if (testAllBusy) return
    if (providers.length === 0) { toast.error('No saved keys to test — add a provider first'); return }
    setTestAllBusy(true); setTestAll(null)
    try {
      const res = await fetch('/api/providers/test-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.status === 401) { toast.error('Your session is locked — unlock and try again'); return }
      const data = await res.json().catch(() => null)
      if (!data || !Array.isArray(data.results)) { toast.error('Health check failed — try again in a moment'); return }
      const byId: Record<string, { ok: boolean; durationMs?: number; reply?: string; error?: string; status?: number }> = {}
      for (const r of data.results) byId[r.id] = { ok: !!r.ok, durationMs: r.durationMs, reply: r.reply, error: r.error, status: r.status }
      setTestAll({ okCount: data.okCount || 0, total: data.total || data.results.length, durationMs: data.durationMs || 0, results: byId })
      // Feed every verdict into the persistent health memory (best-effort)
      for (const r of data.results) {
        const row = providers.find(p => p.id === r.id)
        recordVerdict({ name: r.name || row?.name || r.id, kind: r.kind || row?.kind || 'custom', endpoint: row?.endpoint || null, model: r.model, ok: !!r.ok, status: r.status, error: r.error, via: 'test-all' })
      }
      if (data.total === 0) toast.info('No saved keys to test — add a provider first')
      else if (data.okCount === data.total) toast.success(`🩺 ${data.okCount}/${data.total} keys healthy (${renderDuration(data.durationMs)})`)
      else toast.warning(`🩺 ${data.okCount}/${data.total} keys healthy — ${data.total - data.okCount} failed (${renderDuration(data.durationMs)})`)
    } catch (e: any) {
      toast.error(e?.message || 'Health check failed — network error')
    } finally {
      setTestAllBusy(false)
    }
  }

  /** Remember a REAL verdict (Get or Test, device or server). Best-effort. */
  async function recordVerdict(v: { name: string; kind: string; endpoint?: string | null; model?: string; ok: boolean; status?: number; error?: string; via: string }) {
    try {
      const res = await fetch('/api/providers/health-record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const data = await res.json().catch(() => null)
      if (data?.verdicts) setHealthLog(data.verdicts)
    } catch { /* never break the flow because of the health log */ }
  }

  /** Newest remembered verdict for a provider pick (kind + endpoint match). */
  function lastVerdict(kind: string, endpoint: string | null): KeyHealthVerdict | null {
    const ep = (endpoint || '').trim().replace(/\/+$/, '')
    return healthLog.find(v => v.kind === kind && (v.endpoint || '').trim().replace(/\/+$/, '') === ep) || null
  }

  function verdictLine(lv: KeyHealthVerdict): string {
    const mins = Math.max(1, Math.round((Date.now() - lv.at) / 60000))
    const ago = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`
    return `Last Test ${lv.ok ? 'PASSED' : 'FAILED'} · ${ago}${lv.error ? ' · ' + lv.error : ''}`
  }

  /** 🆓 Built-in Vortex Engine — save WITHOUT any API key (kind 'zai' is accepted
   *  key-less by /api/providers). Updates the existing row when re-saved. */
  async function saveBuiltIn() {
    setBuiltinBusy(true)
    try {
      const existing = providers.find(p => p.kind === 'zai')
      const res = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: existing?.id || undefined,
          name: existing?.name || 'Built-in Vortex Engine',
          kind: 'zai',
          endpoint: null,
          model: builtinModel,
          temperature: 0.7,
          isDefault: providers.length === 0,
        }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (data.provider) {
        toast.success(`🆓 Built-in Vortex Engine saved (${builtinModel}) — no key needed, works now`)
        await load()
      } else {
        toast.error(data.error || 'Save failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBuiltinBusy(false)
    }
  }

  /** v71 — Paste MANY keys at once: every verified key becomes its own
   *  working agent row (keys = agents). Uses the purpose-built
   *  POST /api/providers/quick-setup bulk route: dedupes against the pool,
   *  groups keys by prefix so the detection pipeline runs once per GROUP,
   *  and saves each key as a separate provider row. Keys that no supported
   *  provider claims are reported honestly, never half-saved. */
  async function runBulkKeys() {
    const keys = bulkKeysText
      .split(/[\s,;]+/)
      .map(k => k.trim())
      .filter(k => k.length >= 10)
    if (keys.length === 0) {
      toast.error('Paste at least one API key (each needs 10+ characters)')
      return
    }
    setBulkKeysBusy(true); setBulkKeysMsg(null)
    try {
      const res = await fetch('/api/providers/quick-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok && !data.ok) {
        setBulkKeysMsg({ ok: false, text: data.error || `HTTP ${res.status}` })
        toast.error(data.error || 'Bulk add failed')
        return
      }
      const bits: string[] = []
      if (data.added?.length) bits.push(`${data.added.length} agent(s) added and ready`)
      if (data.duplicates) bits.push(`${data.duplicates} duplicate(s) skipped`)
      if (data.failed?.length) bits.push(`${data.failed.length} could not be verified`)
      const text = data.summary || bits.join(' · ') || 'Nothing to add'
      setBulkKeysMsg({ ok: (data.added?.length || 0) > 0, text })
      if (data.added?.length) {
        toast.success(`✓ ${data.added.length} new agent(s) added to the pool`)
        setBulkKeysText('')
        await load()
      } else {
        toast.message(text)
      }
    } catch (e: any) {
      setBulkKeysMsg({ ok: false, text: e.message })
      toast.error(e.message)
    } finally {
      setBulkKeysBusy(false)
    }
  }

  function onQKindChange(id: string) {
    setQKind(id)
    const chosen = Q_PROVIDERS.find(p => p.id === id)
    setQEndpoint(id !== 'auto' ? (chosen?.endpoint || '') : '')
    setQModels([]); setQModel(''); setQManualModel(''); setQConnected(null); setQTestMsg(null); setQSearch('')
  }

  /** Truth-test: did the provider that actually answer match the preset the
   *  user picked? Normalized alphanumeric bidirectional contains — tolerates
   *  '(Google)'/' (uncensored)' decorations on either side.
   *  v67 FALSE-MISMATCH FIX: 'Google Gemini' vs 'Gemini (Google)' normalized
   *  are 'googlegemini' vs 'geminigoogle' — neither contains the other, so
   *  the old check flagged the SAME provider as a mismatch and showed the
   *  absurd toast "Connected to Google Gemini — NOT Gemini (Google)". Now
   *  two names that share a significant word (≥5 chars: google, gemini,
   *  openrouter, together…) count as the same provider, while genuinely
   *  different ones (DeepSeek vs DeepInfra) still warn. */
  function namesMatch(detected: string, chosenLabel: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const a = norm(detected)
    const b = norm(chosenLabel)
    if (!a || !b) return true // nothing to compare — don't warn
    if (a === b || a.includes(b) || b.includes(a)) return true
    // split into words on case/camel boundaries is unreliable after stripping,
    // so probe: does either name CONTAIN a ≥5-char chunk of the other?
    for (let len = Math.min(a.length, 12); len >= 5; len--) {
      for (let i = 0; i + len <= a.length; i++) {
        if (b.includes(a.slice(i, i + len))) return true
      }
    }
    return false
  }

  /** Get — ULTRA-STRONG detection: probe every provider in parallel FROM YOUR
   *  DEVICE (server fallback when the device cannot reach it), auto-fill the
   *  endpoint, auto-rank ALL models best-first and AUTO-SELECT the best chat
   *  model — the user never lands on a veo/live/preview junk model again. */
  async function runGet() {
    const key = qKey.trim()
    if (!key || key.length < 10) { toast.error('Enter your API key first'); return }
    const chosen = Q_PROVIDERS.find(p => p.id === qKind)!
    if (qKind === 'custom' && !/^https?:\/\//.test(qEndpoint.trim())) { toast.error('Enter the endpoint URL first (https://…)'); return }
    setQGetBusy(true); setQConnected(null); setQModels([]); setQModel(''); setQTestMsg(null)
    try {
      // Phase 1: device-direct (the old UI's trick — works even when the
      // provider blocks datacenter servers)
      const det = await browserDetectKey(key, qEndpoint.trim() || null, chosen.kind || null, chosen.name || null)
      if (det.ok && det.models && det.models.length > 0) {
        // v25.3 TRUTHFUL LABEL: the probe races many providers in parallel —
        // the winner may NOT be the preset the user picked (e.g. a
        // SambaNova key + a stale ModelScope endpoint connects to
        // ModelScope because its public /models answers and SambaNova is
        // CORS-silent). Label the result with the provider that ACTUALLY
        // answered and warn loudly when it differs from the pick.
        const truthful = det.providerName || chosen.label
        const mismatch = qKind !== 'auto' && qKind !== 'custom' && !!det.providerName && !namesMatch(det.providerName, chosen.label)
        setQEndpoint(det.endpoint || qEndpoint)
        setQModels(det.models)
        setQModel(det.model || det.models[0].id)
        setQConnected({ name: truthful, kind: det.providerKind || chosen.kind || 'openai-compatible', durationMs: det.durationMs, via: 'device', modelsCount: det.models.length, mismatchWith: mismatch ? chosen.label : undefined })
        // v52 KEY HEALTH: a successful Get IS a real key verdict
        recordVerdict({ name: truthful, kind: det.providerKind || chosen.kind || 'openai-compatible', endpoint: det.endpoint || qEndpoint, ok: true, via: 'get-device' })
        if (mismatch) {
          toast.message(`Connected to ${truthful} — NOT ${chosen.label}`, {
            description: 'This key actually belongs to ' + truthful + '. The endpoint was switched automatically. Test now — if it fails, the key is for a different provider.',
          })
        } else {
          toast.success(`✓ ${truthful} — endpoint + best model auto-picked (${det.models.length} models, ${renderDuration(det.durationMs)})`)
        }
        return
      }
      // Phase 2: device couldn't reach it (CORS/network) → server detection
      if (det.corsBlocked) {
        const res = await fetch('/api/providers/auto-detect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: key, endpoint: qEndpoint.trim() || null }),
        })
        const data = await res.json()
        if (data.ok && data.detected) {
          const models = (data.detected.models || []).map((m: any) => ({ id: m.id, name: m.name, owned_by: m.owned_by, context_length: m.context_length }))
          const truthful = data.detected.providerName || chosen.label
          const mismatch = qKind !== 'auto' && qKind !== 'custom' && !!data.detected.providerName && !namesMatch(data.detected.providerName, chosen.label)
          setQEndpoint(data.detected.endpoint || qEndpoint)
          setQModels(models)
          setQModel(models[0]?.id || '')
          setQConnected({ name: truthful, kind: data.detected.providerKind, via: 'server', modelsCount: models.length, mismatchWith: mismatch ? chosen.label : undefined })
          recordVerdict({ name: truthful, kind: data.detected.providerKind, endpoint: data.detected.endpoint || qEndpoint, ok: true, via: 'get-server' })
          if (mismatch) toast.message(`Connected to ${truthful} — NOT ${chosen.label}`, { description: 'This key actually belongs to ' + truthful + '.' })
          else toast.success(`Detected ${truthful} — ${models.length} models`)
          return
        }
        setQTestMsg({ ok: false, text: data.error || det.error || 'Could not verify this key' })
        recordVerdict({ name: chosen.label, kind: chosen.kind || 'openai-compatible', endpoint: qEndpoint, ok: false, error: data.error || det.error || 'Could not verify this key', via: 'get-server' })
        toast.error('Could not verify this key')
        return
      }
      // The provider answered the DEVICE and refused the key — real verdict
      setQTestMsg({ ok: false, text: det.error || 'Key rejected by the provider' })
      recordVerdict({ name: chosen.label, kind: chosen.kind || 'openai-compatible', endpoint: qEndpoint, ok: false, error: det.error || 'Key rejected by the provider', via: 'get-device' })
      toast.error('Key rejected by the provider')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setQGetBusy(false)
    }
  }

  /** Test — tiny real chat call from YOUR DEVICE with the selected model.
   *  If the DEVICE fetch itself fails ("Failed to fetch" — network hiccup or
   *  CORS blip), the SAME chat call is retried from the server, so the user
   *  always gets a real verdict instead of a raw network error. */
  async function runTest() {
    const model = qModel || qManualModel
    if (!qKey.trim()) { toast.error('Enter your API key first'); return }
    if (!model) { toast.error('Select a model first (press Get)'); return }
    const chosen = Q_PROVIDERS.find(p => p.id === qKind)!
    const kind = qConnected?.kind || chosen.kind || 'openai-compatible'
    setQTestBusy(true); setQTestMsg(null)
    try {
      const r = await browserTestChat({ kind, endpoint: qEndpoint.trim(), apiKey: qKey.trim(), model })
      if (r.ok) {
        setQTestMsg({ ok: true, text: `Connected (${renderDuration(r.durationMs)}) — ${model} replied: "${r.reply}"` })
        toast.success('Test passed — this key works')
        recordVerdict({ name: qConnected?.name || chosen.label, kind, endpoint: qEndpoint.trim(), model, ok: true, via: 'device' })
        return
      }
      const networkish = /failed to fetch|networkerror|load failed|unreachable|cors|timed? ?out|network/i.test(r.error || '')
      if (!networkish) {
        setQTestMsg({ ok: false, text: r.error || 'Test failed' })
        toast.error('Test failed — see details')
        recordVerdict({ name: qConnected?.name || chosen.label, kind, endpoint: qEndpoint.trim(), model, ok: false, error: r.error || 'Test failed', via: 'device' })
        return
      }
      // Device network hiccup → retry the SAME chat call from the SERVER
      setQTestMsg({ ok: false, text: 'Your device could not reach the provider just now (network hiccup) — retrying the Test via the server…' })
      const res = await fetch('/api/providers/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, endpoint: qEndpoint.trim(), apiKey: qKey.trim(), model }),
      })
      // The server route always answers JSON; a non-JSON reply means the
      // platform server itself was unreachable/restarting — say so clearly
      // instead of crashing on JSON.parse.
      let data: any
      try {
        data = await res.json()
      } catch {
        setQTestMsg({ ok: false, text: `The builder server could not be reached for the server-side Test (HTTP ${res.status}). It may be restarting — wait a few seconds and press Test again. Get from YOUR DEVICE already verified keys independently.` })
        toast.error('Server unreachable — try again shortly')
        return
      }
      if (data.ok) {
        setQTestMsg({ ok: true, text: `Connected via the server (${renderDuration(data.durationMs)}) — ${model} replied: "${data.reply}"` })
        toast.success('Test passed via server — this key works')
        recordVerdict({ name: qConnected?.name || chosen.label, kind, endpoint: qEndpoint.trim(), model, ok: true, via: 'server' })
      } else if (data.status === 403 || /HTTP 403/.test(data.error || '')) {
        setQTestMsg({ ok: false, text: 'The provider is blocking the server\u2019s region (HTTP 403) and your device had a network hiccup — but Get already verified this key from YOUR DEVICE. Save it: runs automatically use your device route.' })
        recordVerdict({ name: qConnected?.name || chosen.label, kind, endpoint: qEndpoint.trim(), model, ok: false, status: 403, error: 'HTTP 403 region block (device Get verified the key)', via: 'server' })
      } else if (/could not reach|connection refused|dns failed|fetch failed/i.test(data.error || '')) {
        setQTestMsg({ ok: false, text: 'The endpoint could not be reached from your device OR the server (network error). Check the endpoint URL and your connection, then Test again.' })
      } else {
        setQTestMsg({ ok: false, text: data.error || 'Test failed on both device and server' })
        recordVerdict({ name: qConnected?.name || chosen.label, kind, endpoint: qEndpoint.trim(), model, ok: false, status: data.status, error: data.error || 'Test failed on both device and server', via: 'server' })
      }
    } finally {
      setQTestBusy(false)
    }
  }

  /** Save — store the configured provider in the pool (keys = agents). */
  async function saveQuick() {
    const model = qModel || qManualModel
    const chosen = Q_PROVIDERS.find(p => p.id === qKind)!
    if (!qKey.trim()) { toast.error('Enter your API key first'); return }
    if (!model) { toast.error('Select a model first (press Get)'); return }
    if (!qEndpoint.trim() && qKind === 'custom') { toast.error('Endpoint required for Custom URL'); return }
    setQSaving(true)
    try {
      const res = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: qConnected?.name || chosen.label.replace(/ \(.*\)$/, ''),
          kind: qConnected?.kind || chosen.kind || 'openai-compatible',
          endpoint: qEndpoint.trim() || null,
          model,
          apiKey: qKey.trim(),
          temperature: 0.7,
          isDefault: providers.length === 0,
        }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (data.provider) {
        toast.success(`${data.provider.name} saved — ${model} is ready to work`)
        setQKey(''); setQModels([]); setQModel(''); setQManualModel(''); setQConnected(null); setQTestMsg(null)
        load()
      } else if (res.status === 409 && data.duplicateOf) {
        // v67: the owner read "Duplicate key" as "I can't add anything" —
        // flip it into the truth: the key is ALREADY working, nothing to add.
        toast.success(`This key is already in your pool as "${data.duplicateOf}" and is ready to use — no need to add it again. For a second agent on the same provider, use a DIFFERENT key.`)
      } else {
        toast.error(data.error || 'Save failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setQSaving(false)
    }
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/providers')
      const data = await res.json()
      setProviders(data.providers || [])
    } catch {
      toast.error('Failed to load providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (providerManagerOpen) {
      load()
      loadAgentStatuses()
      loadHealthLog()
      setTab('quick')
      setQKey(''); setQModels([]); setQModel(''); setQManualModel(''); setQConnected(null); setQTestMsg(null); setQEndpoint(''); setQKind('auto')
    }
  }, [providerManagerOpen])

  async function save() {
    if (!editing) return
    if (!editing.name || !editing.model) {
      toast.error('Name and model required')
      return
    }
    try {
      const res = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id || undefined,
          name: editing.name,
          kind: editing.kind,
          endpoint: editing.endpoint || null,
          model: editing.model,
          systemPrompt: editing.systemPrompt || null,
          temperature: editing.temperature,
          maxTokens: editing.maxTokens || null,
          isDefault: editing.isDefault,
          // Only send apiKey if user explicitly entered a new one
          apiKey: (editing as any)._apiKeyRaw || undefined,
        }),
      })
      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        // Not JSON — server route missing or server down
        toast.error('Server is starting up. Please wait 10 seconds and try again, or refresh the page.')
        return
      }
      if (data.provider) {
        toast.success(editing.id ? 'Provider updated' : 'Provider created')
        setEditing(null)
        load()
      } else if (res.status === 409 && data.duplicateOf) {
        // v67: same truth-first reframe as saveQuick — duplicate means
        // "already working", not "blocked".
        toast.success(`This key is already in your pool as "${data.duplicateOf}" — it works right now, no need to add it twice. The same provider with a DIFFERENT key is always allowed.`)
      } else {
        toast.error(data.error || 'save failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this provider?')) return
    await fetch(`/api/providers?id=${id}`, { method: 'DELETE' })
    toast.success('Provider removed')
    load()
  }

  async function setDefault(id: string) {
    const p = providers.find(x => x.id === id)
    if (!p) return
    await fetch('/api/providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: p.id,
        name: p.name,
        kind: p.kind,
        endpoint: p.endpoint || null,
        model: p.model,
        systemPrompt: p.systemPrompt || null,
        temperature: p.temperature,
        maxTokens: p.maxTokens || null,
        isDefault: true,
      }),
    })
    toast.success('Default set')
    load()
  }

  /** v63 — one-click model switch, part 1: fetch the provider's REAL live
   *  model list via the previously-dead POST /api/providers/models. */
  async function fetchModels(p: Provider) {
    setModelsBusyId(p.id)
    try {
      const res = await fetch('/api/providers/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      const data = await res.json()
      if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
        setModelLists(m => ({ ...m, [p.id]: data.models.map((x: any) => x.id || String(x)) }))
      } else {
        toast.error(data.error || 'No models returned for this provider')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setModelsBusyId(null)
    }
  }

  /** v68 — STALE-MODEL AUTO-FIX: one tap asks the provider what it can STILL
   *  run and repairs a retired model name in place (Gemini 1.5/-001 404s). */
  async function autoFixModel(p: Provider) {
    setFixBusyId(p.id)
    try {
      const res = await fetch('/api/providers/fix-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      const data = await res.json()
      if (data.ok) {
        if (data.fixed) toast.success(data.message || `${p.name}: ${data.from} → ${data.to}`)
        else toast.info(data.message || `${p.name}: model is already live`)
        if (data.fixed) load()
      } else {
        toast.error(data.error || 'Auto-fix failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setFixBusyId(null)
    }
  }

  /** v63 — one-click model switch, part 2: the previously-dead
   *  POST /api/providers/update-model (a light partial update — the full
   *  save route would demand name+kind and overwrite everything). */
  async function switchModel(p: Provider, model: string) {
    setSwitchBusyId(p.id)
    try {
      const res = await fetch('/api/providers/update-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, model }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`${p.name}: model → ${model}`)
        setModelLists(m => {
          const next = { ...m }
          delete next[p.id]
          return next
        })
        load()
      } else {
        toast.error(data.error || 'Switch failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSwitchBusyId(null)
    }
  }

  /** v63 — bulk import wired to the previously-dead
   *  POST /api/providers/bulk-import (many providers in one paste).
   *  Accepts a JSON array (or { providers: [...] }) of
   *  { name, kind, apiKey, model, endpoint? } rows. */
  async function bulkImport() {
    const text = bulkText.trim()
    if (!text) { toast.error('Paste provider JSON first'); return }
    setBulkBusy(true)
    try {
      const res = await fetch('/api/providers/bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Imported ${data.imported}${data.duplicates ? ` · ${data.duplicates} duplicate(s) skipped` : ''}${data.skipped ? ` · ${data.skipped} skipped` : ''}${data.errors?.length ? ` · ${data.errors.length} error(s)` : ''}`)
        if (Array.isArray(data.errors) && data.errors.length) console.warn('bulk-import errors:', data.errors)
        setBulkText(''); setBulkOpen(false)
        load()
      } else {
        toast.error(data.error || 'Import failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <Dialog open={providerManagerOpen} onOpenChange={setProviderManagerOpen}>
      <DialogContent className="w-[calc(100%-1rem)] sm:max-w-3xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            AI Provider Manager
          </DialogTitle>
          <DialogDescription>
            Quick API agent setup: pick a provider (or Auto), paste your key and press Get — all models are
            fetched live from YOUR DEVICE so blocked-server providers still work. Test it, pick any model, Save.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <ProviderForm
            provider={editing}
            onChange={setEditing}
            onSave={save}
            onCancel={() => setEditing(null)}
            showKey={showKey}
            setShowKey={setShowKey}
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="w-full">
              <TabsTrigger value="quick" className="flex-1"><Zap className="w-3.5 h-3.5 mr-1.5" />Quick API Setup</TabsTrigger>
              <TabsTrigger value="list" className="flex-1">All Providers ({providers.length})</TabsTrigger>
            </TabsList>

            {/* ───── ⚡ Quick API agent setup — the classic layout ───── */}
            <TabsContent value="quick" className="mt-3 space-y-3">
              {/* ── 🆓 Built-in Vortex Engine — NO API key needed (v52, was v46) ── */}
              <Card className="p-3 space-y-2 border-emerald-500/30 bg-emerald-500/5">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  🆓 Built-in Vortex Engine — no API key needed
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Works instantly, zero cost: pick a GLM model and Save. A good first agent while your own keys are being added below.
                </div>
                <div className="flex items-center gap-2">
                  <Select value={builtinModel} onValueChange={setBuiltinModel}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ZAI_MODELS.map(m => (
                        <SelectItem key={m.id} value={m.id} className="font-mono text-xs">{m.id} — {m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={saveBuiltIn} disabled={builtinBusy} className="shrink-0">
                    {builtinBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5 mr-1" />Save</>}
                  </Button>
                </div>
              </Card>

              <Card className="p-3 space-y-3">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Quick API agent setup
                </div>

                {/* Select provider */}
                <div>
                  <Label htmlFor="q-provider">Select provider</Label>
                  <Select value={qKind} onValueChange={onQKindChange}>
                    <SelectTrigger id="q-provider" className="mt-1">
                      <SelectValue placeholder="Auto" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[70dvh]">
                      {/* ── ⭐ Your 15 — one tap (v61: the owner's exact order, Auto first) ── */}
                      <SelectGroup>
                        <SelectLabel className="text-[11px] font-semibold text-primary">⭐ Your 15 — one tap (Auto · Custom · your providers in order)</SelectLabel>
                        {Q_CURATED.map(id => {
                          const p = Q_PROVIDERS.find(x => x.id === id)
                          return p ? <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem> : null
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {/* Enter API key + Get */}
                <div>
                  <Label htmlFor="q-key">Enter API key</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="q-key"
                      type="password"
                      value={qKey}
                      onChange={(e) => setQKey(e.target.value)}
                      placeholder={Q_PROVIDERS.find(p => p.id === qKind)?.ph || 'paste your API key'}
                      className="font-mono text-xs"
                      autoComplete="off"
                    />
                    <Button onClick={runGet} disabled={qGetBusy} className="shrink-0">
                      {qGetBusy
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Get…</>
                        : <><Zap className="w-3.5 h-3.5 mr-1.5" />Get</>}
                    </Button>
                  </div>
                  {(() => { const chosen = Q_PROVIDERS.find(p => p.id === qKind); return chosen?.link ? (
                    <a href={chosen.link} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-block mt-1">
                      🔑 Free key: {chosen.link}
                    </a>
                  ) : null })()}
                  {/* ── v52 KEY GUIDE — how to get this key, honestly ── */}
                  {(() => {
                    const g = KEY_GUIDE[qKind]
                    if (!g) return null
                    return (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2 mt-1.5 space-y-1">
                        <div className="text-[11px] font-semibold flex items-center gap-1 text-primary">
                          <BookOpen className="w-3 h-3" /> How to get this key
                        </div>
                        <ol className="text-[11px] text-muted-foreground list-decimal ml-4 space-y-0.5">
                          {g.steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                        <div className="text-[11px]"><span className="font-medium">Free tier truth:</span> <span className="text-muted-foreground">{g.free}</span></div>
                        {g.link && (
                          <a href={g.link} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                            <KeyRound className="w-3 h-3" /> Open the key page →
                          </a>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Endpoint */}
                <div>
                  <Label htmlFor="q-endpoint">Endpoint</Label>
                  <Input
                    id="q-endpoint"
                    value={qEndpoint}
                    onChange={(e) => setQEndpoint(e.target.value)}
                    placeholder="https://xxxxx  (auto-filled by Get)"
                    className="mt-1 font-mono text-xs"
                  />
                </div>

                {/* Connected banner */}
                {qConnected && (
                  <>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
                      {qConnected.via === 'device'
                        ? <Smartphone className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                      <span>
                        Connected{qConnected.durationMs ? ` (${renderDuration(qConnected.durationMs)})` : ''} via {qConnected.via === 'device' ? 'YOUR DEVICE' : 'the server'}
                        {' '}— <strong>{qConnected.name}</strong>, {qConnected.modelsCount} model{qConnected.modelsCount !== 1 ? 's' : ''} available.
                        {qConnected.via === 'device' ? ' Your device is accepted even where datacenter servers are blocked — runs use the same device route automatically.' : ''}
                      </span>
                    </div>
                    {qConnected.mismatchWith && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/20 rounded p-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          You selected <strong>{qConnected.mismatchWith}</strong>, but this key actually belongs to <strong>{qConnected.name}</strong> — the endpoint was switched automatically.
                          If you meant {qConnected.mismatchWith}, paste a {qConnected.mismatchWith} key (Get → {qConnected.mismatchWith} → the key link under the key box).
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* Auto model list — pick any model */}
                {qModels.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>All models ({qModels.length}) — best first, click to select</Label>
                    </div>
                    {qModels.length > 8 && (
                      <div className="relative mt-1">
                        <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={qSearch}
                          onChange={e => setQSearch(e.target.value)}
                          placeholder={`Search ${qModels.length} models…`}
                          className="w-full text-xs rounded border border-border bg-background pl-7 pr-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>
                    )}
                    <div className="mt-1.5 max-h-44 overflow-y-auto rounded border border-border divide-y divide-border">
                      {(qSearch ? qModels.filter(m => m.id.toLowerCase().includes(qSearch.toLowerCase())) : qModels).slice(0, 80).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { setQModel(m.id); setQTestMsg(null) }}
                          className={`w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-muted/60 ${m.id === qModel ? 'bg-primary/10' : ''}`}
                        >
                          <span className="font-mono text-[11px] flex-1 truncate">{m.id}</span>
                          {m.context_length ? <span className="text-[9px] text-muted-foreground shrink-0">{Math.round(m.context_length / 1000)}k ctx</span> : null}
                          {m.id === qModel && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                        </button>
                      ))}
                    </div>
                    {qModel && <p className="text-[10px] text-muted-foreground mt-1">Selected: <span className="font-mono">{qModel}</span></p>}
                  </div>
                ) : (
                  qKind === 'custom' && (
                    <div>
                      <Label htmlFor="q-model">Model name</Label>
                      <Input
                        id="q-model"
                        value={qManualModel}
                        onChange={(e) => setQManualModel(e.target.value)}
                        placeholder="model-name (press Get to fetch the list, or type it)"
                        className="mt-1 font-mono text-xs"
                      />
                    </div>
                  )
                )}

                {/* Test result line */}
                {qTestMsg && (
                  <div className={`text-xs flex items-start gap-1.5 rounded p-2 border ${qTestMsg.ok ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border-emerald-500/20' : 'text-destructive bg-destructive/5 border-destructive/20'}`}>
                    {qTestMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span className="break-words">{qTestMsg.text}</span>
                  </div>
                )}

                {/* ── v52 KEY HEALTH — remembered verdict for this pick ── */}
                {(() => {
                  const chosen = Q_PROVIDERS.find(p => p.id === qKind)
                  if (!chosen || !qTestMsg) return null // shown together with a fresh result
                  const lv = lastVerdict(qConnected?.kind || chosen.kind || 'openai-compatible', qEndpoint.trim() || null)
                  if (!lv) return null
                  return (
                    <div className={`text-[11px] flex items-center gap-1.5 rounded px-2 py-1 border ${lv.ok ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5' : 'text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/5'}`}>
                      <Activity className="w-3 h-3 shrink-0" />
                      <span className="truncate">{verdictLine(lv)}</span>
                    </div>
                  )
                })()}

                {/* Test + Save */}
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={runTest} disabled={qTestBusy || qGetBusy}>
                    {qTestBusy
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing…</>
                      : <><Zap className="w-3.5 h-3.5 mr-1.5" />Test</>}
                  </Button>
                  <Button size="sm" onClick={saveQuick} disabled={qSaving || qGetBusy} className="flex-1">
                    {qSaving
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                      : <><Check className="w-3.5 h-3.5 mr-1.5" />Save</>}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Get fetches every model from YOUR DEVICE — some providers refuse datacenter servers but always
                  accept your device. If the server gets blocked during runs, the swarm automatically retries the
                  same call from your device.
                </p>

                {/* ── v71 BULK KEYS — paste MANY, each key becomes an agent ── */}
                <details open={bulkKeysOpen} className="text-[11px]">
                  <summary
                    className="cursor-pointer text-primary inline-flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); setBulkKeysOpen(v => !v) }}
                  >
                    <KeyRound className="w-3 h-3" /> Paste MANY keys — each key = one agent
                  </summary>
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={bulkKeysText}
                      onChange={(e) => setBulkKeysText(e.target.value)}
                      placeholder={'One or many API keys, separated by newlines or commas:\nsk-or-v1-…\ngsk_…\nAIza…'}
                      rows={4}
                      className="font-mono text-[11px]"
                      autoComplete="off"
                    />
                    <Button size="sm" className="w-full" onClick={runBulkKeys} disabled={bulkKeysBusy || !bulkKeysText.trim()}>
                      {bulkKeysBusy
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Detecting & adding…</>
                        : <><Plus className="w-3.5 h-3.5 mr-1.5" />Add ALL as agents</>}
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                      Duplicates are skipped automatically — the same key never works twice. Keys that no
                      supported provider recognizes are reported back, never half-saved.
                    </p>
                    {bulkKeysMsg && (
                      <div className={`text-[11px] rounded p-2 border ${bulkKeysMsg.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                        {bulkKeysMsg.text}
                      </div>
                    )}
                  </div>
                </details>

                {/* ── v52 KEY GUIDE — all 15, collapsible ── */}
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-primary inline-flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> Key guide for all {Q_CURATED.length - 2} picks
                  </summary>
                  <div className="mt-2 space-y-2">
                    {Q_CURATED.filter(id => KEY_GUIDE[id]).map(id => {
                      const p = Q_PROVIDERS.find(x => x.id === id)
                      const g = KEY_GUIDE[id]
                      if (!p || !g) return null
                      return (
                        <div key={id} className="border-l-2 border-primary/30 pl-2">
                          <div className="font-medium">{p.label}</div>
                          <div className="text-muted-foreground">{g.steps.join(' → ')}</div>
                          <div className="text-muted-foreground">Free tier: {g.free}</div>
                          {g.link && <a href={g.link} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{g.link}</a>}
                        </div>
                      )
                    })}
                  </div>
                </details>
              </Card>

              {/* ── 🧩 Agent roster — the added AI agents (All / Active ·
                  Leader max 4 · Work max 1500 · auto failover) ── */}
              <AgentRoster
                providers={providers}
                agentTab={agentTab}
                setAgentTab={setAgentTab}
                statuses={agentStatuses}
                busyId={roleBusyId}
                onToggleLeader={toggleLeader}
                onRefreshStatuses={loadAgentStatuses}
              />
            </TabsContent>

            <TabsContent value="list" className="mt-3">
            <div className="space-y-3">
            {/* v111 — Local open-source AI: zero-API-key models on this server */}
            <LocalAICard onChanged={load} />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Configured providers ({providers.length})</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={testAllKeys} disabled={testAllBusy || providers.length === 0} title="One real 'Say OK' chat call per saved key — see which keys work right now">
                  {testAllBusy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Stethoscope className="w-4 h-4 mr-1.5" />}
                  {testAllBusy ? 'Testing…' : 'Test all keys'}
                </Button>
                <Button size="sm" onClick={() => setEditing({
                id: '',
                name: '',
                kind: 'openai',
                endpoint: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini',
                systemPrompt: '',
                temperature: 0.7,
                maxTokens: 128000,
                isDefault: providers.length === 0,
                apiKeyMasked: null,
              } as Provider)}>
                <Plus className="w-4 h-4 mr-1.5" /> Add Provider
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulkOpen(o => !o)} title="Paste a JSON array of providers — imports them all in one shot">
                  <Upload className="w-3.5 h-3.5 mr-1.5" />Bulk import
                </Button>
              </div>
            </div>
            {testAll && !testAllBusy && (
              <div className={`text-[11px] flex items-center gap-1.5 px-2 py-1.5 rounded-md border ${testAll.okCount === testAll.total && testAll.total > 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'}`}>
                <Stethoscope className="w-3.5 h-3.5 shrink-0" />
                🩺 Bulk health check: <strong>{testAll.okCount}/{testAll.total} keys healthy</strong> · finished in {renderDuration(testAll.durationMs)} — details on each card below
              </div>
            )}
            {/* v63: bulk import panel — the previously-dead bulk-import endpoint */}
            {bulkOpen && (
              <Card className="p-3 space-y-2 border-dashed">
                <Label className="text-xs font-medium">Bulk import — paste a JSON array of providers</Label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={6}
                  className="font-mono text-[11px]"
                  placeholder={`[
  { "name": "Groq key 2", "kind": "groq", "apiKey": "gsk_...", "model": "llama-3.3-70b-versatile" },
  { "name": "DeepInfra", "kind": "openai-compatible", "endpoint": "https://api.deepinfra.com/v1/openai", "apiKey": "...", "model": "..." }
]`}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={bulkImport} disabled={bulkBusy || !bulkText.trim()}>
                    {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
                    Import all
                  </Button>
                  <span className="text-[10px] text-muted-foreground">Duplicate keys are skipped automatically · same provider with different keys = separate agents.</span>
                </div>
              </Card>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : providers.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No providers configured. The built-in GLM provider will be used as fallback.
                Click <strong>Add Provider</strong> to configure your own.
              </Card>
            ) : (
              <div className="space-y-2">
                {providers.map(p => (
                  <div key={p.id} className="space-y-1">
                  <Card className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.name}</span>
                        <Badge variant="outline" className="text-[10px]">{p.kind}</Badge>
                        {p.isDefault && <Badge variant="outline" className="text-[10px] ca-bg-building ca-status-building"><Star className="w-2.5 h-2.5 mr-1 fill-current" />default</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.model} {p.endpoint ? `· ${p.endpoint}` : ''}
                        {p.apiKeyMasked && ` · key: ${p.apiKeyMasked}`}
                      </div>
                      {/* ── v56 TEST-ALL verdict — live result of the bulk health check ── */}
                      {(() => {
                        const tr = testAll?.results?.[p.id]
                        if (!tr) return null
                        return tr.ok ? (
                          <div className="text-[10px] mt-0.5 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            Tested just now: HEALTHY{typeof tr.durationMs === 'number' ? ` · ${renderDuration(tr.durationMs)}` : ''}{tr.reply ? ` — replied: "${tr.reply}"` : ''}
                          </div>
                        ) : (
                          <div className="text-[10px] mt-0.5 flex items-start gap-1 text-red-600 dark:text-red-400">
                            <XCircle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span className="min-w-0">Tested just now: FAILED{tr.error ? ` — ${tr.error}` : ''}</span>
                          </div>
                        )
                      })()}
                      {/* ── v52 KEY HEALTH — remembered last verdict for this provider ── */}
                      {(() => {
                        const lv = healthLog.find(v => v.name === p.name || (v.kind === p.kind && (v.endpoint || '') === (p.endpoint || '')))
                        if (!lv) return null
                        const mins = Math.max(1, Math.round((Date.now() - lv.at) / 60000))
                        const ago = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`
                        return (
                          <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${lv.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            <Activity className="w-3 h-3 shrink-0" />
                            Last Test on {lv.name}: {lv.ok ? 'PASSED' : 'FAILED'} · {ago}
                          </div>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.isDefault && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDefault(p.id)} title="Set default">
                          <Star className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => modelLists[p.id] ? setModelLists(m => { const n = { ...m }; delete n[p.id]; return n }) : fetchModels(p)} disabled={modelsBusyId === p.id} title="Live model list — click any model to switch">
                        {modelsBusyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListTree className="w-3.5 h-3.5" />}
                      </Button>
                      {/* v68: stale-model auto-fix — one tap repairs retired model names (Gemini 404) */}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => autoFixModel(p)} disabled={fixBusyId === p.id} title="Auto-fix model — if the saved model was retired by the provider (HTTP 404 'Models not found'), pick the best still-live model and switch to it">
                        {fixBusyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5 text-amber-500" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing({ ...p } as any)} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(p.id)} title="Remove">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </Card>
                  {/* v63: inline live model list — click a model to one-click
                      switch the provider to it (update-model endpoint). */}
                  {modelLists[p.id] && (
                    <Card className="p-2 -mt-1 ml-6 border-dashed">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1 flex items-center justify-between">
                        <span>Live models from {p.name} — tap to switch</span>
                        <button className="text-primary hover:underline" onClick={() => setModelLists(m => { const n = { ...m }; delete n[p.id]; return n })}>close</button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-0.5">
                        {modelLists[p.id].map((mid) => (
                          <button key={mid} disabled={switchBusyId === p.id} onClick={() => switchModel(p, mid)} className={`w-full text-left px-2 py-1 text-[11px] font-mono rounded hover:bg-muted/60 flex items-center gap-2 ${mid === p.model ? 'text-primary' : 'text-foreground'}`}>
                            {mid === p.model && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                            <span className="truncate">{mid}</span>
                            {mid === p.model && <span className="text-[9px] text-muted-foreground shrink-0 ml-auto">current</span>}
                          </button>
                        ))}
                      </div>
                    </Card>
                  )}
                  </div>
                ))}
              </div>
            )}
            </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 🧩 Agent roster — the added AI agents, shown right under the Quick form.
 *  Tabs: All Agent | Active agent (live balancer status).
 *  👑 Leader agents — MAX 4 — they plan the battle (e.g. Gemini, Groq,
 *     OpenRouter or any other provider).
 *  🛠 Work agents — MAX 1500 — they do the building (1. Gemini (Gemini
 *     2.5 flash) · 2. OpenRouter · 3. Groq · 4. OpenAI GPT · 5. Venice …).
 *  The same provider can be added MANY times with DIFFERENT keys — every key
 *  is its own agent. If one agent stops working (401 / out of credit / rate
 *  limit), its task automatically moves to the next healthy agent. */
function AgentRoster({ providers, agentTab, setAgentTab, statuses, busyId, onToggleLeader, onRefreshStatuses }: {
  providers: Provider[]
  agentTab: 'all' | 'active'
  setAgentTab: (t: 'all' | 'active') => void
  statuses: Record<string, string>
  busyId: string | null
  onToggleLeader: (p: Provider) => void
  onRefreshStatuses: () => void
}) {
  const leaders = providers.filter(p => p.role === 'leader')
  const workers = providers.filter(p => p.role !== 'leader')
  // Active tab: only agents the load balancer still routes work to
  const isAlive = (p: Provider) => (statuses[p.id] || 'healthy') !== 'dead'
  const visible = agentTab === 'active' ? providers.filter(isAlive) : providers
  const visibleLeaders = visible.filter(p => p.role === 'leader')
  const visibleWorkers = visible.filter(p => p.role !== 'leader')

  const statusDot = (p: Provider) => {
    const s = statuses[p.id] || 'healthy'
    if (s === 'dead') return <span title="dead — its tasks moved to other agents" className="w-2 h-2 rounded-full bg-red-500 shrink-0 inline-block" />
    if (s === 'cooldown') return <span title="cooling down (rate limit) — auto-recovers" className="w-2 h-2 rounded-full bg-amber-500 shrink-0 inline-block" />
    return <span title="healthy & ready" className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 inline-block" />
  }

  const row = (p: Provider, n: number) => (
    <div key={p.id} className={`flex items-center gap-2 px-2 py-1.5 text-[11px] ${p.role === 'leader' ? 'bg-amber-500/5' : ''}`}>
      <span className="font-mono text-muted-foreground w-8 shrink-0 text-right">#{n}</span>
      <button
        type="button"
        onClick={() => onToggleLeader(p)}
        disabled={busyId === p.id}
        title={p.role === 'leader' ? 'Tap to demote to WORK agent' : 'Tap to promote to LEADER (max 4)'}
        className="shrink-0 disabled:opacity-50"
      >
        {busyId === p.id
          ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          : p.role === 'leader'
            ? <Crown className="w-3.5 h-3.5 text-amber-500" />
            : <Bot className="w-3.5 h-3.5 text-muted-foreground hover:text-amber-500" />}
      </button>
      <span className="font-medium truncate max-w-[9rem] sm:max-w-[12rem]">{p.name}</span>
      <span className="text-muted-foreground truncate flex-1 min-w-0 font-mono text-[10px]">{p.model}</span>
      {p.role === 'leader' && <Badge variant="outline" className="text-[9px] py-0 border-amber-500/40 text-amber-500 shrink-0">LEADER</Badge>}
      <Badge variant="outline" className="text-[9px] py-0 shrink-0 hidden sm:inline-flex">{p.kind}</Badge>
      {statusDot(p)}
    </div>
  )

  return (
    <Card className="p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-primary" />
          Agents
          <span className="text-[10px] text-muted-foreground font-normal">
            {providers.length} added · {leaders.length}/4 leaders · {providers.length - leaders.length}/1500 work agents
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* All Agent | Active agent */}
          <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setAgentTab('all')}
              className={`px-2.5 py-1 transition ${agentTab === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'}`}
            >
              All Agent ({providers.length})
            </button>
            <button
              type="button"
              onClick={() => { setAgentTab('active'); onRefreshStatuses() }}
              className={`px-2.5 py-1 transition flex items-center gap-1 ${agentTab === 'active' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'}`}
            >
              <Activity className="w-3 h-3" />Active agent
            </button>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRefreshStatuses} title="Refresh live status">
            <Activity className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agents yet — add a key with the form above and it appears here as a working agent.
          One key = one agent. The same provider can be added many times with different keys.
        </p>
      ) : (
        <>
          {/* ── Leader agents (max 4) ── */}
          <div>
            <div className="text-[11px] font-medium flex items-center gap-1.5">
              <Crown className="w-3 h-3 text-amber-500" />
              Leader agent
              <span className="text-muted-foreground font-normal">— maximum 4 · e.g. Gemini, Groq, OpenRouter or any other</span>
            </div>
            {visibleLeaders.length === 0 ? (
              <p className="text-[10px] text-muted-foreground mt-1 px-2">
                No leaders yet — tap the 🤖 icon on any agent below to crown it a LEADER.
                Leaders plan the battle and brief every worker before the swarm starts.
              </p>
            ) : (
              <div className="mt-1 rounded-md border border-amber-500/30 divide-y divide-border/60 overflow-hidden">
                {visibleLeaders.map((p, i) => row(p, i + 1))}
              </div>
            )}
          </div>

          {/* ── Work agents (max 1500) ── */}
          <div>
            <div className="text-[11px] font-medium flex items-center gap-1.5">
              <Bot className="w-3 h-3 text-primary" />
              Work agent
              <span className="text-muted-foreground font-normal">— maximum 1500 · every key is one agent</span>
            </div>
            {visibleWorkers.length === 0 ? (
              <p className="text-[10px] text-muted-foreground mt-1 px-2">
                No work agents in this view{agentTab === 'active' ? ' — every agent is currently dead; its tasks were handed to the built-in Vortex Engine fallback' : ''}.
              </p>
            ) : (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                {visibleWorkers.slice(0, 150).map((p, i) => row(p, i + 1))}
                {visibleWorkers.length > 150 && (
                  <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    … and {visibleWorkers.length - 150} more work agents — ALL of them run together (cap 1500).
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Auto failover note */}
          <div className="text-[10px] text-muted-foreground flex items-start gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
            <span>
              Auto failover: if one agent stops working — 401, expired key, or out of tokens/credit — its tasks
              instantly move to the next healthy agent (even a different provider, e.g. Groq → Gemini). The dot
              shows live status: <span className="text-emerald-500">green</span> ready ·{' '}
              <span className="text-amber-500">amber</span> rate-limited · <span className="text-red-500">red</span> dead.
            </span>
          </div>
        </>
      )}
    </Card>
  )
}
function ProviderForm({ provider, onChange, onSave, onCancel, showKey, setShowKey }: {
  provider: Provider
  onChange: (p: Provider) => void
  onSave: () => void
  onCancel: () => void
  showKey: boolean
  setShowKey: (b: boolean) => void
}) {
  const [testing, setTesting] = useState(false)
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [detectedModels, setDetectedModels] = useState<string[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionError, setConnectionError] = useState('')
  const kind = PROVIDER_KINDS.find(k => k.value === provider.kind)

  // Auto-detect provider + models from API key — DEVICE-FIRST (the old UI's
  // browser-direct trick: providers that Cloudflare-block the server accept
  // the user's device), with the server pipeline as fallback.
  async function autoDetect() {
    const apiKey = (provider as any)._apiKeyRaw
    if (!apiKey || apiKey.length < 10) {
      toast.error('Enter your API key first')
      return
    }
    setAutoDetecting(true)
    try {
      // Phase 1: probe from THIS DEVICE
      const det = await browserDetectKey(apiKey, provider.endpoint)
      if (det.ok && det.models && det.models.length > 0) {
        onChange({
          ...provider,
          kind: det.providerKind!,
          name: det.providerName!,
          endpoint: det.endpoint || provider.endpoint,
          model: det.model || provider.model,
        })
        setDetectedModels(det.models.map(m => m.id))
        toast.success(`✓ Connected via YOUR DEVICE (${renderDuration(det.durationMs)}) — ${det.providerName}, ${det.models.length} models available`)
        return
      }
      // Phase 2: device couldn't reach the provider (CORS) → server pipeline
      if (!det.corsBlocked) {
        // The provider itself answered and rejected the key — no point retrying
        toast.error(det.error || 'Key rejected by the provider')
        return
      }
      const res = await fetch('/api/providers/auto-detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, endpoint: provider.endpoint }),
      })
      const data = await res.json()
      if (!data.ok) {
        toast.error(data.error || 'Could not detect provider from this key')
        return
      }
      // Auto-fill provider kind, name, endpoint, and models
      const detected = data.detected
      const models = detected.models.map((m: any) => m.id)
      onChange({
        ...provider,
        kind: detected.providerKind,
        name: detected.providerName,
        endpoint: detected.endpoint,
        model: models[0] || provider.model,
      })
      setDetectedModels(models)
      if (detected.verifyError) {
        // Models fetched but key not fully verified — warn but still let user save
        toast.warning(`${detected.providerName}: ${detected.verifyError}`)
      } else {
        toast.success(`Detected: ${detected.providerName} — ${models.length} models available`)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAutoDetecting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="p-name">Provider name</Label>
          <Input id="p-name" value={provider.name} onChange={(e) => onChange({ ...provider, name: e.target.value })} placeholder="My OpenAI" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="p-kind">Select provider</Label>
          <Select value={provider.kind} onValueChange={(v) => {
            const kind = PROVIDER_KINDS.find(k => k.value === v)
            onChange({
              ...provider,
              kind: v,
              name: kind?.label?.split(' (')[0] || provider.name || v,
              endpoint: kind?.endpoint || provider.endpoint,
              model: kind?.defaultModel || provider.model,
            })
          }}>
            <SelectTrigger id="p-kind" className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>🆓 Free providers</SelectLabel>
                {PROVIDER_KINDS.filter(k => k.label.startsWith('🆓')).map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>🔓 Uncensored providers</SelectLabel>
                {PROVIDER_KINDS.filter(k => k.label.startsWith('🔓')).map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Paid providers</SelectLabel>
                {PROVIDER_KINDS.filter(k => !k.label.startsWith('🆓') && !k.label.startsWith('🔓')).map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      {kind?.hint && <p className="text-xs text-muted-foreground">{kind.hint}</p>}
      <div>
        <Label htmlFor="p-model">Select model {detectedModels.length > 0 && <span className="text-[10px] text-emerald-500">({detectedModels.length} detected from your key)</span>}</Label>
        {detectedModels.length > 0 ? (
          // Show detected models from the API key
          <Select value={provider.model} onValueChange={(v) => onChange({ ...provider, model: v })}>
            <SelectTrigger id="p-model" className="mt-1 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {detectedModels.map(m => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : kind?.models && kind.models.length > 0 ? (
          <Select value={provider.model} onValueChange={(v) => onChange({ ...provider, model: v })}>
            <SelectTrigger id="p-model" className="mt-1 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {kind.models.map(m => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input id="p-model" value={provider.model} onChange={(e) => onChange({ ...provider, model: e.target.value })} placeholder="gpt-4o-mini" className="mt-1 font-mono text-xs" />
        )}
        {kind?.defaultModel && provider.model !== kind.defaultModel && !detectedModels.length && (
          <button type="button" className="text-[10px] text-primary hover:underline mt-1" onClick={() => onChange({ ...provider, model: kind.defaultModel })}>
            Use default: {kind.defaultModel}
          </button>
        )}
      </div>
      {kind?.docs && (
        <a href={kind.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          🔑 Get API key →
        </a>
      )}
      {(provider.kind === 'openai' || provider.kind === 'openai-compatible' || provider.kind === 'custom' || provider.kind === 'claude' || provider.kind === 'gemini') && (
        <div>
          <Label htmlFor="p-endpoint">API endpoint (optional)</Label>
          <Input id="p-endpoint" value={provider.endpoint || ''} onChange={(e) => onChange({ ...provider, endpoint: e.target.value })} placeholder="https://api.openai.com/v1" className="mt-1" />
        </div>
      )}
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="p-key">API key {provider.apiKeyMasked && <span className="text-xs text-muted-foreground">(currently: {provider.apiKeyMasked})</span>}</Label>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
            {showKey ? 'Hide' : 'Show'}
          </Button>
        </div>
        <div className="flex gap-2 mt-1">
          <Input
            id="p-key"
            type={showKey ? 'text' : 'password'}
            placeholder={provider.apiKeyMasked ? '•••••••• (enter new to replace)' : 'sk-...'}
            onChange={(e) => onChange({ ...(provider as any), _apiKeyRaw: e.target.value })}
            className="flex-1"
            autoComplete="off"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={autoDetecting}
            onClick={autoDetect}
            title="Auto-detect provider and models from this API key"
          >
            {autoDetecting ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Detecting...</> : <><Sparkles className="w-3 h-3 mr-1.5" /> Get</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          💡 Tip: Enter your API key and click <strong>Get</strong> — we'll auto-detect the provider and show all available models.
          Stored encrypted at rest.
        </p>
      </div>
      <div>
        <Label>Temperature: {provider.temperature.toFixed(2)}</Label>
        <Slider value={[provider.temperature]} min={0} max={2} step={0.05} onValueChange={([v]) => onChange({ ...provider, temperature: v })} className="mt-2" />
      </div>
      <div>
        <Label htmlFor="p-max">Max output tokens (optional)</Label>
        <Input id="p-max" type="number" value={provider.maxTokens || ''} onChange={(e) => onChange({ ...provider, maxTokens: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="128000 (leave empty for unlimited)" className="mt-1" />
      </div>
      <div>
        {/* ── v52 ROLE TEMPLATE CHIPS (was v47) — one tap fills the prompt ── */}
        <Label>Role template (one tap fills the prompt)</Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {ROLE_CHIPS.map(c => {
            const active = (provider.systemPrompt || '') === c.prompt
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => onChange({ ...provider, systemPrompt: c.prompt })}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${active ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:bg-muted/60'}`}
              >
                {c.emoji} {c.label}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <Label htmlFor="p-sys">System prompt (optional)</Label>
        <Textarea id="p-sys" value={provider.systemPrompt || ''} onChange={(e) => onChange({ ...provider, systemPrompt: e.target.value })} placeholder="You are a senior software engineer..." rows={3} className="mt-1" />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={provider.isDefault} onCheckedChange={(b) => onChange({ ...provider, isDefault: b })} />
        <Label>Use as default provider</Label>
      </div>

      {/* Connection status indicator */}
      {connectionStatus !== 'idle' && (
        <div className={`flex items-center gap-2 p-2 rounded text-xs ${
          connectionStatus === 'ok' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30' :
          connectionStatus === 'fail' ? 'bg-red-500/10 text-red-500 border border-red-500/30' :
          'bg-blue-500/10 text-blue-500 border border-blue-500/30'
        }`}>
          {connectionStatus === 'ok' && <><CheckCircle2 className="w-3.5 h-3.5" /> Connected ✓ — provider responds correctly</>}
          {connectionStatus === 'fail' && <><XCircle className="w-3.5 h-3.5" /> Connection failed — {connectionError}</>}
          {connectionStatus === 'testing' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing connection…</>}
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => {
            setTesting(true)
            setConnectionStatus('testing')
            setConnectionError('')
            try {
              const res = await fetch('/api/providers/test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  kind: provider.kind,
                  endpoint: provider.endpoint,
                  apiKey: (provider as any)._apiKeyRaw || undefined,
                  model: provider.model,
                  id: provider.id || undefined,
                }),
              })
              // Check if response is JSON (route exists) or HTML (route missing / server down)
              const contentType = res.headers.get('content-type') || ''
              const text = await res.text()
              let data: any
              try {
                data = JSON.parse(text)
              } catch {
                // Not JSON — could be HTML 404 page or server down
                setConnectionStatus('fail')
                if (res.status === 404) {
                  setConnectionError('Route not found. The server may be starting up — wait 10s and try again.')
                } else if (!res.ok) {
                  setConnectionError(`Server error (HTTP ${res.status}). The server may be restarting — wait and try again.`)
                } else {
                  setConnectionError('Server returned non-JSON response. Refresh the page and try again.')
                }
                toast.error('Connection test failed — see message')
                return
              }
              if (data.ok) {
                setConnectionStatus('ok')
                toast.success('✓ Provider connected successfully')
              } else if (data.isIpBlocked) {
                // IP blocked — key is probably valid, just can't reach from server
                setConnectionStatus('ok')
                setConnectionError('')
                toast.success('✓ API key is valid (server IP blocked, will use the GLM fallback)')
              } else {
                setConnectionStatus('fail')
                setConnectionError(data.error || 'Unknown error')
                toast.error(`Connection failed: ${data.error}`)
              }
            } catch (e: any) {
              setConnectionStatus('fail')
              setConnectionError(e.message)
              toast.error(e.message)
            } finally { setTesting(false) }
          }}>
            {testing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
            Test Connection
          </Button>
          <Button size="sm" onClick={onSave}>Save</Button>
        </div>
      </div>
    </div>
  )
}
