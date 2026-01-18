import { v4 as uuidv4 } from 'uuid'
import { getDb, saveToDisk, Agent, AgentConfig } from './index'
import { getCustomPrompt, getLearnedInsights } from '../storage'

// Re-export types
export type { Agent, AgentConfig }

// Agent icon types
export type AgentIcon = 'bot' | 'sparkles' | 'code' | 'pen' | 'search' | 'terminal' | 'brain' | 'shield'

export const AGENT_ICONS: AgentIcon[] = ['bot', 'sparkles', 'code', 'pen', 'search', 'terminal', 'brain', 'shield']

// Default colors palette
export const AGENT_COLORS = [
  '#8B5CF6', // Purple (default)
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#14B8A6', // Teal
]

// ============= AGENT CRUD =============

export function getAllAgents(): Agent[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM agents ORDER BY is_default DESC, created_at ASC')
  const agents: Agent[] = []

  while (stmt.step()) {
    agents.push(stmt.getAsObject() as unknown as Agent)
  }
  stmt.free()

  return agents
}

export function getAgent(agentId: string): Agent | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM agents WHERE agent_id = ?')
  stmt.bind([agentId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const agent = stmt.getAsObject() as unknown as Agent
  stmt.free()
  return agent
}

export function getDefaultAgent(): Agent | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM agents WHERE is_default = 1')

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const agent = stmt.getAsObject() as unknown as Agent
  stmt.free()
  return agent
}

export interface CreateAgentInput {
  name: string
  color?: string
  icon?: AgentIcon
  model_default?: string
  is_default?: boolean
}

export function createAgent(input: CreateAgentInput): Agent {
  const db = getDb()
  const now = Date.now()
  const agentId = uuidv4()

  const agent: Agent = {
    agent_id: agentId,
    name: input.name,
    color: input.color || '#8B5CF6',
    icon: input.icon || 'bot',
    model_default: input.model_default || 'claude-sonnet-4-5-20250929',
    is_default: input.is_default ? 1 : 0,
    created_at: now,
    updated_at: now,
  }

  db.run(
    `INSERT INTO agents (agent_id, name, color, icon, model_default, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [agent.agent_id, agent.name, agent.color, agent.icon, agent.model_default, agent.is_default, agent.created_at, agent.updated_at]
  )

  // Create empty config for the agent
  db.run(
    `INSERT INTO agent_configs (agent_id, tool_configs, mcp_servers, custom_prompt, learned_insights, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [agentId, null, null, null, null, now]
  )

  saveToDisk()
  return agent
}

export interface UpdateAgentInput {
  name?: string
  color?: string
  icon?: AgentIcon
  model_default?: string
}

export function updateAgent(agentId: string, updates: UpdateAgentInput): Agent | null {
  const db = getDb()
  const existing = getAgent(agentId)

  if (!existing) return null

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]

  if (updates.name !== undefined) {
    setClauses.push('name = ?')
    values.push(updates.name)
  }
  if (updates.color !== undefined) {
    setClauses.push('color = ?')
    values.push(updates.color)
  }
  if (updates.icon !== undefined) {
    setClauses.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.model_default !== undefined) {
    setClauses.push('model_default = ?')
    values.push(updates.model_default)
  }

  values.push(agentId)

  db.run(`UPDATE agents SET ${setClauses.join(', ')} WHERE agent_id = ?`, values)

  saveToDisk()
  return getAgent(agentId)
}

export function deleteAgent(agentId: string): { success: boolean; error?: string; reassignedThreads?: number } {
  const db = getDb()
  const agent = getAgent(agentId)

  if (!agent) {
    return { success: false, error: 'Agent not found' }
  }

  if (agent.is_default === 1) {
    return { success: false, error: 'Cannot delete the default agent' }
  }

  const defaultAgent = getDefaultAgent()
  if (!defaultAgent) {
    return { success: false, error: 'No default agent found to reassign threads' }
  }

  // Count threads that will be reassigned
  const countResult = db.exec(`SELECT COUNT(*) as count FROM threads WHERE agent_id = ?`, [agentId])
  const reassignedThreads = countResult[0]?.values?.[0]?.[0] as number || 0

  // Reassign threads to default agent
  db.run(`UPDATE threads SET agent_id = ? WHERE agent_id = ?`, [defaultAgent.agent_id, agentId])

  // Delete agent (agent_configs will cascade delete)
  db.run(`DELETE FROM agents WHERE agent_id = ?`, [agentId])

  saveToDisk()
  return { success: true, reassignedThreads }
}

export function getAgentThreadCount(agentId: string): number {
  const db = getDb()
  const result = db.exec(`SELECT COUNT(*) as count FROM threads WHERE agent_id = ?`, [agentId])
  return (result[0]?.values?.[0]?.[0] as number) || 0
}

