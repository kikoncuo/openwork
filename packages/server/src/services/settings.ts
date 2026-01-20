/**
 * Settings storage service - replaces electron-store for web
 * Uses JSON file storage in ~/.openwork/settings.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

const OPENWORK_DIR = join(homedir(), '.openwork')
const SETTINGS_FILE = join(OPENWORK_DIR, 'settings.json')

// In-memory cache
let settingsCache: Record<string, unknown> | null = null

function ensureDir(): void {
  if (!existsSync(OPENWORK_DIR)) {
    mkdirSync(OPENWORK_DIR, { recursive: true })
  }
}

function loadSettings(): Record<string, unknown> {
  if (settingsCache !== null) return settingsCache

  ensureDir()

  if (existsSync(SETTINGS_FILE)) {
    try {
      const content = readFileSync(SETTINGS_FILE, 'utf-8')
      settingsCache = JSON.parse(content) as Record<string, unknown>
    } catch {
      settingsCache = {}
    }
  } else {
    settingsCache = {}
  }

  return settingsCache
}

function saveSettings(): void {
  ensureDir()
  writeFileSync(SETTINGS_FILE, JSON.stringify(settingsCache, null, 2))
}

export function getSetting<T>(key: string, defaultValue?: T): T {
  const settings = loadSettings()
  return (settings[key] as T) ?? (defaultValue as T)
}

export function setSetting<T>(key: string, value: T): void {
  loadSettings()
  if (settingsCache) {
    settingsCache[key] = value
    saveSettings()
  }
}

export function deleteSetting(key: string): void {
  loadSettings()
  if (settingsCache) {
    delete settingsCache[key]
    saveSettings()
  }
}

// MCP Server types
export interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
  env?: Record<string, string>
}

// Get all MCP server configs
export function getMcpServers(): MCPServerConfig[] {
  return getSetting<MCPServerConfig[]>('mcpServers', [])
}

// Get enabled MCP servers
export function getEnabledMcpServers(): MCPServerConfig[] {
  return getMcpServers().filter((s) => s.enabled)
}

// Save MCP servers
export function saveMcpServers(servers: MCPServerConfig[]): void {
  setSetting('mcpServers', servers)
}

// Tool enable/disable state with interrupt option
export interface ToolConfig {
  id: string
  enabled: boolean
  requireApproval?: boolean
}

export function getToolConfigs(): ToolConfig[] {
  return getSetting<ToolConfig[]>('toolConfigs', [])
}

export function saveToolConfigs(configs: ToolConfig[]): void {
  setSetting('toolConfigs', configs)
}

// Get tool configs as a map for quick lookup
export function getToolConfigMap(): Record<string, ToolConfig> {
  const configs = getToolConfigs()
  return configs.reduce(
    (acc, config) => {
      acc[config.id] = config
      return acc
    },
    {} as Record<string, ToolConfig>
  )
}

export function getDefaultModel(): string {
  return getSetting<string>('defaultModel', 'claude-sonnet-4-5-20250929')
}

export function setDefaultModel(modelId: string): void {
  setSetting('defaultModel', modelId)
}

// Recent workspaces tracking
const MAX_RECENT_WORKSPACES = 10

export function getRecentWorkspaces(): string[] {
  return getSetting<string[]>('recentWorkspaces', [])
}

export function addRecentWorkspace(workspacePath: string): void {
  const recent = getRecentWorkspaces()

  // Remove if already exists (to move to front)
  const filtered = recent.filter(p => p !== workspacePath)

  // Add to front
  filtered.unshift(workspacePath)

  // Keep only the most recent
  const trimmed = filtered.slice(0, MAX_RECENT_WORKSPACES)

  setSetting('recentWorkspaces', trimmed)
}
