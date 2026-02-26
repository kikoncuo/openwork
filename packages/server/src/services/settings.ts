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
interface MCPServerConfigBase {
  id: string
  name: string
  enabled: boolean
}

export interface MCPServerStdioConfig extends MCPServerConfigBase {
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface MCPServerHttpConfig extends MCPServerConfigBase {
  transport: 'http'
  url: string
  headers?: Record<string, string>
  auth?: {
    type: 'oauth' | 'bearer' | 'none'
    bearerToken?: string
    oauthServerId?: string
  }
}

export type MCPServerConfig = MCPServerStdioConfig | MCPServerHttpConfig

/**
 * Normalize a loaded server config for backwards compatibility.
 * Old configs without a transport field but with command are treated as stdio.
 */
function normalizeMcpServer(raw: Record<string, unknown>): MCPServerConfig {
  if (raw.transport === 'http') {
    return raw as unknown as MCPServerHttpConfig
  }
  // Legacy or explicit stdio
  return {
    transport: 'stdio',
    id: raw.id as string,
    name: raw.name as string,
    command: raw.command as string,
    args: (raw.args as string[]) || [],
    enabled: raw.enabled as boolean,
    ...(raw.env ? { env: raw.env as Record<string, string> } : {})
  }
}

// Get all MCP server configs
export function getMcpServers(): MCPServerConfig[] {
  const raw = getSetting<Record<string, unknown>[]>('mcpServers', [])
  return raw.map(normalizeMcpServer)
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
  return getSetting<string>('defaultModel', 'claude-opus-4-5-20251101')
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

// Sandbox backend configuration
export interface SandboxBackendConfig {
  type: 'buddy' | 'local'  // 'buddy' = E2B Cloud, 'local' = Docker on client
  localHost: string
  localPort: number
}

const DEFAULT_SANDBOX_CONFIG: SandboxBackendConfig = {
  type: 'buddy',
  localHost: 'localhost',
  localPort: 8080
}

export function getSandboxBackendConfig(): SandboxBackendConfig {
  return getSetting<SandboxBackendConfig>('sandboxBackend', DEFAULT_SANDBOX_CONFIG)
}

export function setSandboxBackendConfig(config: SandboxBackendConfig): void {
  setSetting('sandboxBackend', config)
}

export function getSandboxBackendType(): 'buddy' | 'local' {
  return getSandboxBackendConfig().type
}
