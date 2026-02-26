// packages/web/src/services/client-sandbox.ts
// Client-side sandbox service for browser-to-Docker communication

export interface SandboxConfig {
  type: 'buddy' | 'local'  // 'buddy' = E2B Cloud, 'local' = Docker
  localHost: string
  localPort: number
}

export interface FileInfo {
  path: string
  name?: string
  is_dir: boolean
  size?: number
  modified_at?: string
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}

export interface LsResponse {
  success: boolean
  files?: FileInfo[]
  error?: string
}

export interface ReadResponse {
  success: boolean
  content?: string
  totalLines?: number
  returnedLines?: number
  error?: string
}

export interface WriteResponse {
  success: boolean
  path?: string
  error?: string
}

export interface EditResponse {
  success: boolean
  path?: string
  occurrences?: number
  replaced?: number
  error?: string
}

export interface GrepResponse {
  success: boolean
  matches?: GrepMatch[]
  error?: string
}

export interface GlobResponse {
  success: boolean
  files?: FileInfo[]
  error?: string
}

export interface ExecuteResult {
  output: string
  exitCode: number | null
  truncated?: boolean
}

export interface HealthResponse {
  status: string
  workspace: string
  version: string
}

/**
 * ClientSandbox provides browser-to-Docker communication for local sandbox execution.
 * This allows the browser to proxy tool calls from the server to a local Docker container.
 */
