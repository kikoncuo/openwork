/**
 * Sandbox File Access Abstraction
 *
 * Provides a unified interface for reading/writing files regardless of sandbox type.
 * - E2B (cloud): Files are stored in the SQLite database
 * - Local Docker: Files live in the container, accessed via shell commands
 */

import type { SandboxBackendProtocol } from 'deepagents'
import { getAgentFileByPath, saveAgentFile } from '../db/index.js'

// Binary file extensions that need base64 encoding
const BINARY_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.woff', '.woff2', '.ttf', '.eot',
  '.exe', '.dll', '.so', '.dylib'
])

function isBinaryFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return false
  const ext = filePath.substring(dotIndex).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

export interface SandboxFileAccess {
  getFile(path: string): Promise<{ content: string; encoding?: 'utf8' | 'base64' } | null>
  saveFile(path: string, content: string, encoding?: 'utf8' | 'base64'): Promise<void>
}

/**
 * E2B implementation: reads/writes from SQLite database (agent_file_backups table)
 */
export function createE2bFileAccess(agentId: string): SandboxFileAccess {
  return {
    async getFile(path: string) {
      return getAgentFileByPath(agentId, path)
    },
    async saveFile(path: string, content: string, encoding?: 'utf8' | 'base64') {
      saveAgentFile(agentId, path, content, encoding)
    }
  }
}

/**
 * Local Docker implementation: reads/writes files via sandbox backend shell commands.
 * Uses `cat` for text files and `base64` for binary files.
 */
export function createLocalFileAccess(backend: SandboxBackendProtocol): SandboxFileAccess {
  return {
    async getFile(filePath: string) {
      try {
        if (isBinaryFile(filePath)) {
          // Binary: read as base64
          const result = await backend.execute(`base64 "${filePath}"`)
          if (result.exitCode !== 0) return null
          return { content: result.output.trim(), encoding: 'base64' as const }
        } else {
          // Text: read raw content via cat (backend.read adds line numbers)
          const result = await backend.execute(`cat "${filePath}"`)
          if (result.exitCode !== 0) return null
          return { content: result.output, encoding: 'utf8' as const }
        }
      } catch {
        return null
      }
    },
    async saveFile(filePath: string, content: string, encoding?: 'utf8' | 'base64') {
      if (encoding === 'base64') {
        // Binary: write base64 content to temp file, decode to target
        // Use a temp file approach to avoid shell escaping issues with large base64 strings
        const tmpPath = `/tmp/upload_${Date.now()}`
        await backend.write(tmpPath, content)
        await backend.execute(
          `mkdir -p "$(dirname "${filePath}")" && base64 -d "${tmpPath}" > "${filePath}" && rm -f "${tmpPath}"`
        )
      } else {
        // Text: use backend.write directly
        await backend.write(filePath, content)
      }
    }
  }
}
