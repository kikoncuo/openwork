/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from 'deepagents'
import { getDefaultModel, getEnabledMcpServers, getToolConfigMap } from '../settings.js'
import { getApiKey, getThreadCheckpointPath, getCustomPrompt, getLearnedInsights, addLearnedInsight } from '../storage.js'
import { getAgent, getAgentConfig, updateAgentConfig } from '../db/agents.js'
import { getThread, getAgentFileBackup } from '../db/index.js'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SqlJsSaver } from '../checkpointer/sqljs-saver.js'
import { createE2bSandboxBackend, getE2bWorkspacePath } from './e2b-sandbox.js'
import { startBackupScheduler, stopAllBackupSchedulers } from './backup-scheduler.js'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'

// E2B is required - check at startup
if (!process.env.E2B_API_KEY) {
  console.error('[Runtime] ERROR: E2B_API_KEY environment variable is required.')
  console.error('[Runtime] Please set E2B_API_KEY to use the E2B cloud sandbox.')
}
console.log('[Runtime] E2B_API_KEY configured:', !!process.env.E2B_API_KEY)
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import type * as _lcTypes from 'langchain'
import type * as _lcMessages from '@langchain/core/messages'
import type * as _lcLanggraph from '@langchain/langgraph'
import type * as _lcZodTypes from '@langchain/core/utils/types'

import { BASE_SYSTEM_PROMPT } from './system-prompt.js'
import { createWhatsAppTools, getWhatsAppInterruptTools } from '../apps/whatsapp/tools.js'
import { whatsappService } from '../apps/whatsapp/index.js'

// Types for agent config
interface LearnedInsight {
  id: string
  content: string
  source: string
  createdAt: string
  enabled: boolean
}

interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

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
function getSystemPrompt(
  workspacePath: string,
  agentConfig?: { custom_prompt?: string | null; learned_insights?: LearnedInsight[] }
): string {
  const workingDirSection = `
### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`

  // Use agent's custom prompt if set, otherwise fall back to global, then base prompt
  const customPrompt = agentConfig?.custom_prompt ?? getCustomPrompt()
  const baseContent = customPrompt || BASE_SYSTEM_PROMPT

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

  return workingDirSection + baseContent + insightsSection
}

// Per-thread checkpointer cache
const checkpointers = new Map<string, SqlJsSaver>()

export async function getCheckpointer(threadId: string): Promise<SqlJsSaver> {
  let checkpointer = checkpointers.get(threadId)
  if (!checkpointer) {
    const dbPath = getThreadCheckpointPath(threadId)
    checkpointer = new SqlJsSaver(dbPath)
    await checkpointer.initialize()
    checkpointers.set(threadId, checkpointer)
  }
  return checkpointer
}

export async function closeCheckpointer(threadId: string): Promise<void> {
  const checkpointer = checkpointers.get(threadId)
  if (checkpointer) {
    await checkpointer.close()
    checkpointers.delete(threadId)
  }
}

