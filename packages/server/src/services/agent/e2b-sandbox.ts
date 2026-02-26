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
import { getThread, updateAgentSandboxId, getAgentFileBackup, getAgentFileByPath, saveAgentFile } from '../db/index.js'
import { getAgent } from '../db/agents.js'
import { triggerDebouncedBackup } from './backup-scheduler.js'
import { formatExecuteResultWithTokenLimit } from './token-utils.js'

// ============================================
// Glob Pattern Helpers
// ============================================

/**
 * Convert a glob pattern to a RegExp with correct ** handling.
 * ** means zero or more directory levels, * means within one segment.
 * Uses character-by-character parsing to avoid replacement collisions.
 */
function globToRegex(pattern: string): RegExp {
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regex += '(?:.*/)?'
        i += 3
      } else {
        regex += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      regex += '[^/]*'
      i++
    } else if (pattern[i] === '?') {
      regex += '[^/]'
      i++
    } else if ('.+^${}()|[]\\'.includes(pattern[i])) {
      regex += '\\' + pattern[i]
      i++
    } else {
      regex += pattern[i]
      i++
    }
  }
  return new RegExp('^' + regex + '$')
}

// ============================================
// Python Detection Patterns
// ============================================

/**
 * Patterns to detect Python execution commands.
 * When matched, we use Code Interpreter for rich results (charts, tables).
 */
