/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from 'deepagents'
import { getDefaultModel, getEnabledMcpServers } from '../ipc/models'
import { getApiKey, getThreadCheckpointPath, getCustomPrompt, getLearnedInsights, addLearnedInsight } from '../storage'
import { getAgent, getAgentConfig, updateAgentConfig } from '../db/agents'
import { getThread } from '../db'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SqlJsSaver } from '../checkpointer/sqljs-saver'
import { LocalSandbox } from './local-sandbox'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import type * as _lcTypes from 'langchain'
import type * as _lcMessages from '@langchain/core/messages'
import type * as _lcLanggraph from '@langchain/langgraph'
import type * as _lcZodTypes from '@langchain/core/utils/types'

import { BASE_SYSTEM_PROMPT } from './system-prompt'
import { createWhatsAppTools, getWhatsAppInterruptTools } from '../apps/whatsapp/tools'
import { whatsappService } from '../apps/whatsapp'

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
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
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
export type AgentRuntime = ReturnType<typeof createDeepAgent>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function createAgentRuntime(options: CreateAgentRuntimeOptions) {
  const { threadId, modelId, workspacePath } = options

  if (!threadId) {
    throw new Error('Thread ID is required for checkpointing.')
  }

  if (!workspacePath) {
    throw new Error(
      'Workspace path is required. Please select a workspace folder before running the agent.'
    )
  }

  console.log('[Runtime] Creating agent runtime...')
  console.log('[Runtime] Thread ID:', threadId)
  console.log('[Runtime] Workspace path:', workspacePath)

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

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })

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

  const systemPrompt = getSystemPrompt(workspacePath, agentConfig ?? undefined)

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`

  // Add WhatsApp tools if connected
  const whatsappTools = whatsappService.isConnected() ? createWhatsAppTools() : []
  if (whatsappTools.length > 0) {
    console.log('[Runtime] WhatsApp tools available:', whatsappTools.map((t) => t.name).join(', '))
  }

  // Combine MCP tools with custom tools and WhatsApp tools
  const allTools = [...mcpTools, learnInsightTool, ...whatsappTools]

  // Build interrupt list - execute always, plus WhatsApp send if connected
  const interruptOn: Record<string, boolean> = { execute: true }
  if (whatsappTools.length > 0) {
    for (const toolName of getWhatsAppInterruptTools()) {
      interruptOn[toolName] = true
    }
  }

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    // Add MCP tools and custom tools to the agent
    tools: allTools.length > 0 ? allTools : undefined,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    // Require human approval for shell commands and WhatsApp send
    interruptOn
  } as Parameters<typeof createDeepAgent>[0])

  console.log('[Runtime] Deep agent created with LocalSandbox at:', workspacePath)
  console.log('[Runtime] Custom tools available: learn_insight')
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

export type DeepAgent = ReturnType<typeof createDeepAgent>

// Clean up all checkpointer resources and MCP connections
export async function closeRuntime(): Promise<void> {
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
