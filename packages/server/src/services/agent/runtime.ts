/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from 'deepagents'
import { getDefaultModel, getEnabledMcpServers, getToolConfigMap } from '../settings.js'
import { getApiKey, getCustomPrompt, getLearnedInsights, addLearnedInsight } from '../storage.js'
import { getAgent, getAgentConfig, updateAgentConfig } from '../db/agents.js'
import { getThread, updateThread, getAgentFileBackup } from '../db/index.js'
import { getUserTier, canUserSelectModel, isModelAvailableForUser } from '../db/tiers.js'
import { getEnabledSkillPaths, syncSkillsToSandbox, getSkillsForAgent, cleanDisabledSkillsFromAgentBackup } from '../skills/index.js'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatDeepSeek } from '@langchain/deepseek'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { getPostgresCheckpointer, closePostgresCheckpointer } from '../checkpointer/postgres-saver.js'
import { createE2bSandboxBackend, getE2bWorkspacePath } from './e2b-sandbox.js'
import { createClientProxySandbox } from './client-proxy-sandbox.js'
import { createServerSideDockerSandbox } from './server-side-docker-sandbox.js'
import { createE2bFileAccess, createLocalFileAccess, type SandboxFileAccess } from './sandbox-file-access.js'
import { getSandboxBackendType } from '../settings.js'
import type { Socket } from 'socket.io'
import { createMiddleware } from 'langchain'
import { startBackupScheduler, stopAllBackupSchedulers } from './backup-scheduler.js'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'