const PYTHON_PATTERNS = [
  /^python3?\s+/,                    // python script.py
  /^python3?\s+-c\s+/,               // python -c "code"
  /python3?\s*<<\s*['"]?EOF['"]?/i,  // python << 'EOF' heredoc
]

/**
 * Check if command is running Python code (not just a shell command).
 */
function isPythonExecution(command: string): boolean {
  return PYTHON_PATTERNS.some(pattern => pattern.test(command.trim()))
}

/**
 * Extract Python code from heredoc command.
 * e.g., "python3 << 'EOF'\nprint('hi')\nEOF" -> "print('hi')"
 */
function extractPythonFromHeredoc(command: string): string | null {
  const heredocMatch = command.match(/python3?\s*<<\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1/i)
  if (heredocMatch) {
    return heredocMatch[2]
  }
  return null
}

/**
 * Extract Python code from -c flag.
 * e.g., "python3 -c 'print(\"hi\")'" -> 'print("hi")'
 */
function extractPythonFromFlag(command: string): string | null {
  // Match python -c with single or double quotes
  const flagMatch = command.match(/python3?\s+-c\s+(['"])([\s\S]*?)\1/)
  if (flagMatch) {
    return flagMatch[2]
  }
  return null
}

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
  encoding?: 'utf8' | 'base64'  // 'base64' for binary files, 'utf8' (default) for text
}

// ============================================
// Binary File Detection
// ============================================

/**
 * File extensions that should be treated as binary (base64 encoded)
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.tiff', '.tif',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  // Audio
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma',
  // Video
  '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm',
  // Executables and libraries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Other binary formats
  '.sqlite', '.db', '.pickle', '.pkl', '.npy', '.npz', '.parquet', '.avro',
  '.class', '.jar', '.war', '.pyc', '.pyo', '.wasm'
])

/**
 * Check if a file path represents a binary file based on extension
 */
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Encode Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * Decode base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
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
  const agent = await getAgent(agentId)
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
          await updateAgentSandboxId(agentId, null)

          // Create new sandbox
          sandbox = await Sandbox.create({ apiKey: E2B_API_KEY })
          const newSandboxId = sandbox.sandboxId
          console.log(`[E2B] Created replacement sandbox: ${newSandboxId} for agent: ${agentId}`)
          await updateAgentSandboxId(agentId, newSandboxId)

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
      await updateAgentSandboxId(agentId, newSandboxId)

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
  const thread = await getThread(threadId)
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

      if (file.encoding === 'base64') {
        // For binary files stored as base64, decode and write as binary
        // Use base64 command to decode directly in the sandbox
        const result = await sandbox.commands.run(
          `echo "${file.content}" | base64 -d > "${file.path}"`,
          { timeoutMs: 30000 }
        )
        if (result.exitCode !== 0) {
          throw new Error(`base64 decode failed: ${result.stderr}`)
        }
      } else {
        // For text files, write directly
        await sandbox.files.write(file.path, file.content)
      }
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
 *
 * BACKUP-FIRST APPROACH:
 * - All file read operations (ls, read, grep, glob) use backup database first
 * - All file write operations (write, edit) write to backup first, then sync to sandbox if active
 * - Only command execution requires an active sandbox (created on-demand)
 */
export class E2bSandbox implements SandboxBackendProtocol {
  readonly id: string
  readonly agentId: string
  private sandbox: Sandbox | null
  private workspacePath: string = E2B_WORKSPACE

  constructor(sandbox: Sandbox | null, agentId: string) {
    this.sandbox = sandbox
    this.agentId = agentId
    this.id = `e2b-sandbox-${sandbox?.sandboxId || 'lazy'}`
  }

  /**
   * List files and directories in a path with metadata.
   * BACKUP-FIRST: Reads from backup database, no sandbox needed.
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    try {
      const backup = await getAgentFileBackup(this.agentId)
      if (!backup || backup.length === 0) {
        // No backup, fall back to sandbox if available
        if (this.sandbox) {
          const entries = await this.sandbox.files.list(path)
          return entries.map(e => ({
            path: path.endsWith('/') ? `${path}${e.name}` : `${path}/${e.name}`,
            is_dir: e.type === 'dir',
            size: undefined
          }))
        }
        return []
      }

      // Normalize path for comparison
      const normalizedPath = path.endsWith('/') ? path : path + '/'

      // Build a map of direct children (files and subdirs)
      const children = new Map<string, FileInfo>()

      for (const file of backup) {
        // Check if file is under the given path
        if (!file.path.startsWith(normalizedPath) && file.path !== path) continue

        // Get the relative path from the given directory
        const relativePath = file.path.substring(normalizedPath.length)
        if (!relativePath) continue

        // Get the first component of the relative path
        const parts = relativePath.split('/')
        const name = parts[0]
        const isDir = parts.length > 1
        const fullPath = `${normalizedPath}${name}`

        if (!children.has(fullPath)) {
          children.set(fullPath, {
            path: fullPath,
            is_dir: isDir,
            size: isDir ? undefined : file.content.length
          })
        }
      }

      return Array.from(children.values())
    } catch (error) {
      console.error(`[E2B] lsInfo error for ${path}:`, error)
      return []
    }
  }

  /**
   * Read file content with line numbers.
   * BACKUP-FIRST: Reads from backup database, no sandbox needed.
   */
  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    try {
      // Try backup first
      const file = await getAgentFileByPath(this.agentId, filePath)
      if (file) {
        const lines = file.content.split('\n')
        const slice = lines.slice(offset, offset + limit)
        // Format with line numbers (1-indexed)
        return slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
      }

      // Fallback to sandbox if available
      if (this.sandbox) {
        const content = await this.sandbox.files.read(filePath)
        const lines = content.split('\n')
        const slice = lines.slice(offset, offset + limit)
        return slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
      }

      return `Error: File not found: ${filePath}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return `Error reading file: ${message}`
    }
  }

  /**
   * Write content to a file.
   * BACKUP-FIRST: Writes to backup database first, then syncs to sandbox if active.
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      // Write to backup first (always available)
      await saveAgentFile(this.agentId, filePath, content)

      // If sandbox is active, sync there too
      if (this.sandbox && hasCachedSandbox(this.agentId)) {
        try {
          // Ensure parent directory exists
          const dir = filePath.substring(0, filePath.lastIndexOf('/'))
          if (dir && dir !== this.workspacePath) {
            await this.sandbox.commands.run(`mkdir -p "${dir}"`)
          }
          await this.sandbox.files.write(filePath, content)
        } catch (sandboxError) {
          // Log but don't fail - backup is the primary storage
          console.warn(`[E2B] Sandbox sync failed for ${filePath}:`, sandboxError)
        }
      }

      return { path: filePath, filesUpdate: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Write failed'
      return { error: message }
    }
  }

  /**
   * Edit a file by replacing string occurrences.
   * BACKUP-FIRST: Reads from backup, performs replacement, writes back to backup.
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    try {
      // Read from backup first
      const file = await getAgentFileByPath(this.agentId, filePath)
      let content: string | null = file?.content || null

      // Fallback to sandbox if not in backup
      if (!content && this.sandbox) {
        try {
          content = await this.sandbox.files.read(filePath)
        } catch {
          content = null
        }
      }

      if (!content) {
        return { error: `File not found: ${filePath}` }
      }

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
        return { error: 'String not found in file' }
      }

      // Save to backup first
      await saveAgentFile(this.agentId, filePath, newContent)

      // Sync to sandbox if active
      if (this.sandbox && hasCachedSandbox(this.agentId)) {
        try {
          await this.sandbox.files.write(filePath, newContent)
        } catch (sandboxError) {
          console.warn(`[E2B] Sandbox sync failed for edit ${filePath}:`, sandboxError)
        }
      }

      return { path: filePath, filesUpdate: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Edit failed'
      return { error: message }
    }
  }

  /**
   * Search file contents for a pattern using in-memory search.
   * BACKUP-FIRST: Searches backup files in-memory, no sandbox needed.
   */
  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<GrepMatch[] | string> {
    try {
      const backup = await getAgentFileBackup(this.agentId)
      if (!backup || backup.length === 0) {
        // No backup, fall back to sandbox command if available
        if (this.sandbox) {
          return await this.grepWithSandbox(pattern, path, glob)
        }
        return []
      }

      const basePath = path || this.workspacePath
      const matches: GrepMatch[] = []

      // Create regex for pattern matching
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'g')
      } catch {
        // If invalid regex, treat as literal string
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      }

      // Create glob matcher if provided
      const globPattern = glob ? globToRegex(glob) : null

      for (const file of backup) {
        // Check if file is under the base path
        if (!file.path.startsWith(basePath)) continue

        // Check glob pattern if provided
        if (globPattern && !globPattern.test(file.path)) continue

        // Search content
        const lines = file.content.split('\n')
        lines.forEach((line, i) => {
          regex.lastIndex = 0 // Reset for each line
          if (regex.test(line)) {
            matches.push({
              path: file.path,
              line: i + 1,
              text: line
            })
          }
        })
      }

      return matches
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Grep failed'
      return `Error: ${message}`
    }
  }

  /**
   * Fallback grep using sandbox commands.
   */
  private async grepWithSandbox(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<GrepMatch[] | string> {
    if (!this.sandbox) return []

    const searchPath = path || this.workspacePath
    let cmd = `rg --line-number`
    if (glob) {
      cmd += ` --glob '${glob}'`
    }
    const escapedPattern = pattern.replace(/'/g, "'\\''")
    cmd += ` '${escapedPattern}' ${searchPath} 2>/dev/null`
    cmd += ` || grep -rn '${escapedPattern}' ${searchPath} 2>/dev/null || true`

    const result = await this.execute(cmd)

    if (!result.output || result.output === '<no output>') {
      return []
    }

    const matches: GrepMatch[] = []
    for (const outputLine of result.output.split('\n')) {
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
  }

  /**
   * Find files matching a glob pattern.
   * BACKUP-FIRST: Filters backup files using glob pattern, no sandbox needed.
   */
  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    try {
      const backup = await getAgentFileBackup(this.agentId)
      if (!backup || backup.length === 0) {
        // No backup, fall back to sandbox command if available
        if (this.sandbox) {
          return await this.globWithSandbox(pattern, path)
        }
        return []
      }

      const basePath = path || this.workspacePath

      // Convert glob pattern to regex
      const globRegex = globToRegex(pattern)

      // Filter files matching the glob
      return backup
        .filter(f => {
          if (!f.path.startsWith(basePath)) return false
          // Match the pattern against the filename or relative path
          const fileName = f.path.split('/').pop() || f.path
          const relativePath = f.path.substring(basePath.length).replace(/^\//, '')
          return globRegex.test(fileName) || globRegex.test(relativePath) || globRegex.test(f.path)
        })
        .map(f => ({
          path: f.path,
          is_dir: false,
          size: f.content.length
        }))
    } catch (error) {
      console.error('[E2B] globInfo error:', error)
      return []
    }
  }

  /**
   * Fallback glob using sandbox commands.
   */
  private async globWithSandbox(pattern: string, path?: string): Promise<FileInfo[]> {
    if (!this.sandbox) return []

    const basePath = path || this.workspacePath

    // Extract the last path component as the -name pattern
    // e.g. "**/*.py" → "*.py", "src/**/*.tsx" → "*.tsx", "**/prompt*" → "prompt*"
    const lastSegment = pattern.split('/').pop() || '*'
    // Extract prefix path before first ** (e.g. "src/**/*.tsx" → "src")
    const prefixMatch = pattern.match(/^([^*]+)\/\*\*/)
    const searchPath = prefixMatch ? `${basePath}/${prefixMatch[1]}` : basePath

    const result = await this.execute(
      `find ${searchPath} -name '${lastSegment}' -type f 2>/dev/null || true`
    )

    if (!result.output || result.output === '<no output>') {
      return []
    }

    return result.output
      .split('\n')
      .filter(p => p.trim())
      .map(p => ({ path: p, is_dir: false }))
  }

  /**
   * Upload multiple files to the sandbox.
   * BACKUP-FIRST: Writes to backup, optionally syncs to sandbox.
   * Binary files (images, documents, etc.) are stored as base64 to preserve integrity.
   */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = []

    for (const [filePath, content] of files) {
      try {
        // Check if this is a binary file
        const binary = isBinaryFile(filePath)

        // Convert Uint8Array to string - use base64 for binary files to preserve data integrity
        let contentStr: string
        let encoding: 'utf8' | 'base64' | undefined

        if (binary) {
          contentStr = uint8ArrayToBase64(content)
          encoding = 'base64'
        } else {
          contentStr = new TextDecoder().decode(content)
          encoding = undefined  // Default to utf8
        }

        // Save to backup first with encoding info
        await saveAgentFile(this.agentId, filePath, contentStr, encoding)

        // Sync to sandbox if active
        if (this.sandbox && hasCachedSandbox(this.agentId)) {
          try {
            const dir = filePath.substring(0, filePath.lastIndexOf('/'))
            if (dir && dir !== this.workspacePath) {
              await this.sandbox.commands.run(`mkdir -p "${dir}"`)
            }
            // For sandbox, write the original bytes
            if (binary) {
              // Write binary content as ArrayBuffer (E2B API requirement)
              // Create a new ArrayBuffer copy to avoid SharedArrayBuffer type issues
              const arrayBuffer = new ArrayBuffer(content.length)
              new Uint8Array(arrayBuffer).set(content)
              await this.sandbox.files.write(filePath, arrayBuffer)
            } else {
              await this.sandbox.files.write(filePath, contentStr)
            }
          } catch (sandboxError) {
            console.warn(`[E2B] Sandbox sync failed for upload ${filePath}:`, sandboxError)
          }
        }

        results.push({ path: filePath, error: null })
      } catch (error) {
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
   * BACKUP-FIRST: Reads from backup, falls back to sandbox if not found.
   * Binary files stored as base64 are decoded back to their original bytes.
   */
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const results: FileDownloadResponse[] = []

    for (const filePath of paths) {
      try {
        // Try backup first
        const file = await getAgentFileByPath(this.agentId, filePath)
        if (file) {
          // Check if file was stored as base64 (binary file)
          let contentBytes: Uint8Array
          if (file.encoding === 'base64') {
            contentBytes = base64ToUint8Array(file.content)
          } else {
            contentBytes = new TextEncoder().encode(file.content)
          }
          results.push({ path: filePath, content: contentBytes, error: null })
          continue
        }

        // Fallback to sandbox
        if (this.sandbox) {
          const content = await this.sandbox.files.read(filePath)
          const contentBytes = new TextEncoder().encode(content)
          results.push({ path: filePath, content: contentBytes, error: null })
        } else {
          results.push({ path: filePath, content: null, error: 'file_not_found' as const })
        }
      } catch (error) {
        const errorType = error instanceof Error && error.message.includes('directory')
          ? 'is_directory' as const
          : 'file_not_found' as const
        results.push({ path: filePath, content: null, error: errorType })
      }
    }

    return results
  }

  /**
   * Execute a command in the sandbox with rich result support.
   *
   * For Python execution: Uses Code Interpreter for rich outputs (charts, tables)
   * For shell commands: Uses regular command execution
   *
   * All results are token-limited and images are saved (not returned as base64).
   *
   * LAZY-LOAD: Creates sandbox on-demand if not already active.
   * This is the ONLY operation that requires an active sandbox.
   */
  async execute(
    command: string,
    options?: {
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
      onImageSaved?: (path: string) => void
    }
  ): Promise<ExecuteResponse> {
    if (!command || typeof command !== 'string') {
      return {
        output: 'Error: Shell tool expects a non-empty command string.',
        exitCode: 1,
        truncated: false
      }
    }

    // Lazy-load sandbox - only when command execution is needed
    if (!this.sandbox) {
      try {
        const backup = await getAgentFileBackup(this.agentId) || []
        this.sandbox = await getOrCreateSandbox(this.agentId, backup)
        console.log(`[E2B] Lazy-loaded sandbox for agent ${this.agentId} (command execution)`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create sandbox'
        return {
          output: `Error: Could not create sandbox: ${message}`,
          exitCode: 1,
          truncated: false
        }
      }
    }

    // Check if this is Python code that should use Code Interpreter
    const pythonCode = extractPythonFromHeredoc(command) || extractPythonFromFlag(command)
    if (pythonCode) {
      return this.executePythonWithRichResults(pythonCode, options)
    }

    // Regular shell command execution
    return this.executeShellCommand(command, options)
  }

  /**
   * Execute Python code using Code Interpreter for rich results.
   */
  private async executePythonWithRichResults(
    code: string,
    options?: {
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
      onImageSaved?: (path: string) => void
    }
  ): Promise<ExecuteResponse> {
    // Ensure outputs directory exists
    await this.sandbox!.commands.run('mkdir -p /home/user/outputs')

    const imagePaths: string[] = []
    let stdout = ''
    let stderr = ''
    let imageCounter = 0

    try {
      const result = await this.sandbox!.runCode(code, {
        onStdout: (data: { line: string }) => {
          stdout += data.line + '\n'
          options?.onStdout?.(data.line)
        },
        onStderr: (data: { line: string }) => {
          stderr += data.line + '\n'
          options?.onStderr?.(data.line)
        },
        onResult: async (res: { png?: string; text?: string }) => {
          // Handle matplotlib/plotly images
          if (res.png) {
            imageCounter++
            const imagePath = `/home/user/outputs/chart_${Date.now()}_${imageCounter}.png`

            // Save to E2B sandbox - convert Buffer to ArrayBuffer for E2B API
            const buffer = Buffer.from(res.png, 'base64')
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
            await this.sandbox!.files.write(imagePath, arrayBuffer)

            // Save to backup for persistence
            await saveAgentFile(this.agentId, imagePath, res.png, 'base64')

            imagePaths.push(imagePath)
            options?.onImageSaved?.(imagePath)
          }

          // Append text results to stdout
          if (res.text) {
            stdout += res.text + '\n'
          }
        }
      })

      // Combine output
      let output = stdout.trim()
      if (stderr.trim()) {
        output += '\n[stderr]\n' + stderr.trim()
      }

      // Format with token limits
      const formatted = formatExecuteResultWithTokenLimit({
        output: output || '<no output>',
        exitCode: result.error ? 1 : 0,
        imagePaths,
        error: result.error?.value
      })

      return {
        output: formatted,
        exitCode: result.error ? 1 : 0,
        truncated: false  // We handle truncation in formatting
      }

    } catch (error) {
      if (isPausedSandboxError(error)) {
        // Reconnect and retry
        this.sandbox = null
        sandboxCache.delete(this.agentId)
        await updateAgentSandboxId(this.agentId, null)
        const backup = await getAgentFileBackup(this.agentId) || []
        this.sandbox = await getOrCreateSandbox(this.agentId, backup)
        return this.executePythonWithRichResults(code, options)
      }
      throw error
    }
  }

  /**
   * Execute regular shell command.
   */
  private async executeShellCommand(
    command: string,
    options?: {
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
    }
  ): Promise<ExecuteResponse> {
    // Helper to run the command
    const runCommand = async (): Promise<ExecuteResponse> => {
      const result = await this.sandbox!.commands.run(command, {
        cwd: this.workspacePath,
        timeoutMs: 120_000 // 2 minutes
      })

      // Stream stdout/stderr via callbacks
      if (result.stdout && options?.onStdout) {
        for (const line of result.stdout.split('\n')) {
          options.onStdout(line + '\n')
        }
      }
      if (result.stderr && options?.onStderr) {
        for (const line of result.stderr.split('\n')) {
          options.onStderr(line + '\n')
        }
      }

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

      // Format with token limits
      const formatted = formatExecuteResultWithTokenLimit({
        output: output || '<no output>',
        exitCode: result.exitCode
      })

      return {
        output: formatted,
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
          const backedUpFiles = await getAgentFileBackup(this.agentId)

          // Clear the cached sandbox and get a new one
          sandboxCache.delete(this.agentId)
          await updateAgentSandboxId(this.agentId, null)

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
 *
 * BACKUP-FIRST: The sandbox is now lazy-loaded. File operations work without a sandbox.
 * The sandbox is only created when command execution is needed.
 *
 * @param agentId - The agent ID
 * @param backedUpFiles - Optional backup files (used for restoration when sandbox is created)
 * @param lazyLoad - If true (default), sandbox is created on-demand. If false, creates immediately.
 */
export async function createE2bSandboxBackend(
  agentId: string,
  backedUpFiles?: BackedUpFile[],
  lazyLoad = true
): Promise<E2bSandbox> {
  if (lazyLoad) {
    // Return a sandbox wrapper with null sandbox - will be created on first execute()
    return new E2bSandbox(null, agentId)
  }

  // Create sandbox immediately (legacy behavior)
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
        // Check if this is a binary file
        const binary = isBinaryFile(file.path)

        if (binary) {
          // For binary files, read as bytes and encode as base64
          // E2B's files.read returns string, so we need to use a different approach
          // Read the file using cat -A to preserve binary data, then base64 encode
          const result = await sandbox.commands.run(`base64 "${file.path}"`, { timeoutMs: 30000 })
          if (result.exitCode === 0 && result.stdout) {
            // Remove newlines from base64 output
            const base64Content = result.stdout.replace(/\n/g, '')
            backups.push({ path: file.path, content: base64Content, encoding: 'base64' })
          } else {
            console.warn(`[E2B] Could not backup binary file ${file.path}: base64 command failed`)
          }
        } else {
          // For text files, read normally
          const content = await sandbox.files.read(file.path)
          backups.push({ path: file.path, content })
        }
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
