/**
 * E2B Sandbox Backend - Cloud-based code execution implementing SandboxBackendProtocol
 *
 * This class implements the deepagents SandboxBackendProtocol interface to provide
 * all filesystem and execution operations via E2B cloud sandboxes.
 *
 * Key difference from previous approach:
 * - Previously: Created standalone tools that didn't integrate with deepagents
 * - Now: Implements SandboxBackendProtocol so agent gets standard tools (ls, read, write, edit, grep, glob, execute)
 */

import { Sandbox } from '@e2b/code-interpreter'
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
import { getThread, updateAgentSandboxId, getAgentFileBackup } from '../db/index.js'
import { getAgent } from '../db/agents.js'
import { triggerDebouncedBackup } from './backup-scheduler.js'

// E2B API key from environment
const E2B_API_KEY = process.env.E2B_API_KEY

if (!E2B_API_KEY) {
  console.warn('[E2B] Warning: E2B_API_KEY not set. E2B sandbox will not work.')
}

// E2B workspace path
const E2B_WORKSPACE = '/home/user'

// Cache of active sandboxes by agent ID
const sandboxCache = new Map<string, Sandbox>()

// ============================================
// Backup Types
// ============================================

export interface BackedUpFile {
  path: string
  content: string
}

export interface BackupInfo {
  fileCount: number
  totalSize: number
  updatedAt: number
}

// ============================================
// Error Detection
// ============================================

/**
 * Detect if an error is a paused/not found sandbox error.
 * E2B throws these when trying to reconnect to a sandbox that has been
 * paused due to inactivity or garbage collected.
 */
export function isPausedSandboxError(error: unknown): boolean {
  if (!error) return false

  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  return (
    lowerMessage.includes('paused sandbox') ||
    lowerMessage.includes('sandbox not found') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('sandbox_not_found') ||
    lowerMessage.includes('does not exist') ||
    lowerMessage.includes('not running') ||
    lowerMessage.includes('probably not running')
  )
}

/**
 * Get or create an E2B sandbox for an agent.
 * Each agent has its own sandbox that is shared across all threads using that agent.
 * If the sandbox was paused/garbage collected, automatically creates a new one
 * and optionally restores backed up files.
 */
export async function getOrCreateSandbox(
  agentId: string,
  backedUpFiles?: BackedUpFile[]
): Promise<Sandbox> {
  // Check cache first
  let sandbox = sandboxCache.get(agentId)
  if (sandbox) {
    return sandbox
  }

  if (!E2B_API_KEY) {
    throw new Error('E2B_API_KEY environment variable is not set')
  }

  // Check if agent has existing sandbox ID
  const agent = getAgent(agentId)
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }
  const existingSandboxId = agent.e2b_sandbox_id

  try {
    if (existingSandboxId) {
      // Try to reconnect to existing sandbox
      console.log(`[E2B] Reconnecting to sandbox: ${existingSandboxId} for agent: ${agentId}`)
      try {
        sandbox = await Sandbox.connect(existingSandboxId, { apiKey: E2B_API_KEY })
      } catch (connectError) {
        // Check if this is a paused/not found sandbox error
        if (isPausedSandboxError(connectError)) {
          console.log(`[E2B] Sandbox ${existingSandboxId} paused/not found, creating new one for agent ${agentId}...`)

          // Clear stale sandbox ID from cache and database
          sandboxCache.delete(agentId)
          updateAgentSandboxId(agentId, null)

          // Create new sandbox
          sandbox = await Sandbox.create({ apiKey: E2B_API_KEY })
          const newSandboxId = sandbox.sandboxId
          console.log(`[E2B] Created replacement sandbox: ${newSandboxId} for agent: ${agentId}`)
          updateAgentSandboxId(agentId, newSandboxId)

          // Restore backed up files if provided
          if (backedUpFiles && backedUpFiles.length > 0) {
            console.log(`[E2B] Restoring ${backedUpFiles.length} files from backup...`)
            await restoreFilesToSandbox(sandbox, backedUpFiles)
          }
        } else {
          // Rethrow non-paused errors
          throw connectError
        }
      }
    } else {
      // Create new sandbox
      console.log(`[E2B] Creating new sandbox for agent: ${agentId}`)
      sandbox = await Sandbox.create({ apiKey: E2B_API_KEY })

      // Save sandbox ID to agent
      const newSandboxId = sandbox.sandboxId
      console.log(`[E2B] Created sandbox: ${newSandboxId} for agent: ${agentId}`)
      updateAgentSandboxId(agentId, newSandboxId)

      // Restore backed up files if provided (for recovery scenarios)
      if (backedUpFiles && backedUpFiles.length > 0) {
        console.log(`[E2B] Restoring ${backedUpFiles.length} files from backup...`)
        await restoreFilesToSandbox(sandbox, backedUpFiles)
      }
    }

    sandboxCache.set(agentId, sandbox!)
    return sandbox!
  } catch (error) {
    console.error('[E2B] Failed to initialize sandbox:', error)
    throw error
  }
}