// E2B is required - check at startup
if (!process.env.E2B_API_KEY) {
  console.error('[Runtime] ERROR: E2B_API_KEY environment variable is required.')
  console.error('[Runtime] Please set E2B_API_KEY to use the E2B cloud sandbox.')
}
console.log('[Runtime] E2B_API_KEY configured:', !!process.env.E2B_API_KEY)
import { DynamicStructuredTool } from '@langchain/core/tools'
import { ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'

import type * as _lcTypes from 'langchain'
import type * as _lcMessages from '@langchain/core/messages'
import type * as _lcLanggraph from '@langchain/langgraph'
import type * as _lcZodTypes from '@langchain/core/utils/types'

import { broadcastToUser } from '../../websocket/index.js'
import { BASE_SYSTEM_PROMPT, DEFAULT_HIDDEN_PROMPT } from './system-prompt.js'
import { getSystemSetting } from '../db/admin.js'
import { createWhatsAppTools, getWhatsAppInterruptTools } from '../apps/whatsapp/tools.js'
import { whatsappService } from '../apps/whatsapp/index.js'
import { createGoogleWorkspaceTools, getGoogleWorkspaceInterruptTools } from '../apps/google-workspace/tools.js'
import { googleWorkspaceService } from '../apps/google-workspace/index.js'
import { createExaTools, getExaInterruptTools } from '../apps/exa/tools.js'
import { exaService } from '../apps/exa/index.js'
import { createSlackTools, getSlackInterruptTools } from '../apps/slack/tools.js'
import { slackService } from '../apps/slack/index.js'
import { createMicrosoftTeamsTools, getMicrosoftTeamsInterruptTools } from '../apps/microsoft-teams/tools.js'
import { microsoftTeamsService } from '../apps/microsoft-teams/index.js'

// Types for agent config
interface LearnedInsight {
  id: string
  content: string
  source: string
  createdAt: string
  enabled: boolean
}

interface McpServerConfigBase {
  id: string
  name: string
  enabled: boolean
}

interface McpServerStdioConfig extends McpServerConfigBase {
  transport?: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

interface McpServerHttpConfig extends McpServerConfigBase {
  transport: 'http'
  url: string
  headers?: Record<string, string>
  auth?: {
    type: 'oauth' | 'bearer' | 'none'
    bearerToken?: string
    oauthServerId?: string
  }
}

type McpServerConfig = McpServerStdioConfig | McpServerHttpConfig

// Global MCP client for managing connections
let mcpClient: MultiServerMCPClient | null = null

/**
 * Generate the full system prompt for the agent.
 * Uses custom prompt if set (from agent config or global), otherwise uses base prompt.
 * Appends enabled learned insights (from agent config or global).
 *
 * @param workspacePath - The workspace path the agent is operating in
 * @param agentConfig - Optional agent-specific config (custom_prompt, learned_insights)
 * @returns The complete system prompt
 */
interface SkillInfo {
  name: string
  description: string
  path: string
}

async function getSystemPrompt(
  workspacePath: string,
  agentConfig?: { custom_prompt?: string | null; learned_insights?: LearnedInsight[] },
  enabledSkills?: SkillInfo[],
  planMode?: boolean
): Promise<string> {
  const workingDirSection = `
### File System and Paths

**Current Date:** ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`

  // Get the hidden prompt template (from DB, falling back to DEFAULT_HIDDEN_PROMPT)
  const hiddenPromptTemplate = (await getSystemSetting('system_prompt')) || DEFAULT_HIDDEN_PROMPT

  // Get the user's custom prompt (agent-level → global → BASE_SYSTEM_PROMPT)
  const customPrompt = agentConfig?.custom_prompt ?? getCustomPrompt()
  const userPrompt = customPrompt || BASE_SYSTEM_PROMPT

  // Inject user prompt into hidden prompt template
  const baseContent = hiddenPromptTemplate.replace('{{USER_PROMPT}}', userPrompt)

  // Get enabled learned insights from agent config or global
  const insights = agentConfig?.learned_insights
    ? agentConfig.learned_insights.filter((i) => i.enabled)
    : getLearnedInsights().filter((i) => i.enabled)

  let insightsSection = ''
  if (insights.length > 0) {
    insightsSection = `

## Learned Preferences & Instructions

The user has provided these specific preferences and instructions:

${insights.map((i) => `- ${i.content}`).join('\n')}

Always follow these preferences when applicable.
`
  }

  // Build skills section
  let skillsSection = ''
  if (enabledSkills && enabledSkills.length > 0) {
    skillsSection = `

## Available Skills

You have access to the following skills. Each skill provides specialized capabilities through files in the skills directory.

${enabledSkills.map((skill) => `### ${skill.name}
**Path:** \`${skill.path}\`
${skill.description ? `**Description:** ${skill.description}` : ''}
Read the SKILL.md file at this path to get detailed instructions and workflows for this skill.`).join('\n\n')}

When a user's request relates to one of these skills, read the corresponding SKILL.md file to understand how to best accomplish the task.
`
  }

  let planModeSection = ''
  if (planMode) {
    planModeSection = getPlanModeSystemPrompt(workspacePath)
  }

  // Plan mode section goes FIRST so it takes priority over all other instructions
  return planModeSection + workingDirSection + baseContent + insightsSection + skillsSection
}

/**
 * Generate the plan mode system prompt section.
 * Appended to the main system prompt when plan mode is active.
 */
function getPlanModeSystemPrompt(workspacePath: string): string {
  return `

# PLAN MODE ACTIVE — STRICT RESTRICTIONS APPLY

**The following instructions OVERRIDE all prior instructions about write_todos, task management, executing commands, or modifying files.**

## Allowed Tools
- \`ls\`, \`read_file\`, \`glob\`, \`grep\` — filesystem exploration
- \`web_search\` — web research
- Google, Slack, WhatsApp read-only tools — data research
- \`write_file\` — ONLY for \`current_plan.md\` (and renaming old plans)
- \`switch_to_act\` — exit plan mode (only after user approval)

## BLOCKED Tools — These Have Been Removed
- \`write_todos\` — Do NOT create todo lists. Todos are created AFTER Plan Mode ends.
- \`task\` — Do NOT spawn subagents.
- \`execute\` — Do NOT run shell commands.
- \`edit_file\` — Do NOT edit files.
- \`write_file\` to any path other than current_plan.md — BLOCKED.
- Any tools that send messages or modify external data.

These tools are not available to you right now. Do not attempt to use them.

## Workflow

### Step 1: Reflect
Think about what the user is asking. What are the requirements and constraints?

### Step 2: Research
Use read-only tools to gather information needed for the plan.

### Step 3: Clarify
If anything is ambiguous, ask the user before writing the plan.

### Step 4: Write the Plan
Write a structured plan to \`${workspacePath}/current_plan.md\`:
- Summary, Approach, Steps, Files to Modify, Risks, Testing Strategy

If \`current_plan.md\` already exists, rename it to \`plan_deprecated_YYYYMMDD_HHMMSS.md\` first.

### Step 5: Present and STOP
Tell the user the plan is ready for review. Then STOP. Do not take any further action until the user responds.

### Step 6: Handle Response
- **Approved**: Call \`switch_to_act\`. Do NOT create todos first.
- **Changes requested**: Update the plan and present again.
- **Cancelled**: Acknowledge and wait.

## Critical Rules
- Do NOT answer the user's question directly. Your ONLY job is to create a plan.
- Do NOT skip the planning workflow, even if you already know the answer.
- NEVER call \`switch_to_act\` unless the user explicitly approves
- NEVER use \`write_todos\` in Plan Mode — this tool is not available
- After writing the plan, STOP and wait for the user's response
`
}

// Shared PostgreSQL checkpointer (all threads share one instance)
export async function getCheckpointer(_threadId: string): Promise<Awaited<ReturnType<typeof getPostgresCheckpointer>>> {
  return getPostgresCheckpointer()
}

export async function closeCheckpointer(_threadId: string): Promise<void> {
  // No-op: shared checkpointer is closed via closeRuntime()
}

// OpenRouter configuration
interface OpenRouterConfig {
  enabled: boolean
  tier_models: Record<string, string>
  reasoning_tiers: number[]
  provider_order: string[]
  allow_fallbacks: boolean
}

async function getOpenRouterConfig(): Promise<OpenRouterConfig> {
  const raw = await getSystemSetting('openrouter_config')
  if (!raw) return { enabled: false, tier_models: {}, reasoning_tiers: [], provider_order: [], allow_fallbacks: true }
  try {
    const parsed = JSON.parse(raw)
    return {
      enabled: !!parsed.enabled,
      tier_models: parsed.tier_models || {},
      reasoning_tiers: parsed.reasoning_tiers || [],
      provider_order: parsed.provider_order || [],
      allow_fallbacks: parsed.allow_fallbacks !== false,
    }
  } catch { return { enabled: false, tier_models: {}, reasoning_tiers: [], provider_order: [], allow_fallbacks: true } }
}

// Get the appropriate model instance based on configuration and user tier
async function getModelInstance(userId: string, modelId?: string): Promise<ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | ChatDeepSeek | string> {
  // Get user's tier to enforce model restrictions
  const tier = await getUserTier(userId)
  console.log('[Runtime] User tier:', tier.name, '- model_selection:', tier.features.model_selection)

  // For Tier 1 (or any tier without model_selection), always use default model
  // The modelId parameter is ignored for users without model_selection feature
  let effectiveModel: string
  if (tier.features.model_selection) {
    // User can select models - use requested model or tier default
    effectiveModel = modelId || tier.default_model
  } else {
    // User cannot select models - always use tier default
    effectiveModel = tier.default_model
    if (modelId && modelId !== tier.default_model) {
      console.log(`[Runtime] Model ${modelId} ignored for Tier ${tier.tier_id} user, using ${tier.default_model}`)
    }
  }

  // Validate model is in available list for this tier
  if (!tier.available_models.includes(effectiveModel)) {
    console.warn(`[Runtime] Model ${effectiveModel} not available for tier ${tier.name}, using ${tier.default_model}`)
    effectiveModel = tier.default_model
  }

  console.log('[Runtime] Using model:', effectiveModel)

  // Check if OpenRouter is configured for this tier
  const openrouterConfig = await getOpenRouterConfig()
  if (openrouterConfig.enabled) {
    const openrouterApiKey = getApiKey('openrouter')
    const tierModel = openrouterConfig.tier_models[String(tier.tier_id)]
    if (openrouterApiKey && tierModel) {
      console.log('[Runtime] Using OpenRouter model:', tierModel, 'for tier:', tier.name)
      const isReasoning = openrouterConfig.reasoning_tiers.includes(tier.tier_id)

      // Build provider routing config if specified
      const providerKwargs: Record<string, unknown> = {}
      if (openrouterConfig.provider_order.length > 0) {
        providerKwargs.provider = {
          order: openrouterConfig.provider_order,
          allow_fallbacks: openrouterConfig.allow_fallbacks,
        }
      }

      if (isReasoning) {
        return new ChatDeepSeek({
          model: tierModel,
          apiKey: openrouterApiKey,
          configuration: { baseURL: 'https://openrouter.ai/api/v1' },
          modelKwargs: { reasoning: { enabled: true }, ...providerKwargs },
        })
      }
      return new ChatOpenAI({
        model: tierModel,
        apiKey: openrouterApiKey,
        configuration: { baseURL: 'https://openrouter.ai/api/v1' },
        modelKwargs: providerKwargs,
      })
    }
  }

  // Determine provider from model ID
  if (effectiveModel.startsWith('claude')) {
    const apiKey = getApiKey('anthropic')
    console.log('[Runtime] Anthropic API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }
    return new ChatAnthropic({
      model: effectiveModel,
      anthropicApiKey: apiKey
    })
  } else if (
    effectiveModel.startsWith('gpt') ||
    effectiveModel.startsWith('o1') ||
    effectiveModel.startsWith('o3') ||
    effectiveModel.startsWith('o4')
  ) {
    const apiKey = getApiKey('openai')
    console.log('[Runtime] OpenAI API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('OpenAI API key not configured')
    }
    return new ChatOpenAI({
      model: effectiveModel,
      openAIApiKey: apiKey
    })
  } else if (effectiveModel.startsWith('gemini')) {
    const apiKey = getApiKey('google')
    console.log('[Runtime] Google API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('Google API key not configured')
    }
    return new ChatGoogleGenerativeAI({
      model: effectiveModel,
      apiKey: apiKey
    })
  }

  // Default to model string (let deepagents handle it)
  return effectiveModel
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
  /** Socket for client-proxied sandbox (required when using local sandbox) */
  socket?: Socket
  /** Whether plan mode is active - restricts agent to research-only and adds plan workflow */
  planMode?: boolean
}

/**
 * Initialize MCP client with enabled servers.
 * Returns tools from all connected MCP servers.
 *
 * @param agentMcpServers - Optional agent-specific MCP server configs
 */
async function initializeMcpTools(agentMcpServers?: McpServerConfig[]): Promise<DynamicStructuredTool[]> {
  // Use agent-specific MCP servers if provided, otherwise fall back to global
  const enabledServers = agentMcpServers
    ? agentMcpServers.filter((s) => s.enabled)
    : getEnabledMcpServers()

  if (enabledServers.length === 0) {
    console.log('[Runtime] No MCP servers enabled')
    return []
  }

  console.log('[Runtime] Initializing MCP servers:', enabledServers.map((s) => s.name))

  // Close existing client if any
  if (mcpClient) {
    try {
      await mcpClient.close()
    } catch (e) {
      console.warn('[Runtime] Error closing existing MCP client:', e)
    }
  }

  // Build config for MultiServerMCPClient
  const mcpConfig: Record<string, Record<string, unknown>> = {}

  for (const server of enabledServers) {
    if (server.transport === 'http') {
      const config: Record<string, unknown> = {
        url: server.url,
        transport: 'http'
      }

      // Merge headers
      const headers: Record<string, string> = { ...(server.headers || {}) }

      if (server.auth?.type === 'bearer' && server.auth.bearerToken) {
        headers['Authorization'] = `Bearer ${server.auth.bearerToken}`
      } else if (server.auth?.type === 'oauth') {
        // Use the OAuth provider for automatic token management
        const { createOAuthProvider } = await import('../mcp/oauth-service.js')
        config.authProvider = createOAuthProvider(server.id)
      }

      if (Object.keys(headers).length > 0) {
        config.headers = headers
      }

      mcpConfig[server.name] = config
    } else {
      // Stdio transport (legacy or explicit)
      mcpConfig[server.name] = {
        command: server.command,
        args: server.args,
        env: server.env
      }
    }
  }

  try {
    mcpClient = new MultiServerMCPClient({
      mcpServers: mcpConfig as Record<string, { command: string; args: string[] }>,
      // Continue with other servers if one fails
      onConnectionError: 'ignore'
    })
    await mcpClient.initializeConnections()
    const tools = await mcpClient.getTools()
    console.log(
      '[Runtime] MCP tools loaded:',
      tools.map((t) => t.name)
    )
    return tools
  } catch (error) {
    console.error('[Runtime] Failed to initialize MCP servers:', error)
    // Clean up on failure
    if (mcpClient) {
      try {
        await mcpClient.close()
      } catch {
        // Ignore close errors
      }
      mcpClient = null
    }
    return []
  }
}

/**
 * Create middleware that enforces Plan Mode restrictions.
 * Filters tools so the model only sees allowed tools, and blocks forbidden
 * tool calls at execution time as a belt-and-suspenders safety measure.
 */
function createPlanModeMiddleware(workspacePath: string, planModeState: { active: boolean }) {
  const PLAN_MODE_ALLOWED_TOOLS = new Set([
    // Read-only filesystem
    'ls', 'read_file', 'glob', 'grep',
    // Plan file writing only
    'write_file',
    // Plan mode exit
    'switch_to_act',
    // Always safe
    'learn_insight',
    // Web research
    'web_search', 'create_dataset', 'enrich_dataset',
    // Google Workspace read-only
    'gmail_search_emails', 'gmail_get_email', 'gmail_download_attachment',
    'contacts_search',
    'calendar_get_events',
    'drive_list_files', 'drive_get_file_content', 'drive_download_file',
    'docs_read_document',
    'sheets_read_spreadsheet',
    // Slack read-only
    'slack_list_channels', 'slack_get_channel_history', 'slack_get_thread_replies',
    'slack_get_users', 'slack_get_user_profile', 'slack_search_messages', 'slack_download_file',
    // WhatsApp read-only
    'whatsapp_search_messages', 'whatsapp_get_contacts', 'whatsapp_get_history', 'whatsapp_get_chats',
    // Microsoft Teams read-only
    'teams_get_current_user', 'teams_search_users', 'teams_get_user',
    'teams_list_teams', 'teams_list_channels', 'teams_list_team_members',
    'teams_get_channel_messages', 'teams_get_channel_message_replies',
    'teams_list_chats', 'teams_get_chat_messages', 'teams_search_messages',
  ])

  return createMiddleware({
    name: 'PlanModeMiddleware',
    wrapModelCall: async (request, handler) => {
      // If plan mode was deactivated by switch_to_act, pass through
      if (!planModeState.active) return handler(request)
      const filteredTools = request.tools.filter(
        (t) => PLAN_MODE_ALLOWED_TOOLS.has(t.name as string)
      )
      return handler({ ...request, tools: filteredTools })
    },
    wrapToolCall: async (request, handler) => {
      // If plan mode was deactivated by switch_to_act, pass through
      if (!planModeState.active) return handler(request)
      const toolName = request.tool.name as string

      if (!PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
        return new ToolMessage({
          content: `Tool "${toolName}" is not available in Plan Mode. Use read-only tools to research, write your plan to current_plan.md, then get user approval and call switch_to_act.`,
          tool_call_id: request.toolCall.id as string,
          name: toolName,
        })
      }

      // Restrict write_file to plan files only
      if (toolName === 'write_file') {
        const filePath = String(request.toolCall.args?.file_path || request.toolCall.args?.path || '')
        const isPlanFile = filePath.endsWith('/current_plan.md') || /plan_deprecated_\d{8}_\d{6}\.md$/.test(filePath)
        if (!isPlanFile) {
          return new ToolMessage({
            content: `In Plan Mode, write_file can only write to "current_plan.md". You tried "${filePath}". Write your plan, get approval, then call switch_to_act to begin implementation.`,
            tool_call_id: request.toolCall.id as string,
            name: toolName,
          })
        }
      }

      return handler(request)
    },
  })
}

// Create agent runtime with configured model and checkpointer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentRuntime = any // Avoid excessive type depth from createDeepAgent return type

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAgentRuntime(options: CreateAgentRuntimeOptions): Promise<any> {
  const { threadId, modelId, socket } = options

  if (!threadId) {
    throw new Error('Thread ID is required for checkpointing.')
  }

  console.log('[Runtime] Creating agent runtime...')
  console.log('[Runtime] Thread ID:', threadId)

  // Load agent config for this thread
  const thread = await getThread(threadId)
  const agentId = thread?.agent_id
  let agentConfig: {
    custom_prompt?: string | null
    learned_insights?: LearnedInsight[]
    mcp_servers?: McpServerConfig[]
    model_default?: string
    enabled_skills?: string[]
  } | null = null

  if (agentId) {
    const agent = await getAgent(agentId)
    const rawConfig = await getAgentConfig(agentId)

    if (rawConfig) {
      agentConfig = {
        custom_prompt: rawConfig.custom_prompt,
        learned_insights: rawConfig.learned_insights
          ? JSON.parse(rawConfig.learned_insights)
          : undefined,
        mcp_servers: rawConfig.mcp_servers ? JSON.parse(rawConfig.mcp_servers) : undefined,
        enabled_skills: rawConfig.enabled_skills
          ? JSON.parse(rawConfig.enabled_skills)
          : undefined
      }
    }

    if (agent) {
      agentConfig = { ...agentConfig, model_default: agent.model_default }
    }

    console.log('[Runtime] Using agent config for agent:', agentId)
  }

  // Get userId for tier-based model selection
  const userId = thread?.user_id
  if (!userId) {
    throw new Error('User ID is required for tier-based model selection. Please ensure the thread has a user assigned.')
  }

  // Use agent's model_default if no modelId specified and agent has one
  // Note: For Tier 1 users, the effectiveModelId will be ignored and tier default will be used
  const effectiveModelId = modelId ?? agentConfig?.model_default
  const model = await getModelInstance(userId, effectiveModelId)
  console.log('[Runtime] Model instance created:', typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log('[Runtime] Checkpointer ready for thread:', threadId)

  if (!agentId) {
    throw new Error('Agent ID is required for sandbox. Please assign an agent to this thread.')
  }

  // Determine sandbox backend type
  const sandboxBackendType = getSandboxBackendType()
  console.log('[Runtime] Sandbox backend type:', sandboxBackendType)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let backend: any

  if (sandboxBackendType === 'local') {
    if (socket) {
      // Browser-initiated: use client proxy (existing behavior)
      console.log('[Runtime] Using client proxy sandbox (browser-initiated)')
      backend = createClientProxySandbox(socket, agentId, threadId)
    } else {
      // Server-initiated: use direct Docker connection
      console.log('[Runtime] Using server-side Docker sandbox (server-initiated)')
      backend = createServerSideDockerSandbox(agentId)
    }
    console.log('[Runtime] Local sandbox backend created:', backend.id)
  } else {
    // Use E2B cloud sandbox (default)
    if (!process.env.E2B_API_KEY) {
      throw new Error(
        'E2B_API_KEY environment variable is required for Buddy Computer sandbox.'
      )
    }
    console.log('[Runtime] Using E2B cloud sandbox for agent:', agentId)

    // Get any existing file backups for the AGENT (not thread) for recovery
    const backedUpFiles = await getAgentFileBackup(agentId)
    if (backedUpFiles && backedUpFiles.length > 0) {
      console.log(`[Runtime] Found ${backedUpFiles.length} backed up files for agent ${agentId} recovery`)
    }

    // Create sandbox backend with AGENT ID (not thread ID)
    backend = await createE2bSandboxBackend(agentId, backedUpFiles || undefined)
    console.log('[Runtime] E2B backend created:', backend.id)

    // Start the backup scheduler for periodic file backups (agent-based)
    startBackupScheduler(agentId)
    console.log('[Runtime] Backup scheduler started for agent:', agentId)
  }

  // Create file access abstraction based on sandbox type
  let fileAccess: SandboxFileAccess | undefined
  if (sandboxBackendType === 'local') {
    fileAccess = createLocalFileAccess(backend)
    console.log('[Runtime] Using local file access (Docker container)')
  } else if (agentId) {
    fileAccess = createE2bFileAccess(agentId)
    console.log('[Runtime] Using E2B file access (database)')
  }

  // Load and sync enabled skills to sandbox
  const enabledSkillIds = agentConfig?.enabled_skills || []
  console.log(`[Runtime] Enabled skills for agent ${agentId}:`, enabledSkillIds)
  console.log(`[Runtime] Thread user_id: ${thread?.user_id}`)

  // Clean up any disabled/deleted skill files from the agent's backup
  const cleanedCount = await cleanDisabledSkillsFromAgentBackup(agentId, enabledSkillIds)
  if (cleanedCount > 0) {
    console.log(`[Runtime] Cleaned ${cleanedCount} disabled skill files from agent backup`)
  }

  const skillPaths: string[] = []
  if (enabledSkillIds.length > 0 && thread?.user_id) {
    try {
      // Get skill paths for enabled skills
      const paths = await getEnabledSkillPaths(enabledSkillIds)
      skillPaths.push(...paths)
      console.log(`[Runtime] Skill paths to sync:`, skillPaths)

      // Sync skill files to sandbox
      const syncedPaths = await syncSkillsToSandbox(
        enabledSkillIds,
        thread.user_id,
        async (path: string, content: string) => {
          console.log(`[Runtime] Writing skill file to backend: ${path} (${content.length} bytes)`)
          await backend.write(path, content)
        }
      )
      console.log(`[Runtime] Synced ${syncedPaths.length} skill files to sandbox`)

      // Verify files are in the agent's backup
      const verifyBackup = await getAgentFileBackup(agentId)
      const skillFilesInBackup = verifyBackup?.filter(f => f.path.startsWith('/home/user/skills/')) || []
      console.log(`[Runtime] Verification: ${skillFilesInBackup.length} skill files now in agent backup`)
    } catch (error) {
      console.error('[Runtime] Failed to sync skills to sandbox:', error)
    }
  } else {
    console.log(`[Runtime] Skipping skills sync - enabledSkillIds: ${enabledSkillIds.length}, user_id: ${thread?.user_id}`)
  }

  // Build skill info for system prompt
  const enabledSkillsInfo: SkillInfo[] = []
  if (enabledSkillIds.length > 0) {
    const skills = await getSkillsForAgent(enabledSkillIds)
    for (const skill of skills) {
      enabledSkillsInfo.push({
        name: skill.name,
        description: skill.description || '',
        path: skill.folder_path
      })
    }
    console.log(`[Runtime] Skills info for prompt:`, enabledSkillsInfo.map(s => s.name))
  }

  // Load MCP tools from enabled servers (use agent-specific if available)
  const mcpTools = await initializeMcpTools(agentConfig?.mcp_servers)

  // Create learn_insight tool for the agent to save learned preferences
  // Saves to agent-specific config if available, otherwise global
  const learnInsightTool = new DynamicStructuredTool({
    name: 'learn_insight',
    description: `Save a learned insight or preference to remember for future conversations.
Use this when the user explicitly asks you to remember something, or when you learn something
important about their preferences (e.g., coding style, preferred libraries, naming conventions).
The insight will be added to your system prompt for all future interactions.`,
    schema: z.object({
      insight: z
        .string()
        .describe(
          'The insight or preference to remember. Should be clear, actionable, and concise. Example: "Always use TypeScript strict mode" or "Prefer async/await over .then() chains"'
        )
    }),
    func: async ({ insight }) => {
      if (agentId) {
        // Save to agent-specific config
        const currentConfig = await getAgentConfig(agentId)
        const currentInsights: LearnedInsight[] = currentConfig?.learned_insights
          ? JSON.parse(currentConfig.learned_insights)
          : []
        const newInsight: LearnedInsight = {
          id: `insight_${Date.now()}`,
          content: insight,
          source: 'auto_learned',
          createdAt: new Date().toISOString(),
          enabled: true
        }
        await updateAgentConfig(agentId, {
          learned_insights: [...currentInsights, newInsight]
        })
        return `Insight saved to agent config: "${insight}". This will be included in my system prompt for future conversations with this agent.`
      } else {
        // Fall back to global storage
        addLearnedInsight(insight, 'auto_learned')
        return `Insight saved successfully: "${insight}". This will be included in my system prompt for future conversations.`
      }
    }
  })

  // Generate system prompt - always use E2B workspace path
  const workspacePath = getE2bWorkspacePath()
  console.log('[Runtime] Plan mode:', options.planMode ? 'ACTIVE' : 'off')
  const systemPrompt = await getSystemPrompt(
    workspacePath,
    agentConfig ?? undefined,
    enabledSkillsInfo.length > 0 ? enabledSkillsInfo : undefined,
    options.planMode
  )

  // E2B filesystem system prompt
  const filesystemSystemPrompt = `You have access to a secure cloud sandbox. All file paths use absolute paths within the sandbox.

Available tools:
- run_code: Execute Python code directly in the sandbox
- execute: Run shell commands in the sandbox
- ls: List files in a directory (e.g., ls("${workspacePath}"))
- read_file: Read a file from the sandbox
- write_file: Write to a file in the sandbox

The sandbox root is: ${workspacePath}
Files and installed packages persist between calls.`

  // Add WhatsApp tools if connected AND user has ID
  // userId already extracted for tier-based model selection
  const whatsappTools = userId && whatsappService.isConnected(userId)
    ? createWhatsAppTools(userId)
    : []
  if (whatsappTools.length > 0) {
    console.log('[Runtime] WhatsApp tools available:', whatsappTools.map((t) => t.name).join(', '))
  }

  // Add Google Workspace tools if connected AND user has ID
  const googleWorkspaceTools = userId && googleWorkspaceService.isConnected(userId)
    ? createGoogleWorkspaceTools(userId, agentId, fileAccess)
    : []
  if (googleWorkspaceTools.length > 0) {
    console.log('[Runtime] Google Workspace tools available:', googleWorkspaceTools.map((t) => t.name).join(', '))
  }

  // Add Exa tools if connected AND user has ID
  const exaTools = userId && exaService.isConnected(userId)
    ? createExaTools(userId, agentId, fileAccess)
    : []
  if (exaTools.length > 0) {
    console.log('[Runtime] Exa tools available:', exaTools.map((t) => t.name).join(', '))
  }

  // Add Slack tools if connected AND user has ID
  const slackTools = userId && slackService.isConnected(userId)
    ? createSlackTools(userId, agentId, fileAccess)
    : []
  if (slackTools.length > 0) {
    console.log('[Runtime] Slack tools available:', slackTools.map((t) => t.name).join(', '))
  }

  // Add Microsoft Teams tools if connected AND user has ID
  const microsoftTeamsTools = userId && microsoftTeamsService.isConnected(userId)
    ? createMicrosoftTeamsTools(userId, agentId, fileAccess)
    : []
  if (microsoftTeamsTools.length > 0) {
    console.log('[Runtime] Microsoft Teams tools available:', microsoftTeamsTools.map((t) => t.name).join(', '))
  }

  // Combine all additional tools: MCP tools, learn_insight, WhatsApp tools, Google Workspace tools, Exa tools, Slack tools, Microsoft Teams tools
  // Note: Filesystem tools (ls, read, write, edit, glob, grep, execute) come from the backend
  const allTools = [...mcpTools, learnInsightTool, ...whatsappTools, ...googleWorkspaceTools, ...exaTools, ...slackTools, ...microsoftTeamsTools]

  // Shared mutable state so switch_to_act can disable the middleware mid-stream
  const planModeState = { active: options.planMode || false }

  // Register switch_to_act tool when plan mode is active
  if (options.planMode) {
    const switchToActTool = new DynamicStructuredTool({
      name: 'switch_to_act',
      description: 'Exit Plan Mode and switch to Act Mode for implementation. ONLY call after the user has EXPLICITLY approved the plan. After calling this, all tools (write_todos, edit_file, execute, task) become available. Do NOT create todos before calling this tool.',
      schema: z.object({
        confirmation: z.string().describe('Brief confirmation message, e.g. "User approved. Switching to Act Mode."')
      }),
      func: async ({ confirmation }) => {
        // Disable middleware filtering for the rest of this stream
        planModeState.active = false
        // Update thread metadata to disable plan mode
        const currentThread = await getThread(threadId)
        if (currentThread) {
          const metadata = currentThread.metadata ? JSON.parse(currentThread.metadata) : {}
          await updateThread(threadId, {
            metadata: JSON.stringify({ ...metadata, plan_mode: false })
          })
        }
        // Broadcast to frontend so toggle updates
        if (userId) {
          broadcastToUser(userId, 'thread:updated', {
            thread_id: threadId,
            plan_mode: false
          })
        }
        return `Switched to Act Mode. ${confirmation}`
      }
    })
    allTools.push(switchToActTool)
    console.log('[Runtime] Plan mode active - switch_to_act tool registered')
  }

  // Build interrupt list based on tool approval settings
  // Start with execute as default (always requires approval for safety)
  const interruptOn: Record<string, boolean> = { execute: true }

  // Add WhatsApp send tools if connected
  if (whatsappTools.length > 0) {
    for (const toolName of getWhatsAppInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Add Google Workspace tools that require approval if connected
  if (googleWorkspaceTools.length > 0) {
    for (const toolName of getGoogleWorkspaceInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Add Exa tools that require approval if connected
  if (exaTools.length > 0) {
    for (const toolName of getExaInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Add Slack tools that require approval if connected
  if (slackTools.length > 0) {
    for (const toolName of getSlackInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Add Microsoft Teams tools that require approval if connected
  if (microsoftTeamsTools.length > 0) {
    for (const toolName of getMicrosoftTeamsInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Apply user's tool approval settings from config
  // User settings take precedence over defaults - if user explicitly sets a tool to Auto, respect that
  const toolConfigMap = getToolConfigMap()
  console.log('[Runtime] User tool config map:', JSON.stringify(toolConfigMap, null, 2))

  for (const [toolId, config] of Object.entries(toolConfigMap)) {
    console.log(`[Runtime] Processing tool config: ${toolId} -> requireApproval=${config.requireApproval}`)
    if (config.requireApproval === true) {
      // User explicitly set this tool to require approval
      interruptOn[toolId] = true
      console.log(`[Runtime] Added ${toolId} to interruptOn (user setting)`)
    } else if (config.requireApproval === false) {
      // User explicitly set this tool to NOT require approval
      // Respect user choice - they can set any tool to Auto mode including execute
      delete interruptOn[toolId]
      console.log(`[Runtime] Removed ${toolId} from interruptOn (user setting)`)
    }
  }

  console.log('[Runtime] Final interruptOn tools:', Object.keys(interruptOn))

  // Create plan mode middleware that filters tools and blocks forbidden tool calls
  const planModeMiddleware = createPlanModeMiddleware(workspacePath, planModeState)

  // Create middleware to sanitize empty tool results
  // This prevents "cache_control cannot be set for empty text blocks" errors
  // when anthropicPromptCachingMiddleware tries to cache empty tool outputs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sanitizeToolResultsMiddleware = createMiddleware({
    name: 'SanitizeToolResultsMiddleware',
    wrapToolCall: async (request: any, handler: any): Promise<any> => {
      let result: any
      try {
        result = await handler(request)
      } catch (error) {
        // Catch write_file/edit_file calls with truncated content (missing required fields)
        const msg = error instanceof Error ? error.message : String(error)
        if (
          (request.tool.name === 'write_file' || request.tool.name === 'edit_file') &&
          msg.includes('expected string, received undefined')
        ) {
          return new ToolMessage({
            content: `Error: The content was too large and got truncated. Do NOT retry with the same approach. Instead:\n1. Write a shorter initial version with write_file\n2. Then use edit_file to append additional sections one at a time\nBreak the content into chunks of ~200 lines each.`,
            tool_call_id: request.toolCall.id as string,
            name: request.tool.name as string,
          })
        }
        // Let abort/cancellation errors propagate
        if (
          error instanceof Error &&
          (error.name === 'AbortError' ||
            msg.includes('aborted') ||
            msg.includes('Controller is already closed'))
        ) {
          throw error
        }
        // All other tool errors (e.g. MCP failures): return as a ToolMessage
        // so the LLM can handle gracefully instead of crashing the agent
        return new ToolMessage({
          content: `Error executing tool ${request.tool.name}: ${msg}`,
          tool_call_id: request.toolCall.id as string,
          name: request.tool.name as string,
        })
      }
      // Ensure tool results are never empty strings
      if (typeof result === 'string' && result.trim() === '') {
        return '(no output)'
      }
      // Handle objects with empty content
      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as { content: unknown }).content
        if (typeof content === 'string' && content.trim() === '') {
          return { ...result, content: '(no output)' }
        }
      }
      return result
    }
  })

  // Build agent config - always include backend (E2B or LocalSandbox)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentOptions: any = {
    model,
    checkpointer,
    systemPrompt,
    // Backend provides filesystem tools (ls, read, write, edit, glob, grep, execute)
    backend,
    // Add additional tools to the agent
    tools: allTools.length > 0 ? allTools : undefined,
    // Custom filesystem prompt
    filesystemSystemPrompt,
    // Require human approval for shell commands and WhatsApp send
    interruptOn,
    // Custom middleware — plan mode filtering + sanitize empty tool results
    middleware: options.planMode
      ? [planModeMiddleware, sanitizeToolResultsMiddleware]
      : [sanitizeToolResultsMiddleware],
    // Skills paths for deepagents to read SKILL.md frontmatter
    skills: skillPaths.length > 0 ? skillPaths : undefined
  }

  const agent = createDeepAgent(agentOptions as Parameters<typeof createDeepAgent>[0])

  // Log what was created
  console.log('[Runtime] Deep agent created with E2B cloud sandbox:', backend.id)
  console.log('[Runtime] Backend provides: ls, read_file, write_file, edit_file, glob, grep, execute')
  console.log('[Runtime] Additional tools: learn_insight')
  if (mcpTools.length > 0) {
    console.log('[Runtime] MCP tools available:', mcpTools.map((t) => t.name).join(', '))
  }
  if (whatsappTools.length > 0) {
    console.log('[Runtime] WhatsApp tools available:', whatsappTools.map((t) => t.name).join(', '))
  }
  if (googleWorkspaceTools.length > 0) {
    console.log('[Runtime] Google Workspace tools available:', googleWorkspaceTools.map((t) => t.name).join(', '))
  }
  if (exaTools.length > 0) {
    console.log('[Runtime] Exa tools available:', exaTools.map((t) => t.name).join(', '))
  }
  if (slackTools.length > 0) {
    console.log('[Runtime] Slack tools available:', slackTools.map((t) => t.name).join(', '))
  }
  if (skillPaths.length > 0) {
    console.log('[Runtime] Skills enabled:', skillPaths.join(', '))
  }
  console.log('[Runtime] Total additional tools:', allTools.length)
  console.log('[Runtime] Interrupt on tools:', Object.keys(interruptOn).join(', '))
  return agent
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeepAgent = any // Avoid excessive type depth from createDeepAgent return type

// Clean up all checkpointer resources, MCP connections, and backup schedulers
export async function closeRuntime(): Promise<void> {
  // Stop all backup schedulers first
  stopAllBackupSchedulers()
  console.log('[Runtime] Backup schedulers stopped')

  // Close shared Postgres checkpointer
  await closePostgresCheckpointer()

  // Close MCP client
  if (mcpClient) {
    try {
      await mcpClient.close()
      mcpClient = null
      console.log('[Runtime] MCP client closed')
    } catch (e) {
      console.warn('[Runtime] Error closing MCP client:', e)
    }
  }
}
