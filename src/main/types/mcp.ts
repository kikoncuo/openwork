/**
 * MCP Server configuration types
 */

/**
 * Configuration for a single MCP tool
 */
export interface MCPToolConfig {
  /** Whether this tool is enabled */
  enabled: boolean
  /** If true, require human approval before calling this tool */
  requireInterrupt?: boolean
  /** Tool description override (optional) */
  description?: string
}

/**
 * Type of MCP server connection
 */
export type MCPServerType = 'url' | 'stdio'

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  /** Unique identifier for this server */
  id: string
  /** Display name */
  name: string
  /** Server type (url or stdio) */
  type: MCPServerType
  /** Server URL (for type: 'url') */
  url?: string
  /** Authorization token (optional, for type: 'url') */
  authToken?: string
  /** Command to run (for type: 'stdio') */
  command?: string
  /** Command arguments (for type: 'stdio') */
  args?: string[]
  /** Environment variables (for type: 'stdio') */
  env?: Record<string, string>
  /** Whether this server is enabled */
  enabled: boolean
  /** Per-tool configurations */
  toolConfigs?: Record<string, MCPToolConfig>
  /** Default: require interrupt for all tools from this server */
  defaultRequireInterrupt?: boolean
  /** Created timestamp */
  createdAt: string
  /** Updated timestamp */
  updatedAt: string
}

/**
 * MCP Server configuration for creating/updating
 */
export interface MCPServerInput {
  name: string
  type: MCPServerType
  url?: string
  authToken?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  toolConfigs?: Record<string, MCPToolConfig>
  defaultRequireInterrupt?: boolean
}
