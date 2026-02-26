/**
 * Client Proxy Sandbox Backend - Routes tool calls through WebSocket to browser
 *
 * This class implements the deepagents SandboxBackendProtocol interface but instead of
 * executing directly, it sends tool calls to the browser via WebSocket.
 * The browser then proxies these calls to a local Docker container.
 *
 * Architecture: Server Agent -> WebSocket -> Browser -> HTTP/WS -> Docker Container
 */

import type {
  SandboxBackendProtocol,
  FileInfo,
  GrepMatch,
  WriteResult,
  EditResult,
  ExecuteResponse,
  FileUploadResponse,
  FileDownloadResponse
} from 'deepagents'
import { Socket } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'

// Track pending tool calls waiting for client response
interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const pendingCalls = new Map<string, PendingCall>()

// Default timeout for tool calls (2 minutes)
const TOOL_CALL_TIMEOUT = 120000

/**
 * Client Proxy Sandbox - Routes tool calls through WebSocket to browser
 */
export class ClientProxySandbox implements SandboxBackendProtocol {
  readonly id: string
  readonly agentId: string
  private socket: Socket
  private threadId: string
  private workspace: string
  private workspaceInitialized: boolean = false

  constructor(socket: Socket, agentId: string, threadId: string) {
    this.socket = socket
    this.agentId = agentId
    this.threadId = threadId
    this.id = `client-proxy-${agentId}`
    // Per-agent workspace directory
    this.workspace = `/home/user/${agentId}`

    // Register handler for tool results from client
    this.registerResultHandler()
  }

  /**
   * Ensure the agent's workspace directory exists
   */
  private async ensureWorkspaceExists(): Promise<void> {
    if (this.workspaceInitialized) return

    try {
      // Create the workspace directory (uses root workspace to create subdirectory)
      await this.callClient<{ output: string; exitCode: number | null }>('execute', {
        command: `mkdir -p ${this.workspace}`,
        workspace: '/home/user'  // Use root to create agent subdirectory
      })
      this.workspaceInitialized = true
      console.log(`[ClientProxy] Workspace initialized: ${this.workspace}`)
    } catch (error) {
      console.error(`[ClientProxy] Failed to create workspace:`, error)
    }
  }

