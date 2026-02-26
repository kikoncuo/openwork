import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'

const OPENWORK_DIR = join(homedir(), '.openwork')

// Environment variable names for each provider
// API keys are now managed server-side via process.env (loaded from server .env)
const ENV_VAR_NAMES: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY'
}

export function getOpenworkDir(): string {
  if (!existsSync(OPENWORK_DIR)) {
    mkdirSync(OPENWORK_DIR, { recursive: true })
  }
  return OPENWORK_DIR
}

// API key management - reads only from process.env (loaded from server .env)
// User-facing API key management has been removed for tier-based model management
export function getApiKey(provider: string): string | undefined {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return undefined

  // Only read from process.env (server .env is loaded at startup)
  return process.env[envVarName]
}

export function hasApiKey(provider: string): boolean {
  return !!getApiKey(provider)
}

// Custom system prompt management
const CUSTOM_PROMPT_FILE = join(OPENWORK_DIR, 'custom-prompt.txt')
const LEARNED_INSIGHTS_FILE = join(OPENWORK_DIR, 'learned-insights.json')

export interface LearnedInsight {
  id: string
  content: string
  source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
  createdAt: string
  enabled: boolean
}

export function getCustomPrompt(): string | null {
  getOpenworkDir() // ensure dir exists
  if (!existsSync(CUSTOM_PROMPT_FILE)) return null
  return readFileSync(CUSTOM_PROMPT_FILE, 'utf-8')
}

export function setCustomPrompt(prompt: string | null): void {
  getOpenworkDir() // ensure dir exists
  if (prompt === null || prompt.trim() === '') {
    if (existsSync(CUSTOM_PROMPT_FILE)) {
      unlinkSync(CUSTOM_PROMPT_FILE)
    }
  } else {
    writeFileSync(CUSTOM_PROMPT_FILE, prompt)
  }
}

export function getLearnedInsights(): LearnedInsight[] {
  getOpenworkDir() // ensure dir exists
  if (!existsSync(LEARNED_INSIGHTS_FILE)) return []
  try {
    const content = readFileSync(LEARNED_INSIGHTS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

export function saveLearnedInsights(insights: LearnedInsight[]): void {
  getOpenworkDir() // ensure dir exists
  writeFileSync(LEARNED_INSIGHTS_FILE, JSON.stringify(insights, null, 2))
}

export function addLearnedInsight(content: string, source: LearnedInsight['source']): LearnedInsight {
  const insights = getLearnedInsights()
  const newInsight: LearnedInsight = {
    id: `insight-${Date.now()}`,
    content,
    source,
    createdAt: new Date().toISOString(),
    enabled: true
  }
  insights.push(newInsight)
  saveLearnedInsights(insights)
  return newInsight
}

export function removeLearnedInsight(id: string): void {
  const insights = getLearnedInsights().filter(i => i.id !== id)
  saveLearnedInsights(insights)
}

export function toggleLearnedInsight(id: string): void {
  const insights = getLearnedInsights().map(i =>
    i.id === id ? { ...i, enabled: !i.enabled } : i
  )
  saveLearnedInsights(insights)
}
