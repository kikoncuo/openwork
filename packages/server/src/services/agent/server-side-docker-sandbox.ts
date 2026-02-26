/**
 * Server-Side Docker Sandbox Backend - Direct communication with Docker container
 *
 * This class implements the deepagents SandboxBackendProtocol interface and communicates
 * directly with the Docker container via HTTP/WebSocket. Used for server-initiated features
 * (cronjobs, WhatsApp, hooks) that don't have a browser connection.
 *
 * Architecture: Server Agent -> HTTP/WS -> Docker Container (direct)
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
import WebSocket from 'ws'
import { getSandboxBackendConfig } from '../settings.js'

/**
 * Server-Side Docker Sandbox - Direct communication with Docker container
 */
export class ServerSideDockerSandbox implements SandboxBackendProtocol {
  readonly id: string
  readonly agentId: string
  private workspace: string
  private baseUrl: string
  private wsUrl: string
  private workspaceInitialized = false

  constructor(agentId: string) {
    this.agentId = agentId
    this.id = `server-docker-${agentId}`
    // Per-agent workspace directory
    this.workspace = `/home/user/${agentId}`

    const config = getSandboxBackendConfig()
    this.baseUrl = `http://${config.localHost}:${config.localPort}`
    this.wsUrl = `ws://${config.localHost}:${config.localPort}/execute`
  }

  /**
   * Make an HTTP request to a Docker container endpoint
   */
  private async httpRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          workspace: this.workspace
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json() as { success: boolean; error?: string } & T
      if (!result.success && result.error) {
        throw new Error(result.error)
      }

      return result as T
    } catch (error) {
      console.error(`[ServerSideDocker] HTTP request failed:`, endpoint, error)
      throw error
    }
  }

  /**
   * Ensure the agent's workspace directory exists
   */
  private async ensureWorkspaceExists(): Promise<void> {
    if (this.workspaceInitialized) return

    try {
      // Create the workspace directory using execute
      await this.execute(`mkdir -p ${this.workspace}`)
      this.workspaceInitialized = true
      console.log(`[ServerSideDocker] Workspace initialized: ${this.workspace}`)
    } catch (error) {
      console.error(`[ServerSideDocker] Failed to create workspace:`, error)
    }
  }

  /**
   * List files and directories in a path with metadata
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      await this.ensureWorkspaceExists()
      const result = await this.httpRequest<{ files: FileInfo[] }>('/ls', { path })
      return result.files || []
    } catch (error) {
      console.error(`[ServerSideDocker] lsInfo error for ${path}:`, error)
      return []
    }
  }

  /**
   * Read file content with line numbers
   */
  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      await this.ensureWorkspaceExists()
      const result = await this.httpRequest<{ content: string }>('/read', {
        path: filePath,
        offset,
        limit
      })
      return result.content || ''
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
      const result = await this.httpRequest<{ path: string }>('/write', {
        path: filePath,
        content
      })
      return { path: result.path || filePath, filesUpdate: null }
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
      const result = await this.httpRequest<{
        path: string
        occurrences: number
        replaced: number
      }>('/edit', {
        path: filePath,
        oldString,
        newString,
        replaceAll
      })

      return {
        path: result.path || filePath,
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
      const result = await this.httpRequest<{ matches: GrepMatch[] }>('/grep', {
        pattern,
        path: path || undefined,
        glob: glob || undefined
      })
      return result.matches || []
    } catch (error) {
      console.error(`[ServerSideDocker] grep error:`, error)
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
      const result = await this.httpRequest<{ files: Array<{ path: string; is_dir?: boolean; name?: string }> }>('/glob', {
        pattern,
        path
      })
      return result.files?.map(f => ({
        path: f.path,
        is_dir: f.is_dir || false,
        size: undefined
      })) || []
    } catch (error) {
      console.error(`[ServerSideDocker] glob error:`, error)
      return []
    }
  }

  /**
   * Execute a shell command via WebSocket
   */
  async execute(
    command: string,
    onOutputStream?: (stream: 'stdout' | 'stderr', chunk: string) => void
  ): Promise<ExecuteResponse> {
    // Don't ensure workspace for mkdir command (used during initialization)
    if (!command.includes('mkdir -p')) {
      await this.ensureWorkspaceExists()
    }

    return new Promise((resolve) => {
      let output = ''
      let exitCode: number | null = null
      let truncated = false

      try {
        const ws = new WebSocket(this.wsUrl)

        const timeout = setTimeout(() => {
          console.log(`[ServerSideDocker] Command timed out: ${command}`)
          ws.close()
          resolve({
            output: output + '\n[Command timed out after 120s]',
            exitCode: null,
            truncated: false
          })
        }, 120000) // 2 minute timeout

        ws.on('open', () => {
          console.log(`[ServerSideDocker] Executing: ${command}`)
          ws.send(JSON.stringify({
            command,
            workspace: this.workspace,
            timeout: 120000
          }))
        })

        ws.on('message', (data: Buffer | string) => {
          try {
            const message = JSON.parse(data.toString()) as {
              type: 'stdout' | 'stderr' | 'exit'
              data?: string
              code?: number | null
              truncated?: boolean
            }

            if (message.type === 'stdout') {
              output += message.data || ''
              if (onOutputStream) {
                onOutputStream('stdout', message.data || '')
              }
            } else if (message.type === 'stderr') {
              output += message.data || ''
              if (onOutputStream) {
                onOutputStream('stderr', message.data || '')
              }
            } else if (message.type === 'exit') {
              exitCode = message.code ?? null
              truncated = message.truncated || false
            }
          } catch (parseError) {
            console.error(`[ServerSideDocker] Failed to parse message:`, parseError)
          }
        })

        ws.on('close', () => {
          clearTimeout(timeout)
          console.log(`[ServerSideDocker] Command completed with exit code: ${exitCode}`)
          resolve({
            output,
            exitCode: exitCode ?? 0,
            truncated
          })
        })

        ws.on('error', (error: Error) => {
          clearTimeout(timeout)
          console.error(`[ServerSideDocker] WebSocket error:`, error)
          resolve({
            output: `Error: ${error.message}`,
            exitCode: 1,
            truncated: false
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution failed'
        console.error(`[ServerSideDocker] Execute error:`, error)
        resolve({
          output: `Error: ${message}`,
          exitCode: 1,
          truncated: false
        })
      }
    })
  }

  /**
   * Upload multiple files (not supported for server-side Docker sandbox)
   */
  async uploadFiles(_files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return _files.map(([path]) => ({
      path,
      error: 'permission_denied' as const
    }))
  }

  /**
   * Download multiple files (not supported for server-side Docker sandbox)
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
 * Create a server-side Docker sandbox for an agent
 */
export function createServerSideDockerSandbox(agentId: string): ServerSideDockerSandbox {
  return new ServerSideDockerSandbox(agentId)
}