/**
 * Get or create an E2B sandbox for a thread by resolving the thread's agent.
 * This is a convenience function that looks up the thread's agent_id and delegates to getOrCreateSandbox.
 */
export async function getOrCreateSandboxForThread(threadId: string): Promise<Sandbox> {
  const thread = getThread(threadId)
  if (!thread?.agent_id) {
    throw new Error(`Thread ${threadId} has no agent assigned`)
  }
  return getOrCreateSandbox(thread.agent_id)
}

/**
 * Restore files to a sandbox from backup.
 */
async function restoreFilesToSandbox(sandbox: Sandbox, files: BackedUpFile[]): Promise<void> {
  let restored = 0
  let failed = 0

  for (const file of files) {
    try {
      // Ensure parent directory exists
      const dir = file.path.substring(0, file.path.lastIndexOf('/'))
      if (dir && dir !== E2B_WORKSPACE) {
        await sandbox.commands.run(`mkdir -p "${dir}"`)
      }

      await sandbox.files.write(file.path, file.content)
      restored++
    } catch (error) {
      console.warn(`[E2B] Failed to restore file ${file.path}:`, error)
      failed++
    }
  }

  console.log(`[E2B] Restore complete: ${restored} succeeded, ${failed} failed`)
}

/**
 * Close an agent's sandbox connection (but keep it alive for reconnection).
 */
export function closeSandbox(agentId: string): void {
  const sandbox = sandboxCache.get(agentId)
  if (sandbox) {
    sandboxCache.delete(agentId)
    // Note: We don't kill the sandbox, just remove from cache
    // This allows reconnection later
  }
}

/**
 * Get the E2B workspace path.
 */
export function getE2bWorkspacePath(): string {
  return E2B_WORKSPACE
}

/**
 * E2B Sandbox implementation of SandboxBackendProtocol.
 *
 * This class wraps an E2B sandbox and implements all the methods required
 * by deepagents to provide filesystem and execution capabilities.
 */
export class E2bSandbox implements SandboxBackendProtocol {
  readonly id: string
  readonly agentId: string
  private sandbox: Sandbox
  private workspacePath: string = E2B_WORKSPACE

  constructor(sandbox: Sandbox, agentId: string) {
    this.sandbox = sandbox
    this.agentId = agentId
    this.id = `e2b-sandbox-${sandbox.sandboxId}`
  }

  /**
   * List files and directories in a path with metadata.
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      const entries = await this.sandbox.files.list(path)
      return entries.map(e => ({
        path: path.endsWith('/') ? `${path}${e.name}` : `${path}/${e.name}`,
        is_dir: e.type === 'dir',
        size: undefined // E2B doesn't provide size in list
      }))
    } catch (error) {
      console.error(`[E2B] lsInfo error for ${path}:`, error)
      return []
    }
  }

  /**
   * Read file content with line numbers.
   */
  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      const content = await this.sandbox.files.read(filePath)
      const lines = content.split('\n')
      const slice = lines.slice(offset, offset + limit)

