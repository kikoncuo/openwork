import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { MCPServerConfig, MCPServerInput } from './types/mcp'

const OPENWORK_DIR = join(homedir(), '.openwork')
const ENV_FILE = join(OPENWORK_DIR, '.env')
const MCP_SERVERS_FILE = join(OPENWORK_DIR, 'mcp-servers.json')

// Environment variable names for each provider
const ENV_VAR_NAMES: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY'
}

export function getOpenworkDir(): string {
  if (!existsSync(OPENWORK_DIR)) {
    mkdirSync(OPENWORK_DIR, { recursive: true })
  }
  return OPENWORK_DIR
}

export function getDbPath(): string {
  return join(getOpenworkDir(), 'openwork.sqlite')
}

export function getCheckpointDbPath(): string {
  return join(getOpenworkDir(), 'langgraph.sqlite')
}

export function getThreadCheckpointDir(): string {
  const dir = join(getOpenworkDir(), 'threads')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getThreadCheckpointPath(threadId: string): string {
  return join(getThreadCheckpointDir(), `${threadId}.sqlite`)
}

export function deleteThreadCheckpoint(threadId: string): void {
  const path = getThreadCheckpointPath(threadId)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export function getEnvFilePath(): string {
  return ENV_FILE
}

// Read .env file and parse into object
function parseEnvFile(): Record<string, string> {
  const envPath = getEnvFilePath()
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, 'utf-8')
  const result: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      result[key] = value
    }
  }
  return result
}

// Write object back to .env file
function writeEnvFile(env: Record<string, string>): void {
  getOpenworkDir() // ensure dir exists
  const lines = Object.entries(env)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
  writeFileSync(getEnvFilePath(), lines.join('\n') + '\n')
}

// API key management
export function getApiKey(provider: string): string | undefined {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return undefined

  // Check .env file first
  const env = parseEnvFile()
  if (env[envVarName]) return env[envVarName]

  // Fall back to process environment
  return process.env[envVarName]
}

export function setApiKey(provider: string, apiKey: string): void {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return

  const env = parseEnvFile()
  env[envVarName] = apiKey
  writeEnvFile(env)

  // Also set in process.env for current session
  process.env[envVarName] = apiKey
}

export function deleteApiKey(provider: string): void {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return

  const env = parseEnvFile()
  delete env[envVarName]
  writeEnvFile(env)

  // Also clear from process.env
  delete process.env[envVarName]
}

export function hasApiKey(provider: string): boolean {
  return !!getApiKey(provider)
}

// MCP Server management
function getMCPServersFilePath(): string {
  return MCP_SERVERS_FILE
}

function readMCPServersFile(): MCPServerConfig[] {
  const path = getMCPServersFilePath()
  if (!existsSync(path)) return []

  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as MCPServerConfig[]
  } catch (error) {
    console.error('[Storage] Failed to read MCP servers file:', error)
    return []
  }
}

function writeMCPServersFile(servers: MCPServerConfig[]): void {
  getOpenworkDir() // ensure dir exists
  const path = getMCPServersFilePath()
  writeFileSync(path, JSON.stringify(servers, null, 2))
}

export function listMCPServers(): MCPServerConfig[] {
  return readMCPServersFile()
}

export function getMCPServer(id: string): MCPServerConfig | null {
  const servers = readMCPServersFile()
  return servers.find((s) => s.id === id) || null
}

export function createMCPServer(input: MCPServerInput): MCPServerConfig {
  const servers = readMCPServersFile()

  // Generate unique ID
  const id = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const now = new Date().toISOString()
  const server: MCPServerConfig = {
    id,
    name: input.name,
    type: input.type,
    url: input.url,
    authToken: input.authToken,
    command: input.command,
    args: input.args,
    env: input.env,
    enabled: input.enabled ?? true,
    toolConfigs: input.toolConfigs || {},
    defaultRequireInterrupt: input.defaultRequireInterrupt ?? true,
    createdAt: now,
    updatedAt: now
  }

  servers.push(server)
  writeMCPServersFile(servers)

  return server
}

export function updateMCPServer(id: string, updates: Partial<MCPServerInput>): MCPServerConfig | null {
  const servers = readMCPServersFile()
  const index = servers.findIndex((s) => s.id === id)

  if (index === -1) return null

  const now = new Date().toISOString()
  servers[index] = {
    ...servers[index],
    ...updates,
    updatedAt: now
  }

  writeMCPServersFile(servers)
  return servers[index]
}

export function deleteMCPServer(id: string): boolean {
  const servers = readMCPServersFile()
  const filtered = servers.filter((s) => s.id !== id)

  if (filtered.length === servers.length) return false

  writeMCPServersFile(filtered)
  return true
}

export function getEnabledMCPServers(): MCPServerConfig[] {
  return readMCPServersFile().filter((s) => s.enabled)
}
