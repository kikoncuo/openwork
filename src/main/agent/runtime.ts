/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent } from 'deepagents'
import { getDefaultModel } from '../ipc/models'
import { getApiKey, getThreadCheckpointPath, getEnabledMCPServers } from '../storage'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SqlJsSaver } from '../checkpointer/sqljs-saver'
import { LocalSandbox } from './local-sandbox'
import type { MCPServerConfig } from '../types/mcp'

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
function mcpServerToAnthropicFormat(server: MCPServerConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: server.type,
    name: server.id
  }

  if (server.type === 'url' && server.url) {
    config.url = server.url
    if (server.authToken) {
      config.authorization_token = server.authToken
    }
  } else if (server.type === 'stdio' && server.command) {
    config.command = server.command
    if (server.args) {
      config.args = server.args
    }
    if (server.env) {
      config.env = server.env
    }
  }

  return config
}

// Get the appropriate model instance based on configuration
function getModelInstance(modelId?: string, mcpServers?: MCPServerConfig[]): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const model = modelId || getDefaultModel()
  console.log('[Runtime] Using model:', model)

  // Determine provider from model ID
  if (model.startsWith('claude')) {
    const apiKey = getApiKey('anthropic')
    console.log('[Runtime] Anthropic API key present:', !!apiKey)
    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }

    const config: ConstructorParameters<typeof ChatAnthropic>[0] = {
      model,
      anthropicApiKey: apiKey
    }

    // Add MCP servers for Anthropic models
    if (mcpServers && mcpServers.length > 0) {
      console.log('[Runtime] Adding MCP servers:', mcpServers.map((s) => s.name).join(', '))
      // Note: MCP integration requires passing mcp_servers in model invoke calls
      // This will be handled in the deepagents library or via model configuration
      // For now, we store the config for later use
      ;(config as Record<string, unknown>).mcpServers = mcpServers.map(mcpServerToAnthropicFormat)
    }

    return new ChatAnthropic(config)
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

  const model = getModelInstance(modelId, mcpServers)
  console.log('[Runtime] Model instance created:', typeof model)

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
  for (const server of mcpServers) {
    if (server.defaultRequireInterrupt) {
      // All tools from this server require approval
      interruptConfig[`mcp:${server.id}`] = true
    }
    // Individual tool configs can override
    if (server.toolConfigs) {
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
    // Require human approval for shell commands and configured MCP tools
    interruptOn: interruptConfig
  } as Parameters<typeof createDeepAgent>[0])

  console.log('[Runtime] Deep agent created with LocalSandbox at:', workspacePath)
  if (mcpServers.length > 0) {
    console.log('[Runtime] MCP servers configured:', mcpServers.length)
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