      // Format with line numbers (1-indexed)
      return slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return `Error reading file: ${message}`
    }
  }

  /**
   * Write content to a file.
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      // Ensure parent directory exists
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      if (dir && dir !== this.workspacePath) {
        await this.sandbox.commands.run(`mkdir -p "${dir}"`)
      }

      await this.sandbox.files.write(filePath, content)

      // Trigger debounced backup after successful write
      triggerDebouncedBackup(this.agentId)

      return { path: filePath, filesUpdate: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Write failed'
      return { error: message }
    }
  }

  /**
   * Edit a file by replacing string occurrences.
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    try {
      const content = await this.sandbox.files.read(filePath)
      let newContent: string
      let occurrences: number

      if (replaceAll) {
        // Escape special regex characters in oldString
        const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(escaped, 'g')
        occurrences = (content.match(regex) || []).length
        newContent = content.replace(regex, newString)
      } else {
        occurrences = content.includes(oldString) ? 1 : 0
        newContent = content.replace(oldString, newString)
      }

      if (occurrences === 0) {
        return {
          error: 'String not found in file'
        }
      }

      await this.sandbox.files.write(filePath, newContent)

      // Trigger debounced backup after successful edit
      triggerDebouncedBackup(this.agentId)

      return {
        path: filePath,
        filesUpdate: null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Edit failed'
      return {
        error: message
      }
    }
  }

  /**
   * Search file contents for a pattern using grep/ripgrep.
   */
  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<GrepMatch[] | string> {
    try {
      const searchPath = path || this.workspacePath

      // Build ripgrep command
      // Use grep as fallback if rg not available
      let cmd = `rg --line-number`
      if (glob) {
        cmd += ` --glob '${glob}'`
      }
      // Escape single quotes in pattern
      const escapedPattern = pattern.replace(/'/g, "'\\''")
      cmd += ` '${escapedPattern}' ${searchPath} 2>/dev/null`

      // Fallback to grep if rg fails
      cmd += ` || grep -rn '${escapedPattern}' ${searchPath} 2>/dev/null || true`

      const result = await this.execute(cmd)

      if (!result.output || result.output === '<no output>') {
        return []
      }

      // Parse output: file:line:text
      const matches: GrepMatch[] = []
      for (const outputLine of result.output.split('\n')) {
        // Match pattern: /path/to/file:123:text
        const match = outputLine.match(/^([^:]+):(\d+):(.*)$/)
        if (match) {
          matches.push({
            path: match[1],
            line: parseInt(match[2], 10),
            text: match[3]
          })
        }
      }
      return matches
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Grep failed'
      return `Error: ${message}`
    }
  }

  /**
   * Find files matching a glob pattern.
   */
  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    try {
      const basePath = path || this.workspacePath

      // Use find command to locate files
      // Handle glob patterns by converting to find syntax
      const findPattern = pattern.replace(/\*\*/g, '*')
      const result = await this.execute(
        `find ${basePath} -name '${findPattern}' -type f 2>/dev/null || true`
      )

      if (!result.output || result.output === '<no output>') {
        return []
      }

      return result.output
        .split('\n')
        .filter(p => p.trim())
        .map(p => ({
          path: p,
          is_dir: false
        }))
    } catch (error) {
      console.error('[E2B] globInfo error:', error)
      return []
    }
  }

  /**
   * Upload multiple files to the sandbox.
   */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = []

    for (const [filePath, content] of files) {
      try {
        // Ensure parent directory exists
        const dir = filePath.substring(0, filePath.lastIndexOf('/'))
        if (dir && dir !== this.workspacePath) {
          await this.sandbox.commands.run(`mkdir -p "${dir}"`)
        }

        // Convert Uint8Array to string for E2B API
        const contentStr = new TextDecoder().decode(content)
        await this.sandbox.files.write(filePath, contentStr)
        results.push({ path: filePath, error: null })
      } catch (error) {
        // Use permission_denied as the closest match for write errors
        const errorType = error instanceof Error && error.message.includes('permission')
          ? 'permission_denied' as const
          : 'invalid_path' as const
        results.push({ path: filePath, error: errorType })
      }
    }

    return results
  }

  /**
   * Download multiple files from the sandbox.
   */
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const results: FileDownloadResponse[] = []

    for (const filePath of paths) {
      try {
        const content = await this.sandbox.files.read(filePath)
        // Convert string to Uint8Array
        const contentBytes = new TextEncoder().encode(content)
        results.push({ path: filePath, content: contentBytes, error: null })
      } catch (error) {
        // Use file_not_found as the most common read error
        const errorType = error instanceof Error && error.message.includes('directory')
          ? 'is_directory' as const
          : 'file_not_found' as const
        results.push({ path: filePath, content: null, error: errorType })
      }
    }

    return results
  }

  /**
   * Execute a shell command in the sandbox.
   * If the sandbox is paused/not running, automatically reconnects and retries.
   */
  async execute(command: string): Promise<ExecuteResponse> {
    if (!command || typeof command !== 'string') {
      return {
        output: 'Error: Shell tool expects a non-empty command string.',
        exitCode: 1,
        truncated: false
      }
    }

    // Helper to run the command
    const runCommand = async (): Promise<ExecuteResponse> => {
      const result = await this.sandbox.commands.run(command, {
        cwd: this.workspacePath,
        timeoutMs: 120_000 // 2 minutes
      })

      let output = result.stdout || ''

      // Add stderr with prefix
      if (result.stderr) {
        const stderrLines = result.stderr
          .split('\n')
          .filter(line => line.length > 0)
          .map(line => `[stderr] ${line}`)
          .join('\n')

        if (stderrLines) {
          output += (output ? '\n' : '') + stderrLines
        }
      }

      // Ensure we have some output
      if (!output.trim()) {
        output = '<no output>'
      }

      return {
        output,
        exitCode: result.exitCode,
        truncated: false
      }
    }

    try {
      return await runCommand()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed'

      // Check if this is a sandbox not running error
      if (isPausedSandboxError(error)) {
        console.log(`[E2B] Sandbox not running, attempting to reconnect for agent ${this.agentId}...`)

        try {
          // Get backed up files for restoration (agent-based)
          const backedUpFiles = getAgentFileBackup(this.agentId)

          // Clear the cached sandbox and get a new one
          sandboxCache.delete(this.agentId)
          updateAgentSandboxId(this.agentId, null)

          // Get or create a new sandbox with restored files
          const newSandbox = await getOrCreateSandbox(this.agentId, backedUpFiles || undefined)
          this.sandbox = newSandbox

          console.log(`[E2B] Reconnected to new sandbox, retrying command...`)

          // Retry the command
          return await runCommand()
        } catch (reconnectError) {
          const reconnectMsg = reconnectError instanceof Error ? reconnectError.message : 'Reconnect failed'
          return {
            output: `Error: Sandbox stopped and reconnection failed: ${reconnectMsg}`,
            exitCode: 1,
            truncated: false
          }
        }
      }

      return {
        output: `Error executing command: ${message}`,
        exitCode: 1,
        truncated: false
      }
    }
  }
}

