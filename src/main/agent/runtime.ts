/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from 'deepagents'
import { getDefaultModel } from '../ipc/models'
import { getApiKey, getThreadCheckpointPath, getEnabledMCPServers } from '../storage'
import { ChatAnthropic, tools as anthropicTools } from '@langchain/anthropic'
import { ChatOpenAI, tools as openaiTools } from '@langchain/openai'
import type Anthropic from '@anthropic-ai/sdk'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SqlJsSaver } from '../checkpointer/sqljs-saver'
import { LocalSandbox } from './local-sandbox'
import type { MCPServerConfig } from '../types/mcp'
import type { ServerTool, ClientTool } from '@langchain/core/tools'

import type * as _lcTypes from 'langchain'
import type * as _lcMessages from '@langchain/core/messages'
import type * as _lcLanggraph from '@langchain/langgraph'
import type * as _lcZodTypes from '@langchain/core/utils/types'

import { BASE_SYSTEM_PROMPT } from './system-prompt'

/**
 * Generate the full system prompt for the agent.
 *
 * @param workspacePath - The workspace path the agent is operating in
 * @returns The complete system prompt
 */
function getSystemPrompt(workspacePath: string): string {
  const workingDirSection = `
### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`

  return workingDirSection + BASE_SYSTEM_PROMPT
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

// Convert MCP server config to Anthropic API format
function mcpServerToAnthropicFormat(server: MCPServerConfig): Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition {
  const config: Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition = {
    type: server.type as 'url',
    name: server.name, // Use server.name for consistency with MCP toolset
    url: server.url || ''
  }

  // Add optional fields
  if (server.authToken) {
    config.authorization_token = server.authToken
  }

  // For STDIO servers (not yet fully supported)
  if (server.type === 'stdio' && server.command) {
    // Note: STDIO support may need additional configuration
    console.warn('[Runtime] STDIO MCP servers not fully tested with Anthropic')
  }

  return config
}

/**
 * Detect AI provider from model ID
 */
function detectProvider(modelId?: string): 'anthropic' | 'openai' | 'google' | 'unknown' {
  if (!modelId) return 'unknown'

  if (modelId.startsWith('claude')) return 'anthropic'
  if (
    modelId.startsWith('gpt') ||
    modelId.startsWith('o1') ||
    modelId.startsWith('o3') ||
    modelId.startsWith('o4')
  ) {
    return 'openai'
  }
  if (modelId.startsWith('gemini')) return 'google'

  return 'unknown'
}

/**
 * Wrapper for ChatAnthropic that injects mcp_servers into all invoke calls
 * This is a workaround since .bind() is not available on ChatAnthropic
 */
class AnthropicMCPWrapper extends ChatAnthropic {
  private mcpServers: Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition[]

  constructor(
    config: ConstructorParameters<typeof ChatAnthropic>[0],
    mcpServers: Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition[]
  ) {
    super(config)
    this.mcpServers = mcpServers
  }

  // Override invoke to inject mcp_servers
  override async invoke(
    input: Parameters<ChatAnthropic['invoke']>[0],
    options?: Parameters<ChatAnthropic['invoke']>[1]
  ) {
    return super.invoke(input, {
      ...options,
      mcp_servers: this.mcpServers
    })
  }

  // Override stream to inject mcp_servers
  override async stream(
    input: Parameters<ChatAnthropic['stream']>[0],
    options?: Parameters<ChatAnthropic['stream']>[1]
  ) {
    return super.stream(input, {
      ...options,
      mcp_servers: this.mcpServers
    })
  }
}

/**
 * Create MCP tools for a specific provider
 * Returns an array of LangChain-compatible tools
 */
function createMCPTools(
  provider: 'anthropic' | 'openai' | 'google' | 'unknown',
  servers: MCPServerConfig[]
): Array<ServerTool | ClientTool> {
  if (servers.length === 0) {
    return []
  }

  const mcpTools: Array<ServerTool | ClientTool> = []

  for (const server of servers) {
    if (provider === 'anthropic') {
      // Create Anthropic MCP toolset
      console.log(`[Runtime] Creating Anthropic MCP toolset for: ${server.name}`)

      const toolset = anthropicTools.mcpToolset_20251120({
        serverName: server.name,
        defaultConfig: { enabled: true },
        configs: server.toolConfigs || {}
      })

      mcpTools.push(toolset)
    } else if (provider === 'openai') {
      // Create OpenAI MCP tool
      console.log(`[Runtime] Creating OpenAI MCP tool for: ${server.name}`)

      if (!server.url) {
        console.warn(
          `[Runtime] Skipping OpenAI MCP server "${server.name}" - URL required for OpenAI MCP`
        )
        continue
      }

      const requireApproval = server.defaultRequireInterrupt ? 'always' : 'never'

      const tool = openaiTools.mcp({
        serverLabel: server.name,
        serverUrl: server.url,
        serverDescription: `MCP server: ${server.name}`,
        requireApproval: requireApproval as 'always' | 'never'
      })

      mcpTools.push(tool)
    } else if (provider === 'google') {
      console.warn(`[Runtime] Google models do not support MCP - skipping server: ${server.name}`)
    }
  }

  console.log(`[Runtime] Created ${mcpTools.length} MCP tools for provider: ${provider}`)
  return mcpTools
}

// Get the appropriate model instance based on configuration
function getModelInstance(
  modelId?: string,
  _mcpServers?: MCPServerConfig[]
): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
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

  // Load enabled MCP servers
  const mcpServers = getEnabledMCPServers()
  if (mcpServers.length > 0) {
    console.log('[Runtime] Enabled MCP servers:', mcpServers.map((s) => s.name).join(', '))
  }

  // Detect provider from model ID
  const effectiveModelId = modelId || getDefaultModel()
  const provider = detectProvider(effectiveModelId)
  console.log('[Runtime] Detected provider:', provider)

  // Create base model instance
  let model = getModelInstance(modelId, mcpServers)
  console.log('[Runtime] Model instance created:', typeof model)

  // For Anthropic: wrap model to inject mcp_servers into all invocations
  if (provider === 'anthropic' && mcpServers.length > 0 && typeof model !== 'string') {
    const mcpServerConfigs = mcpServers.map(mcpServerToAnthropicFormat)
    console.log('[Runtime] Wrapping Anthropic model with MCP servers:', mcpServerConfigs.length)

    // Create new wrapped model with MCP server configuration
    const config: ConstructorParameters<typeof ChatAnthropic>[0] = {
      model: effectiveModelId,
      anthropicApiKey: getApiKey('anthropic')
    }

    // Create wrapped model that injects mcp_servers
    model = new AnthropicMCPWrapper(config, mcpServerConfigs)
    console.log('[Runtime] Anthropic model wrapped with MCP server injection')
  }

  // Create MCP tools for the provider
  const mcpTools = createMCPTools(provider, mcpServers)
  if (mcpTools.length > 0) {
    console.log('[Runtime] MCP tools created:', mcpTools.length)
  }

  const checkpointer = await getCheckpointer(threadId)
  console.log('[Runtime] Checkpointer ready for thread:', threadId)

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })

  const systemPrompt = getSystemPrompt(workspacePath)

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`

  // Build interrupt configuration
  const interruptConfig: Record<string, boolean> = { execute: true }

  // Add MCP tools that require interrupts
  // Note: For Anthropic, interrupts are handled via HITL system
  // For OpenAI, interrupts are handled via requireApproval in tool config
  for (const server of mcpServers) {
    if (server.defaultRequireInterrupt && provider === 'anthropic') {
      // For Anthropic: mark all tools from this server for interrupt
      interruptConfig[`mcp:${server.id}`] = true
    }
    // Individual tool configs can override (Anthropic only)
    if (server.toolConfigs && provider === 'anthropic') {
      for (const [toolName, toolConfig] of Object.entries(server.toolConfigs)) {
        if (toolConfig.requireInterrupt) {
          interruptConfig[`mcp:${server.id}:${toolName}`] = true
        }
      }
    }
  }

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    // Pass MCP tools to the agent
    tools: mcpTools.length > 0 ? mcpTools : undefined,
    // Require human approval for shell commands and configured MCP tools
    interruptOn: interruptConfig
  } as Parameters<typeof createDeepAgent>[0])

  console.log('[Runtime] Deep agent created with LocalSandbox at:', workspacePath)
  if (mcpServers.length > 0) {
    console.log('[Runtime] MCP integration active:')
    console.log(`  - Provider: ${provider}`)
    console.log(`  - Servers: ${mcpServers.length}`)
    console.log(`  - Tools: ${mcpTools.length}`)
  }
  return agent
}

export type DeepAgent = ReturnType<typeof createDeepAgent>

// Clean up all checkpointer resources
export async function closeRuntime(): Promise<void> {
  const closePromises = Array.from(checkpointers.values()).map((cp) => cp.close())
  await Promise.all(closePromises)
  checkpointers.clear()
}