  private registerResultHandler(): void {
    // Listen for tool results from the client
    this.socket.on('client_tool_result', (data: {
      callId: string
      result?: unknown
      error?: string
    }) => {
      const pending = pendingCalls.get(data.callId)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingCalls.delete(data.callId)

        if (data.error) {
          console.log(`[ClientProxy] Tool call error (${data.callId.slice(0, 8)}):`, data.error)
          pending.reject(new Error(data.error))
        } else {
          pending.resolve(data.result)
        }
      }
    })
  }

  /**
   * Send a tool call to the client and wait for result
   */
  private async callClient<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const callId = uuidv4()

    console.log(`[ClientProxy] Tool call: ${tool} (${callId.slice(0, 8)})`)

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        console.log(`[ClientProxy] Tool call timed out: ${tool}`, { callId })
        pendingCalls.delete(callId)
        reject(new Error(`Tool call ${tool} timed out after ${TOOL_CALL_TIMEOUT / 1000}s`))
      }, TOOL_CALL_TIMEOUT)

      // Store pending call
      pendingCalls.set(callId, {
        resolve: (result: unknown) => {
          resolve(result as T)
        },
        reject,
        timeout
      })

      // Send tool call to client
      this.socket.emit('client_tool_call', {
        callId,
        tool,
        args,
        threadId: this.threadId
      })

      // Tool call emitted
    })
  }

  /**
   * List files and directories in a path with metadata
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      await this.ensureWorkspaceExists()
      // callClient resolves with the raw result (array of files), not a wrapper
      const result = await this.callClient<FileInfo[]>('ls', {
        path,
        workspace: this.workspace
      })
      return result || []
    } catch (error) {
      console.error(`[ClientProxy] lsInfo error for ${path}:`, error)
      return []
    }
  }

  /**
   * Read file content with line numbers
   */
  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      await this.ensureWorkspaceExists()
      // callClient resolves with the raw content string
      const result = await this.callClient<string>('read', {
        path: filePath,
        offset,
        limit,
        workspace: this.workspace
      })
      return result || ''
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return `Error reading file: ${message}`
    }
  }

  /**
   * Write content to a file
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      await this.ensureWorkspaceExists()
      // callClient resolves with the path string
      const result = await this.callClient<string>('write', {
        path: filePath,
        content,
        workspace: this.workspace
      })
      return { path: result || filePath, filesUpdate: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Write failed'
      return { error: message }
    }
  }

  /**
   * Edit a file by replacing string occurrences
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    try {
      await this.ensureWorkspaceExists()
      // callClient resolves with { path, occurrences, replaced }
      const result = await this.callClient<{
        path: string
        occurrences: number
        replaced: number
      }>('edit', {
        path: filePath,
        oldString,
        newString,
        replaceAll,
        workspace: this.workspace
      })

      return {
        path: result?.path || filePath,
        filesUpdate: null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Edit failed'
      return { error: message }
    }
  }

  /**
   * Search file contents with grep/ripgrep
   */
  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<GrepMatch[] | string> {
    try {
      await this.ensureWorkspaceExists()
      const result = await this.callClient<GrepMatch[]>('grep', {
        pattern,
        path: path || undefined,
        glob: glob || undefined,
        workspace: this.workspace
      })
      return result || []
    } catch (error) {
      console.error(`[ClientProxy] grepRaw error:`, error)
      const message = error instanceof Error ? error.message : 'Grep failed'
      return `Error: ${message}`
    }
  }

  /**
   * Find files matching glob pattern
   */
  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    try {
      await this.ensureWorkspaceExists()
      const result = await this.callClient<Array<{ path: string; is_dir?: boolean; name?: string }>>('glob', {
        pattern,
        path,
        workspace: this.workspace
      })
      return result?.map(f => ({
        path: f.path,
        is_dir: f.is_dir || false,
        size: undefined
      })) || []
    } catch (error) {
      console.error(`[ClientProxy] globInfo error:`, error)
      return []
    }
  }

  /**
   * Execute a shell command
   */
  async execute(
    command: string,
    onOutputStream?: (stream: 'stdout' | 'stderr', chunk: string) => void
  ): Promise<ExecuteResponse> {
    try {
      await this.ensureWorkspaceExists()

      // For streaming, we need to set up a stream listener first
      const streamChannel = `execute_stream:${this.threadId}:${Date.now()}`

      if (onOutputStream) {
        const streamHandler = (data: { type: 'stdout' | 'stderr'; data: string }) => {
          onOutputStream(data.type, data.data)
        }
        this.socket.on(streamChannel, streamHandler)

        // Clean up stream handler after command completes
        setTimeout(() => {
          this.socket.off(streamChannel, streamHandler)
        }, TOOL_CALL_TIMEOUT)
      }

      // callClient resolves with the raw result { output, exitCode, truncated }
      const result = await this.callClient<{
        output: string
        exitCode: number | null
        truncated?: boolean
      }>('execute', {
        command,
        streamChannel: onOutputStream ? streamChannel : undefined,
        workspace: this.workspace
      })

      return {
        output: result.output || '',
        exitCode: result.exitCode ?? 0,
        truncated: result.truncated || false
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed'
      return {
        output: `Error: ${message}`,
        exitCode: 1,
        truncated: false
      }
    }
  }

  /**
   * Upload files (not supported for client proxy)
   */
  async uploadFiles(_files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return _files.map(([path]) => ({
      path,
      error: 'permission_denied' as const
    }))
  }

  /**
   * Download files (not supported for client proxy)
   */
  async downloadFiles(_paths: string[]): Promise<FileDownloadResponse[]> {
    return _paths.map((path) => ({
      path,
      content: null,
      error: 'file_not_found' as const
    }))
  }
}

/**
 * Create a client proxy sandbox for a thread
 */
export function createClientProxySandbox(
  socket: Socket,
  agentId: string,
  threadId: string
): ClientProxySandbox {
  return new ClientProxySandbox(socket, agentId, threadId)
}