/**
 * Create an E2B sandbox backend for an agent.
 * This is the main factory function used by the runtime.
 */
export async function createE2bSandboxBackend(
  agentId: string,
  backedUpFiles?: BackedUpFile[]
): Promise<E2bSandbox> {
  const sandbox = await getOrCreateSandbox(agentId, backedUpFiles)
  return new E2bSandbox(sandbox, agentId)
}

// ============================================
// File Backup Functions
// ============================================

/**
 * List all files recursively in a sandbox directory.
 */
async function listAllFilesRecursive(
  sandbox: Sandbox,
  dirPath: string,
  files: Array<{ path: string; is_dir: boolean }> = []
): Promise<Array<{ path: string; is_dir: boolean }>> {
  try {
    const entries = await sandbox.files.list(dirPath)

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue

      const fullPath = dirPath.endsWith('/')
        ? `${dirPath}${entry.name}`
        : `${dirPath}/${entry.name}`

      const isDir = entry.type === 'dir'
      files.push({ path: fullPath, is_dir: isDir })

      if (isDir) {
        await listAllFilesRecursive(sandbox, fullPath, files)
      }
    }
  } catch (error) {
    console.warn(`[E2B] Error listing ${dirPath}:`, error)
  }

  return files
}

/**
 * Backup all files from a sandbox for an agent.
 * Returns an array of files with their content.
 */
export async function backupSandboxFiles(agentId: string): Promise<BackedUpFile[]> {
  const sandbox = sandboxCache.get(agentId)
  if (!sandbox) {
    console.warn(`[E2B] No active sandbox for agent ${agentId} to backup`)
    return []
  }

  const backups: BackedUpFile[] = []

  try {
    const files = await listAllFilesRecursive(sandbox, E2B_WORKSPACE)

    for (const file of files) {
      if (file.is_dir) continue

      try {
        const content = await sandbox.files.read(file.path)
        backups.push({ path: file.path, content })
      } catch (error) {
        console.warn(`[E2B] Could not backup ${file.path}:`, error)
      }
    }

    console.log(`[E2B] Backed up ${backups.length} files for agent ${agentId}`)
  } catch (error) {
    console.error(`[E2B] Backup failed for agent ${agentId}:`, error)
  }

  return backups
}

/**
 * Get the cached sandbox for an agent (if any).
 */
export function getCachedSandbox(agentId: string): Sandbox | undefined {
  return sandboxCache.get(agentId)
}

/**
 * Check if a sandbox is cached for an agent.
 */
export function hasCachedSandbox(agentId: string): boolean {
  return sandboxCache.has(agentId)
}