// Get the appropriate model instance based on configuration
function getModelInstance(modelId?: string): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const model = modelId || getDefaultModel()
  console.log('[Runtime] Using model:', model)

  // Determine provider from model ID
  if (model.startsWith('claude')) {
    const apiKey = getApiKey('anthropic')
    console.log('[Runtime] Anthropic API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }
    return new ChatAnthropic({
      model,
      anthropicApiKey: apiKey
    })
  } else if (
    model.startsWith('gpt') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  ) {
    const apiKey = getApiKey('openai')
    console.log('[Runtime] OpenAI API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('OpenAI API key not configured')
    }
    return new ChatOpenAI({
      model,
      openAIApiKey: apiKey
    })
  } else if (model.startsWith('gemini')) {
    const apiKey = getApiKey('google')
    console.log('[Runtime] Google API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('Google API key not configured')
    }
    return new ChatGoogleGenerativeAI({
      model,
      apiKey: apiKey
    })
  }

  // Default to model string (let deepagents handle it)
  return model
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
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
  const mcpConfig: Record<string, { command: string; args: string[]; env?: Record<string, string> }> =
    {}

  for (const server of enabledServers) {
    mcpConfig[server.name] = {
      command: server.command,
      args: server.args,
      env: server.env
    }
  }

  try {
    mcpClient = new MultiServerMCPClient({
      mcpServers: mcpConfig,
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

// Create agent runtime with configured model and checkpointer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentRuntime = any // Avoid excessive type depth from createDeepAgent return type

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAgentRuntime(options: CreateAgentRuntimeOptions): Promise<any> {
  const { threadId, modelId } = options

  if (!threadId) {
    throw new Error('Thread ID is required for checkpointing.')
  }

  if (!process.env.E2B_API_KEY) {
    throw new Error(
      'E2B_API_KEY environment variable is required. Please configure E2B to use the cloud sandbox.'
    )
  }

  console.log('[Runtime] Creating agent runtime...')
  console.log('[Runtime] Thread ID:', threadId)

  // Load agent config for this thread
  const thread = getThread(threadId)
  const agentId = thread?.agent_id
  let agentConfig: {
    custom_prompt?: string | null
    learned_insights?: LearnedInsight[]
    mcp_servers?: McpServerConfig[]
    model_default?: string
  } | null = null

  if (agentId) {
    const agent = getAgent(agentId)
    const rawConfig = getAgentConfig(agentId)

    if (rawConfig) {
      agentConfig = {
        custom_prompt: rawConfig.custom_prompt,
        learned_insights: rawConfig.learned_insights
          ? JSON.parse(rawConfig.learned_insights)
          : undefined,
        mcp_servers: rawConfig.mcp_servers ? JSON.parse(rawConfig.mcp_servers) : undefined
      }
    }

    if (agent) {
      agentConfig = { ...agentConfig, model_default: agent.model_default }
    }

    console.log('[Runtime] Using agent config for agent:', agentId)
  }

  // Use agent's model_default if no modelId specified and agent has one
  const effectiveModelId = modelId ?? agentConfig?.model_default
  const model = getModelInstance(effectiveModelId)
  console.log('[Runtime] Model instance created:', typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log('[Runtime] Checkpointer ready for thread:', threadId)

  // Always use E2B cloud sandbox
  if (!agentId) {
    throw new Error('Agent ID is required for E2B sandbox. Please assign an agent to this thread.')
  }

  console.log('[Runtime] Using E2B cloud sandbox for agent:', agentId)

  // Get any existing file backups for the AGENT (not thread) for recovery
  const backedUpFiles = getAgentFileBackup(agentId)
  if (backedUpFiles && backedUpFiles.length > 0) {
    console.log(`[Runtime] Found ${backedUpFiles.length} backed up files for agent ${agentId} recovery`)
  }

  // Create sandbox backend with AGENT ID (not thread ID)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backend: any = await createE2bSandboxBackend(agentId, backedUpFiles || undefined)
  console.log('[Runtime] E2B backend created:', backend.id)

  // Start the backup scheduler for periodic file backups (agent-based)
  startBackupScheduler(agentId)
  console.log('[Runtime] Backup scheduler started for agent:', agentId)

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
        const currentConfig = getAgentConfig(agentId)
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
        updateAgentConfig(agentId, {
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
  const systemPrompt = getSystemPrompt(workspacePath, agentConfig ?? undefined)

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
  // Extract userId from thread for user-scoped WhatsApp operations
  const userId = thread?.user_id
  const whatsappTools = userId && whatsappService.isConnected(userId)
    ? createWhatsAppTools(userId)
    : []
  if (whatsappTools.length > 0) {
    console.log('[Runtime] WhatsApp tools available:', whatsappTools.map((t) => t.name).join(', '))
  }

  // Combine all additional tools: MCP tools, learn_insight, WhatsApp tools
  // Note: Filesystem tools (ls, read, write, edit, glob, grep, execute) come from the backend
  const allTools = [...mcpTools, learnInsightTool, ...whatsappTools]

  // Build interrupt list based on tool approval settings
  // Start with execute as default (always requires approval for safety)
  const interruptOn: Record<string, boolean> = { execute: true }

  // Add WhatsApp send tools if connected
  if (whatsappTools.length > 0) {
    for (const toolName of getWhatsAppInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  // Apply user's tool approval settings from config
  const toolConfigMap = getToolConfigMap()
  for (const [toolId, config] of Object.entries(toolConfigMap)) {
    if (config.requireApproval === true) {
      // User explicitly set this tool to require approval
      interruptOn[toolId] = true
    } else if (config.requireApproval === false) {
      // User explicitly set this tool to NOT require approval
      // Only remove from interruptOn if it's not a safety-critical override
      // (We still keep execute requiring approval by default for safety)
      if (toolId !== 'execute') {
        delete interruptOn[toolId]
      }
    }
  }

  console.log('[Runtime] Tool approval settings applied:', Object.keys(interruptOn))

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
    interruptOn
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

  const closePromises = Array.from(checkpointers.values()).map((cp) => cp.close())
  await Promise.all(closePromises)
  checkpointers.clear()

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
