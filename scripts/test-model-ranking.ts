/* Sanity-check scoreModelDefault + sortModelsDefaultFirst + NON_CHAT filter */
import { scoreModelDefault, sortModelsDefaultFirst, NON_CHAT_MODEL_RE } from '../src/lib/ai/key-detect'

const geminiJunk = ['veo-3.1-lite-generate-preview', 'gemini-3.1-flash-live-preview', 'gemini-robotics-er-2-streaming-preview', 'gemini-3.5-live-translate-preview', 'gemini-2.0-flash-001', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash-latest', 'text-embedding-004']
const kept = geminiJunk.filter(id => !NON_CHAT_MODEL_RE.test(id.toLowerCase()))
console.log('gemini kept after filter:', kept)
console.log('gemini sorted:', sortModelsDefaultFirst(kept.map(id => ({ id }))).map(m => `${scoreModelDefault(m.id)} ${m.id}`))

const groqIds = ['llama-3.2-1b-preview', 'llama-3.3-70b-versatile', 'gemma2-9b-it', 'mixtral-8x7b-32768', 'llama-guard-3-8b', 'whisper-large-v3-turbo']
const groqKept = groqIds.filter(id => !NON_CHAT_MODEL_RE.test(id.toLowerCase()))
console.log('groq sorted:', sortModelsDefaultFirst(groqKept.map(id => ({ id }))).map(m => `${scoreModelDefault(m.id)} ${m.id}`))

const openrouterIds = ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet:beta', 'deepseek/deepseek-r1:free', 'qwen/qwen-2.5-72b-instruct']
console.log('openrouter sorted:', sortModelsDefaultFirst(openrouterIds.map(id => ({ id }))).map(m => `${scoreModelDefault(m.id)} ${m.id}`))