export class ClientSandbox {
  private baseUrl: string
  private wsUrl: string

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`
    this.wsUrl = `ws://${host}:${port}`
  }

  /**
   * Check if the Docker container is reachable
   */
  async isConnected(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Get health status from the Docker container
   */
  async health(): Promise<HealthResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (res.ok) {
        return res.json()
      }
      return null
    } catch {
      return null
    }
  }

  private async post<T>(endpoint: string, body: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return res.json()
  }

  /**
   * List directory contents
   */
  async ls(path: string, workspace?: string): Promise<LsResponse> {
    return this.post('/ls', { path, workspace })
  }

  /**
   * Read file contents with optional pagination
   */
  async read(path: string, offset?: number, limit?: number, workspace?: string): Promise<ReadResponse> {
    return this.post('/read', { path, offset, limit, workspace })
  }

  /**
   * Write content to a file
   */
  async write(path: string, content: string, workspace?: string): Promise<WriteResponse> {
    return this.post('/write', { path, content, workspace })
  }

  /**
   * Edit file with string replacement
   */
  async edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
    workspace?: string
  ): Promise<EditResponse> {
    return this.post('/edit', { path, oldString, newString, replaceAll, workspace })
  }

  /**
   * Search file contents with ripgrep
   */
  async grep(
    pattern: string,
    path?: string,
    glob?: string,
    caseSensitive?: boolean,
    workspace?: string
  ): Promise<GrepResponse> {
    return this.post('/grep', { pattern, path, glob, caseSensitive, workspace })
  }

  /**
   * Find files matching glob pattern
   */
  async glob(pattern: string, path?: string, workspace?: string): Promise<GlobResponse> {
    return this.post('/glob', { pattern, path, workspace })
  }

  /**
   * Execute a command with streaming output
   */
  async execute(
    command: string,
    cwd?: string,
    timeout?: number,
    onOutput?: (type: 'stdout' | 'stderr', data: string) => void,
    workspace?: string
  ): Promise<ExecuteResult> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[ClientSandbox] Executing command: ${command}`)
        console.log(`[ClientSandbox] Workspace: ${workspace}`)
        const ws = new WebSocket(`${this.wsUrl}/execute`)
        let output = ''
        let truncated = false
        let resolved = false

        ws.onopen = () => {
          console.log('[ClientSandbox] WebSocket connected, sending command')
          ws.send(JSON.stringify({ command, cwd, timeout, workspace }))
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            console.log('[ClientSandbox] Received message:', msg.type, msg.type === 'exit' ? `code=${msg.code}` : '')

            if (msg.type === 'stdout') {
              output += msg.data
              onOutput?.('stdout', msg.data)
            } else if (msg.type === 'stderr') {
              output += `[stderr] ${msg.data}`
              onOutput?.('stderr', msg.data)
            } else if (msg.type === 'exit') {
              truncated = msg.truncated || false
              resolved = true
              ws.close()
              console.log(`[ClientSandbox] Command completed with exit code ${msg.code}, output length: ${output.length}`)
              resolve({
                output: output || '<no output>',
                exitCode: msg.code,
                truncated
              })
            }
          } catch (e) {
            console.error('[ClientSandbox] Error parsing message:', e)
          }
        }

        ws.onerror = (error) => {
          console.error('[ClientSandbox] WebSocket error:', error)
          if (!resolved) {
            resolved = true
            resolve({
              output: 'WebSocket connection error',
              exitCode: 1,
              truncated: false
            })
          }
        }

        ws.onclose = () => {
          console.log('[ClientSandbox] WebSocket closed, resolved:', resolved)
          // If we haven't resolved yet (no exit message), resolve with error
          if (!resolved) {
            resolved = true
            resolve({
              output: 'Connection closed unexpectedly',
              exitCode: 1,
              truncated: false
            })
          }
        }

      } catch (error) {
        console.error('[ClientSandbox] Execute error:', error)
        reject(error)
      }
    })
  }

  /**
   * Execute a tool call and return the result
   * This is the main entry point for tool call proxying from the server
   */
  async executeToolCall(
    tool: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    // Extract workspace from args (used for per-agent isolation)
    const workspace = args.workspace as string | undefined

    try {
      switch (tool) {
        case 'ls':
        case 'list_directory': {
          const response = await this.ls(args.path as string, workspace)
          if (response.success) {
            return { success: true, result: response.files }
          }
          return { success: false, error: response.error }
        }

        case 'read':
        case 'read_file': {
          const response = await this.read(
            args.path as string,
            args.offset as number | undefined,
            args.limit as number | undefined,
            workspace
          )
          if (response.success) {
            return { success: true, result: response.content }
          }
          return { success: false, error: response.error }
        }

        case 'write':
        case 'write_file': {
          const response = await this.write(
            args.path as string,
            args.content as string,
            workspace
          )
          if (response.success) {
            return { success: true, result: response.path }
          }
          return { success: false, error: response.error }
        }

        case 'edit':
        case 'edit_file': {
          const response = await this.edit(
            args.path as string,
            args.oldString as string || args.old_string as string,
            args.newString as string || args.new_string as string,
            args.replaceAll as boolean || args.replace_all as boolean,
            workspace
          )
          if (response.success) {
            return { success: true, result: response }
          }
          return { success: false, error: response.error }
        }

        case 'grep': {
          const response = await this.grep(
            args.pattern as string,
            args.path as string | undefined,
            args.glob as string | undefined,
            args.caseSensitive as boolean | undefined,
            workspace
          )
          if (response.success) {
            return { success: true, result: response.matches }
          }
          return { success: false, error: response.error }
        }

        case 'glob': {
          const response = await this.glob(
            args.pattern as string,
            args.path as string | undefined,
            workspace
          )
          if (response.success) {
            return { success: true, result: response.files }
          }
          return { success: false, error: response.error }
        }

        case 'execute':
        case 'bash':
        case 'run_command': {
          const result = await this.execute(
            args.command as string,
            args.cwd as string | undefined,
            args.timeout as number | undefined,
            undefined, // onOutput callback
            workspace
          )
          // Always return success=true with the full result
          // Non-zero exit codes are valid results, not errors - the agent needs
          // to see the output (including stderr) to understand what happened.
          // Only WebSocket errors or tool invocation errors should be success=false.
          return {
            success: true,
            result: {
              output: result.output,
              exitCode: result.exitCode,
              truncated: result.truncated
            }
          }
        }

        default:
          return { success: false, error: `Unknown tool: ${tool}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// Singleton instance for the default configuration
let clientSandboxInstance: ClientSandbox | null = null

/**
 * Get or create the client sandbox instance
 */
export function getClientSandbox(host = 'localhost', port = 8080): ClientSandbox {
  if (!clientSandboxInstance) {
    clientSandboxInstance = new ClientSandbox(host, port)
  }
  return clientSandboxInstance
}

/**
 * Reset the client sandbox instance (for configuration changes)
 */
export function resetClientSandbox(): void {
  clientSandboxInstance = null
}

/**
 * Create a new client sandbox with specific configuration
 */
export function createClientSandbox(host: string, port: number): ClientSandbox {
  return new ClientSandbox(host, port)
}
