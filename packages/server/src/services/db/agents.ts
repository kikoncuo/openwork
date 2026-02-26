import { v4 as uuidv4 } from 'uuid'
import { getSupabase } from './supabase-client.js'
import type { Agent, AgentConfig, AgentToolConfig } from './index.js'
import { getCustomPrompt, getLearnedInsights } from '../storage.js'
import { getMcpServers, getToolConfigs } from '../settings.js'

// Re-export types
export type { Agent, AgentConfig, AgentToolConfig }

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

export async function getAllAgents(): Promise<Agent[]> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getAllAgents: ${error.message}`)
  return (data || []) as unknown as Agent[]
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .eq('agent_id', agentId)
    .single()
  if (error || !data) return null
  return data as unknown as Agent
}

export async function getDefaultAgent(): Promise<Agent | null> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .eq('is_default', 1)
    .limit(1)
    .single()
  if (error || !data) return null
  return data as unknown as Agent
}

export async function getAgentsByUserId(userId: string): Promise<Agent[]> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getAgentsByUserId: ${error.message}`)
  return (data || []) as unknown as Agent[]
}

export async function getDefaultAgentForUser(userId: string): Promise<Agent | null> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', 1)
    .limit(1)
    .single()
  if (error || !data) return null
  return data as unknown as Agent
}

export interface CreateAgentInput {
  name: string
  color?: string
  icon?: AgentIcon
  model_default?: string
  is_default?: boolean
  user_id?: string
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const now = Date.now()
  const agentId = uuidv4()

  const agent: Agent = {
    agent_id: agentId,
    name: input.name,
    color: input.color || '#8B5CF6',
    icon: input.icon || 'bot',
    model_default: input.model_default || 'claude-opus-4-5-20251101',
    is_default: input.is_default ? 1 : 0,
    user_id: input.user_id || null,
    e2b_sandbox_id: null,
    created_at: now,
    updated_at: now,
  }

  const { error } = await getSupabase().from('agents').insert(agent)
  if (error) throw new Error(`createAgent: ${error.message}`)

  // Create empty config for the agent
  const { error: configError } = await getSupabase().from('agent_configs').insert({
    agent_id: agentId,
    tool_configs: null,
    mcp_servers: null,
    custom_prompt: null,
    learned_insights: null,
    enabled_skills: null,
    updated_at: now,
  })
  if (configError) throw new Error(`createAgent config: ${configError.message}`)

  return agent
}

export interface UpdateAgentInput {
  name?: string
  color?: string
  icon?: AgentIcon
  model_default?: string
}

export async function updateAgent(agentId: string, updates: UpdateAgentInput): Promise<Agent | null> {
  const existing = await getAgent(agentId)
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }

  if (updates.name !== undefined) row.name = updates.name
  if (updates.color !== undefined) row.color = updates.color
  if (updates.icon !== undefined) row.icon = updates.icon
  if (updates.model_default !== undefined) row.model_default = updates.model_default

  const { error } = await getSupabase()
    .from('agents')
    .update(row)
    .eq('agent_id', agentId)
  if (error) throw new Error(`updateAgent: ${error.message}`)

  return getAgent(agentId)
}

export async function deleteAgent(agentId: string): Promise<{ success: boolean; error?: string; reassignedThreads?: number }> {
  const agent = await getAgent(agentId)

  if (!agent) {
    return { success: false, error: 'Agent not found' }
  }

  if (agent.is_default === 1) {
    return { success: false, error: 'Cannot delete the default agent' }
  }

  const defaultAgent = await getDefaultAgent()
  if (!defaultAgent) {
    return { success: false, error: 'No default agent found to reassign threads' }
  }

  // Count threads that will be reassigned
  const { count } = await getSupabase()
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
  const reassignedThreads = count || 0

  // Reassign threads to default agent
  await getSupabase()
    .from('threads')
    .update({ agent_id: defaultAgent.agent_id })
    .eq('agent_id', agentId)

  // Delete agent (agent_configs will cascade delete)
  const { error } = await getSupabase()
    .from('agents')
    .delete()
    .eq('agent_id', agentId)
  if (error) throw new Error(`deleteAgent: ${error.message}`)

  return { success: true, reassignedThreads }
}

export async function getAgentThreadCount(agentId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
  if (error) return 0
  return count || 0
}

// ============= AGENT CONFIG CRUD =============

export async function getAgentConfig(agentId: string): Promise<AgentConfig | null> {
  const { data, error } = await getSupabase()
    .from('agent_configs')
    .select('*')
    .eq('agent_id', agentId)
    .single()
  if (error || !data) return null
  return data as unknown as AgentConfig
}

export interface UpdateAgentConfigInput {
  tool_configs?: unknown[]
  mcp_servers?: unknown[]
  custom_prompt?: string | null
  learned_insights?: unknown[]
  enabled_skills?: string[]
}