// ============= AGENT CONFIG CRUD =============

export function getAgentConfig(agentId: string): AgentConfig | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM agent_configs WHERE agent_id = ?')
  stmt.bind([agentId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const config = stmt.getAsObject() as unknown as AgentConfig
  stmt.free()
  return config
}

export interface UpdateAgentConfigInput {
  tool_configs?: unknown[]
  mcp_servers?: unknown[]
  custom_prompt?: string | null
  learned_insights?: unknown[]
}

export function updateAgentConfig(agentId: string, updates: UpdateAgentConfigInput): AgentConfig | null {
  const db = getDb()
  const existing = getAgentConfig(agentId)

  if (!existing) {
    // Create config if it doesn't exist
    const now = Date.now()
    db.run(
      `INSERT INTO agent_configs (agent_id, tool_configs, mcp_servers, custom_prompt, learned_insights, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        agentId,
        updates.tool_configs ? JSON.stringify(updates.tool_configs) : null,
        updates.mcp_servers ? JSON.stringify(updates.mcp_servers) : null,
        updates.custom_prompt ?? null,
        updates.learned_insights ? JSON.stringify(updates.learned_insights) : null,
        now,
      ]
    )
    return getAgentConfig(agentId)
  }

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.tool_configs !== undefined) {
    setClauses.push('tool_configs = ?')
    values.push(JSON.stringify(updates.tool_configs))
  }
  if (updates.mcp_servers !== undefined) {
    setClauses.push('mcp_servers = ?')
    values.push(JSON.stringify(updates.mcp_servers))
  }
  if (updates.custom_prompt !== undefined) {
    setClauses.push('custom_prompt = ?')
    values.push(updates.custom_prompt)
  }
  if (updates.learned_insights !== undefined) {
    setClauses.push('learned_insights = ?')
    values.push(JSON.stringify(updates.learned_insights))
  }

  values.push(agentId)

  db.run(`UPDATE agent_configs SET ${setClauses.join(', ')} WHERE agent_id = ?`, values)

  saveToDisk()
  return getAgentConfig(agentId)
}

// ============= MIGRATION HELPERS =============

/**
 * Ensure default agent exists, creating it if necessary
 * Returns the default agent
 */
export function ensureDefaultAgent(): Agent {
  let defaultAgent = getDefaultAgent()

  if (!defaultAgent) {
    // Create the default BUDDY agent
    defaultAgent = createAgent({
      name: 'BUDDY',
      color: '#8B5CF6',
      icon: 'bot',
      is_default: true,
    })
  }

  return defaultAgent
}

/**
 * Assign all threads without an agent to the default agent
 */
export function assignOrphanedThreadsToDefault(): number {
  const db = getDb()
  const defaultAgent = ensureDefaultAgent()

  // Count orphaned threads
  const countResult = db.exec(`SELECT COUNT(*) as count FROM threads WHERE agent_id IS NULL`)
  const count = (countResult[0]?.values?.[0]?.[0] as number) || 0

  if (count > 0) {
    db.run(`UPDATE threads SET agent_id = ? WHERE agent_id IS NULL`, [defaultAgent.agent_id])
    saveToDisk()
  }

  return count
}

/**
 * Run all agent-related migrations
 * Called during database initialization
 */
export async function runAgentMigrations(): Promise<void> {
  // Ensure default agent exists
  const defaultAgent = ensureDefaultAgent()

  // Migrate existing file-based settings to default agent's config
  const existingConfig = getAgentConfig(defaultAgent.agent_id)

  // Only migrate if config is empty (first run after upgrade)
  if (existingConfig && !existingConfig.custom_prompt && !existingConfig.learned_insights) {
    // Import getMcpServers and getToolConfigs lazily to avoid circular deps
    const { getMcpServers, getToolConfigs } = await import('../ipc/models')

    const customPrompt = getCustomPrompt()
    const learnedInsights = getLearnedInsights()
    const mcpServers = getMcpServers()
    const toolConfigs = getToolConfigs()

    // Only update if there's something to migrate
    if (customPrompt || learnedInsights.length > 0 || mcpServers.length > 0 || toolConfigs.length > 0) {
      updateAgentConfig(defaultAgent.agent_id, {
        custom_prompt: customPrompt,
        learned_insights: learnedInsights.length > 0 ? learnedInsights : undefined,
        mcp_servers: mcpServers.length > 0 ? mcpServers : undefined,
        tool_configs: toolConfigs.length > 0 ? toolConfigs : undefined,
      })
      console.log('Migrated existing settings to default agent config')
    }
  }

  // Assign orphaned threads to default agent
  const orphanedCount = assignOrphanedThreadsToDefault()
  if (orphanedCount > 0) {
    console.log(`Assigned ${orphanedCount} orphaned threads to default agent`)
  }
}