export async function updateAgentConfig(agentId: string, updates: UpdateAgentConfigInput): Promise<AgentConfig | null> {
  const existing = await getAgentConfig(agentId)

  if (!existing) {
    // Create config if it doesn't exist
    const now = Date.now()
    const { error } = await getSupabase().from('agent_configs').insert({
      agent_id: agentId,
      tool_configs: updates.tool_configs ? JSON.stringify(updates.tool_configs) : null,
      mcp_servers: updates.mcp_servers ? JSON.stringify(updates.mcp_servers) : null,
      custom_prompt: updates.custom_prompt ?? null,
      learned_insights: updates.learned_insights ? JSON.stringify(updates.learned_insights) : null,
      enabled_skills: updates.enabled_skills ? JSON.stringify(updates.enabled_skills) : null,
      updated_at: now,
    })
    if (error) throw new Error(`updateAgentConfig insert: ${error.message}`)
    return getAgentConfig(agentId)
  }

  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }

  if (updates.tool_configs !== undefined) row.tool_configs = JSON.stringify(updates.tool_configs)
  if (updates.mcp_servers !== undefined) row.mcp_servers = JSON.stringify(updates.mcp_servers)
  if (updates.custom_prompt !== undefined) row.custom_prompt = updates.custom_prompt
  if (updates.learned_insights !== undefined) row.learned_insights = JSON.stringify(updates.learned_insights)
  if (updates.enabled_skills !== undefined) row.enabled_skills = JSON.stringify(updates.enabled_skills)

  const { error } = await getSupabase()
    .from('agent_configs')
    .update(row)
    .eq('agent_id', agentId)
  if (error) throw new Error(`updateAgentConfig: ${error.message}`)

  return getAgentConfig(agentId)
}

// ============= MIGRATION HELPERS =============

export async function ensureDefaultAgent(): Promise<Agent> {
  let defaultAgent = await getDefaultAgent()

  if (!defaultAgent) {
    defaultAgent = await createAgent({
      name: 'BUDDY',
      color: '#8B5CF6',
      icon: 'bot',
      is_default: true,
    })
  }

  return defaultAgent
}

export async function assignOrphanedThreadsToDefault(): Promise<number> {
  const defaultAgent = await ensureDefaultAgent()

  const { count } = await getSupabase()
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .is('agent_id', null)
  const orphanCount = count || 0

  if (orphanCount > 0) {
    await getSupabase()
      .from('threads')
      .update({ agent_id: defaultAgent.agent_id })
      .is('agent_id', null)
  }

  return orphanCount
}

export async function runAgentMigrations(): Promise<void> {
  const defaultAgent = await ensureDefaultAgent()

  const existingConfig = await getAgentConfig(defaultAgent.agent_id)

  if (existingConfig && !existingConfig.custom_prompt && !existingConfig.learned_insights) {
    const customPrompt = getCustomPrompt()
    const learnedInsights = getLearnedInsights()
    const mcpServers = getMcpServers()
    const toolConfigs = getToolConfigs()

    if (customPrompt || learnedInsights.length > 0 || mcpServers.length > 0 || toolConfigs.length > 0) {
      await updateAgentConfig(defaultAgent.agent_id, {
        custom_prompt: customPrompt,
        learned_insights: learnedInsights.length > 0 ? learnedInsights : undefined,
        mcp_servers: mcpServers.length > 0 ? mcpServers : undefined,
        tool_configs: toolConfigs.length > 0 ? toolConfigs : undefined,
      })
      console.log('Migrated existing settings to default agent config')
    }
  }

  const orphanedCount = await assignOrphanedThreadsToDefault()
  if (orphanedCount > 0) {
    console.log(`Assigned ${orphanedCount} orphaned threads to default agent`)
  }
}

// ============= AGENT TOOL CONFIG CRUD =============

export interface ToolConfigInput {
  tool_id: string
  enabled: boolean
  require_approval: boolean
}

export async function getAgentToolConfigs(agentId: string): Promise<AgentToolConfig[]> {
  const { data, error } = await getSupabase()
    .from('agent_tool_configs')
    .select('*')
    .eq('agent_id', agentId)
    .order('tool_id', { ascending: true })
  if (error) throw new Error(`getAgentToolConfigs: ${error.message}`)
  return (data || []) as unknown as AgentToolConfig[]
}

export async function upsertAgentToolConfig(
  agentId: string,
  toolId: string,
  config: { enabled: boolean; requireApproval: boolean }
): Promise<AgentToolConfig> {
  const now = Date.now()

  const { error } = await getSupabase()
    .from('agent_tool_configs')
    .upsert({
      agent_id: agentId,
      tool_id: toolId,
      enabled: config.enabled ? 1 : 0,
      require_approval: config.requireApproval ? 1 : 0,
      created_at: now,
      updated_at: now,
    }, { onConflict: 'agent_id,tool_id' })
  if (error) throw new Error(`upsertAgentToolConfig: ${error.message}`)

  const { data } = await getSupabase()
    .from('agent_tool_configs')
    .select('*')
    .eq('agent_id', agentId)
    .eq('tool_id', toolId)
    .single()

  return data as unknown as AgentToolConfig
}

export async function saveAgentToolConfigs(agentId: string, configs: ToolConfigInput[]): Promise<AgentToolConfig[]> {
  const now = Date.now()

  for (const config of configs) {
    await getSupabase()
      .from('agent_tool_configs')
      .upsert({
        agent_id: agentId,
        tool_id: config.tool_id,
        enabled: config.enabled ? 1 : 0,
        require_approval: config.require_approval ? 1 : 0,
        created_at: now,
        updated_at: now,
      }, { onConflict: 'agent_id,tool_id' })
  }

  return getAgentToolConfigs(agentId)
}

export async function deleteAgentToolConfigs(agentId: string): Promise<void> {
  await getSupabase()
    .from('agent_tool_configs')
    .delete()
    .eq('agent_id', agentId)
}

export async function copyAgentToolConfigs(fromAgentId: string, toAgentId: string): Promise<void> {
  const configs = await getAgentToolConfigs(fromAgentId)
  if (configs.length > 0) {
    await saveAgentToolConfigs(
      toAgentId,
      configs.map(c => ({
        tool_id: c.tool_id,
        enabled: c.enabled === 1,
        require_approval: c.require_approval === 1
      }))
    )
  }
}
