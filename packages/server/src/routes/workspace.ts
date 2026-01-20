/**
 * Workspace routes - local filesystem and E2B sandbox operations with auth
 */

import { Router } from 'express'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import { requireAuth } from '../middleware/auth.js'
import { getThread, updateThread, getAgentFileBackup, getAgentBackupInfo, clearAgentFileBackup, updateAgentSandboxId } from '../services/db/index.js'
import { getAgent } from '../services/db/agents.js'
import { startWatching, stopWatching } from '../services/misc/workspace-watcher.js'
import { getSetting, setSetting, deleteSetting, getRecentWorkspaces, addRecentWorkspace } from '../services/settings.js'
import { getOrCreateSandbox, getE2bWorkspacePath, isPausedSandboxError, closeSandbox } from '../services/agent/e2b-sandbox.js'
import { performBackup, getBackupStatus, startBackupScheduler } from '../services/agent/backup-scheduler.js'

// Check if E2B is enabled
const E2B_ENABLED = !!process.env.E2B_API_KEY

const router = Router()

// Apply auth middleware to all workspace routes
router.use(requireAuth)

// Types for browse response
interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modifiedAt?: string
}

interface BrowseResponse {
  currentPath: string
  parentPath: string | null
  entries: BrowseEntry[]
}

interface PathSuggestion {
  path: string
  label: string
}

// Browse server filesystem
router.get('/browse', async (req, res) => {
  try {
    const requestedPath = (req.query.path as string) || os.homedir()
    const resolvedPath = path.resolve(requestedPath)

    // Check if path exists and is a directory
    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'Path is not a directory' })
        return
      }
    } catch {
      res.status(400).json({ error: 'Path does not exist' })
      return
    }

    const dirEntries = await fs.readdir(resolvedPath, { withFileTypes: true })

    const entries: BrowseEntry[] = []
    for (const entry of dirEntries) {
      // Skip hidden files by default
      if (entry.name.startsWith('.')) continue

      const entryPath = path.join(resolvedPath, entry.name)
      const isDir = entry.isDirectory()

      if (isDir) {
        entries.push({
          name: entry.name,
          path: entryPath,
          isDirectory: true
        })
      } else {
        try {
          const stat = await fs.stat(entryPath)
          entries.push({
            name: entry.name,
            path: entryPath,
            isDirectory: false,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          })
        } catch {
          // Skip files we can't stat
        }
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    // Calculate parent path (null if at root)
    const parentPath = path.dirname(resolvedPath)
    const hasParent = parentPath !== resolvedPath

    const response: BrowseResponse = {
      currentPath: resolvedPath,
      parentPath: hasParent ? parentPath : null,
      entries
    }

    res.json(response)
  } catch (error) {
    console.error('[Workspace] Browse error:', error)
    res.status(500).json({ error: 'Failed to browse directory' })
  }
})

// Validate a path exists and is accessible
router.post('/validate', async (req, res) => {
  try {
    const { path: targetPath } = req.body

    if (!targetPath) {
      res.json({ valid: false, error: 'Path is required' })
      return
    }

    const resolvedPath = path.resolve(targetPath)

    try {
      const stat = await fs.stat(resolvedPath)
      const isDirectory = stat.isDirectory()

      // Check if writable by attempting to access with write permission
      let writable = false
      try {
        await fs.access(resolvedPath, fsSync.constants.W_OK)
        writable = true
      } catch {
        writable = false
      }

      res.json({
        valid: isDirectory,
        path: resolvedPath,
        writable,
        error: isDirectory ? undefined : 'Path is not a directory'
      })
    } catch {
      res.json({
        valid: false,
        path: targetPath,
        error: 'Path does not exist or is not accessible'
      })
    }
  } catch (error) {
    console.error('[Workspace] Validate error:', error)
    res.status(500).json({ error: 'Failed to validate path' })
  }
})

// Get suggested paths (home, documents, recent workspaces)
router.get('/suggestions', async (req, res) => {
  try {
    const suggestions: PathSuggestion[] = []

    // Add common paths
    const commonPaths = [
      { path: os.homedir(), label: 'Home' },
      { path: path.join(os.homedir(), 'Documents'), label: 'Documents' },
      { path: path.join(os.homedir(), 'Desktop'), label: 'Desktop' },
      { path: path.join(os.homedir(), 'Downloads'), label: 'Downloads' },
      { path: path.join(os.homedir(), 'Projects'), label: 'Projects' }
    ]

    // Filter to only existing paths
    for (const p of commonPaths) {
      try {
        await fs.access(p.path)
        suggestions.push(p)
      } catch {
        // Path doesn't exist, skip it
      }
    }

    // Add recent workspaces
    const recentWorkspaces = getRecentWorkspaces()
    for (const recentPath of recentWorkspaces) {
      // Don't duplicate paths already in suggestions
      if (suggestions.some(s => s.path === recentPath)) continue

      try {
        await fs.access(recentPath)
        suggestions.push({
          path: recentPath,
          label: path.basename(recentPath)
        })
      } catch {
        // Path no longer exists, skip it
      }
    }

    res.json(suggestions)
  } catch (error) {
    console.error('[Workspace] Suggestions error:', error)
    res.status(500).json({ error: 'Failed to get suggestions' })
  }
})

// Get workspace path for a thread
router.get('/', async (req, res) => {
  try {
    const threadId = req.query.threadId as string | undefined
    const userId = req.user!.userId

    if (!threadId) {
      // Fallback to global setting for backwards compatibility
      const workspacePath = getSetting<string | null>('workspacePath', null)
      res.json({ workspacePath })
      return
    }

    // Get from thread metadata and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    if (!thread.metadata) {
      res.json({ workspacePath: null })
      return
    }

    const metadata = JSON.parse(thread.metadata)
    res.json({ workspacePath: metadata.workspacePath || null })
  } catch (error) {
    console.error('[Workspace] Get error:', error)
    res.status(500).json({ error: 'Failed to get workspace' })
  }
})

// Set workspace path for a thread
router.put('/', async (req, res) => {
  try {
    const { threadId, path: newPath } = req.body
    const userId = req.user!.userId

    // Validate the path if provided
    let resolvedPath: string | null = null
    if (newPath) {
      resolvedPath = path.resolve(newPath)

      try {
        const stat = await fs.stat(resolvedPath)
        if (!stat.isDirectory()) {
          res.status(400).json({
            error: 'Path is not a directory',
            workspacePath: null
          })
          return
        }
      } catch {
        res.status(400).json({
          error: 'Path does not exist or is not accessible',
          workspacePath: null
        })
        return
      }

      // Add to recent workspaces
      addRecentWorkspace(resolvedPath)
    }

    if (!threadId) {
      // Fallback to global setting
      if (resolvedPath) {
        setSetting('workspacePath', resolvedPath)
      } else {
        deleteSetting('workspacePath')
      }
      res.json({ workspacePath: resolvedPath })
      return
    }

    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    metadata.workspacePath = resolvedPath
    updateThread(threadId, { metadata: JSON.stringify(metadata) })

    // Update file watcher
    if (resolvedPath) {
      startWatching(threadId, resolvedPath)
    } else {
      stopWatching(threadId)
    }

    res.json({ workspacePath: resolvedPath })
  } catch (error) {
    console.error('[Workspace] Set error:', error)
    res.status(500).json({ error: 'Failed to set workspace' })
  }
})

// Load files from disk
router.get('/files', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required', files: [] })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found', files: [] })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied', files: [] })
      return
    }

    // Get workspace path from thread metadata
    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | null

    if (!workspacePath) {
      res.json({ success: false, error: 'No workspace folder linked', files: [] })
      return
    }

    const files: Array<{
      path: string
      is_dir: boolean
      size?: number
      modified_at?: string
    }> = []

    // Recursively read directory
    async function readDir(dirPath: string, relativePath: string = ''): Promise<void> {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        // Skip hidden files and common non-project files
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue
        }

        const fullPath = path.join(dirPath, entry.name)
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          files.push({
            path: '/' + relPath,
            is_dir: true
          })
          await readDir(fullPath, relPath)
        } else {
          const stat = await fs.stat(fullPath)
          files.push({
            path: '/' + relPath,
            is_dir: false,
            size: stat.size,
            modified_at: stat.mtime.toISOString()
          })
        }
      }
    }

    await readDir(workspacePath)

    // Start watching for file changes
    startWatching(threadId, workspacePath)

    res.json({
      success: true,
      files,
      workspacePath
    })
  } catch (e) {
    res.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      files: []
    })
  }
})

// Read a single file's contents from disk
router.get('/file', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const filePath = req.query.path as string
    const binary = req.query.binary === 'true'
    const userId = req.user!.userId

    if (!threadId || !filePath) {
      res.status(400).json({ success: false, error: 'threadId and path are required' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Get workspace path from thread metadata
    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | null

    if (!workspacePath) {
      res.json({ success: false, error: 'No workspace folder linked' })
      return
    }

    // Convert virtual path to full disk path
    const relativePath = filePath.startsWith('/') ? filePath.slice(1) : filePath
    const fullPath = path.join(workspacePath, relativePath)

    // Security check: ensure the resolved path is within the workspace
    const resolvedPath = path.resolve(fullPath)
    const resolvedWorkspace = path.resolve(workspacePath)
    if (!resolvedPath.startsWith(resolvedWorkspace)) {
      res.json({ success: false, error: 'Access denied: path outside workspace' })
      return
    }

    // Check if file exists
    const stat = await fs.stat(fullPath)
    if (stat.isDirectory()) {
      res.json({ success: false, error: 'Cannot read directory as file' })
      return
    }

    if (binary) {
      // Read file as binary and convert to base64
      const buffer = await fs.readFile(fullPath)
      const base64 = buffer.toString('base64')
      res.json({
        success: true,
        content: base64,
        size: stat.size,
        modified_at: stat.mtime.toISOString()
      })
    } else {
      // Read file contents as text
      const content = await fs.readFile(fullPath, 'utf-8')
      res.json({
        success: true,
        content,
        size: stat.size,
        modified_at: stat.mtime.toISOString()
      })
    }
  } catch (e) {
    res.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error'
    })
  }
})

// ============================================
// E2B Cloud Sandbox Routes
// ============================================

// Get sandbox status and info for a thread (resolves to agent's sandbox)
router.get('/sandbox/status', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    // Check if E2B is enabled
    if (!E2B_ENABLED) {
      res.json({ success: true, enabled: false, sandboxId: null })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Get the agent's sandbox (not thread's)
    const agentId = thread.agent_id
    let sandboxId: string | null = null
    if (agentId) {
      const agent = getAgent(agentId)
      sandboxId = agent?.e2b_sandbox_id || null
    }

    res.json({
      success: true,
      enabled: true,
      sandboxId,
      agentId,
      workspacePath: getE2bWorkspacePath()
    })
  } catch (error) {
    console.error('[Workspace] Sandbox status error:', error)
    res.status(500).json({ success: false, error: 'Failed to get sandbox status' })
  }
})

// List files in E2B sandbox (recursive, filters hidden files)
// Uses the agent's sandbox (resolved from threadId)
router.get('/sandbox/files', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required', files: [] })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled', files: [] })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found', files: [] })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied', files: [] })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned', files: [] })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get or create sandbox for the agent, passing backup for restoration
    let sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const sandboxRoot = getE2bWorkspacePath()

    // Recursively list files, filtering hidden files
    const files: Array<{ name: string; path: string; is_dir: boolean }> = []

    async function listDir(dirPath: string, relativePath: string = ''): Promise<void> {
      const entries = await sandbox.files.list(dirPath)

      for (const entry of entries) {
        // Skip hidden files (starting with .)
        if (entry.name.startsWith('.')) {
          continue
        }

        const fullPath = `${dirPath}/${entry.name}`
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        const isDir = entry.type === 'dir'

        files.push({
          name: entry.name,
          path: '/' + relPath,
          is_dir: isDir
        })

        // Recursively list subdirectories
        if (isDir) {
          await listDir(fullPath, relPath)
        }
      }
    }

    // Try to list files, with retry on paused sandbox error
    try {
      await listDir(sandboxRoot)
    } catch (err) {
      // Check if this is a paused/not-found sandbox error
      if (isPausedSandboxError(err)) {
        console.log(`[Workspace] Sandbox paused for agent ${agentId}, reconnecting with backup restoration...`)

        // Close the cached sandbox and get a fresh one with backup restoration
        closeSandbox(agentId)
        updateAgentSandboxId(agentId, null)
        sandbox = await getOrCreateSandbox(agentId, backup || undefined)

        // Retry listing files
        files.length = 0 // Clear any partial results
        await listDir(sandboxRoot)
      } else {
        console.error(`[Workspace] Error listing ${sandboxRoot}:`, err)
        // Continue with empty files array for non-paused errors
      }
    }

    res.json({
      success: true,
      files,
      currentPath: sandboxRoot,
      workspacePath: sandboxRoot
    })
  } catch (error) {
    console.error('[Workspace] Sandbox files error:', error)
    res.status(500).json({ success: false, error: 'Failed to list sandbox files', files: [] })
  }
})

// Read file from E2B sandbox (uses agent's sandbox)
router.get('/sandbox/file', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const filePath = req.query.path as string
    const userId = req.user!.userId

    if (!threadId || !filePath) {
      res.status(400).json({ success: false, error: 'threadId and path are required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get sandbox and read file
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const absolutePath = filePath.startsWith('/') ? filePath : `${getE2bWorkspacePath()}/${filePath}`
    const content = await sandbox.files.read(absolutePath)

    res.json({
      success: true,
      content,
      path: absolutePath
    })
  } catch (error) {
    console.error('[Workspace] Sandbox file read error:', error)
    res.status(500).json({ success: false, error: 'Failed to read file from sandbox' })
  }
})

// Write/upload file to E2B sandbox (uses agent's sandbox)
router.post('/sandbox/file', async (req, res) => {
  try {
    const { threadId, path: filePath, content } = req.body
    const userId = req.user!.userId

    if (!threadId || !filePath || content === undefined) {
      res.status(400).json({ success: false, error: 'threadId, path, and content are required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get sandbox and write file
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const absolutePath = filePath.startsWith('/') ? filePath : `${getE2bWorkspacePath()}/${filePath}`

    // Create parent directories if needed
    const dir = absolutePath.substring(0, absolutePath.lastIndexOf('/'))
    if (dir && dir !== getE2bWorkspacePath()) {
      await sandbox.commands.run(`mkdir -p "${dir}"`)
    }

    await sandbox.files.write(absolutePath, content)

    res.json({
      success: true,
      path: absolutePath
    })
  } catch (error) {
    console.error('[Workspace] Sandbox file write error:', error)
    res.status(500).json({ success: false, error: 'Failed to write file to sandbox' })
  }
})

// Execute command in E2B sandbox (uses agent's sandbox)
router.post('/sandbox/execute', async (req, res) => {
  try {
    const { threadId, command } = req.body
    const userId = req.user!.userId

    if (!threadId || !command) {
      res.status(400).json({ success: false, error: 'threadId and command are required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get sandbox and execute command
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const result = await sandbox.commands.run(command, {
      cwd: getE2bWorkspacePath(),
      timeoutMs: 120_000
    })

    res.json({
      success: true,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    })
  } catch (error) {
    console.error('[Workspace] Sandbox execute error:', error)
    res.status(500).json({ success: false, error: 'Failed to execute command in sandbox' })
  }
})

// Upload a local folder to E2B sandbox (uses agent's sandbox)
router.post('/sandbox/upload-folder', async (req, res) => {
  try {
    const { threadId, localPath } = req.body
    const userId = req.user!.userId

    if (!threadId || !localPath) {
      res.status(400).json({ success: false, error: 'threadId and localPath are required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Validate local path
    const resolvedPath = path.resolve(localPath)
    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isDirectory()) {
        res.status(400).json({ success: false, error: 'Path is not a directory' })
        return
      }
    } catch {
      res.status(400).json({ success: false, error: 'Path does not exist' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get or create sandbox for the agent
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const sandboxRoot = getE2bWorkspacePath()

    // Recursively upload files
    let uploadedCount = 0
    let errorCount = 0

    async function uploadDir(dirPath: string, sandboxPath: string): Promise<void> {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        // Skip hidden files and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue
        }

        const localFullPath = path.join(dirPath, entry.name)
        const sandboxFullPath = `${sandboxPath}/${entry.name}`

        if (entry.isDirectory()) {
          // Create directory in sandbox
          await sandbox.commands.run(`mkdir -p "${sandboxFullPath}"`)
          await uploadDir(localFullPath, sandboxFullPath)
        } else {
          try {
            // Read file and upload to sandbox
            const content = await fs.readFile(localFullPath, 'utf-8')
            await sandbox.files.write(sandboxFullPath, content)
            uploadedCount++
          } catch (err) {
            console.error(`[Workspace] Failed to upload ${localFullPath}:`, err)
            errorCount++
          }
        }
      }
    }

    await uploadDir(resolvedPath, sandboxRoot)

    // Save local path to thread metadata for sync-back
    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    metadata.workspacePath = resolvedPath
    updateThread(threadId, { metadata: JSON.stringify(metadata) })

    res.json({
      success: true,
      filesUploaded: uploadedCount,
      errors: errorCount,
      localPath: resolvedPath,
      sandboxPath: sandboxRoot
    })
  } catch (error) {
    console.error('[Workspace] Upload folder error:', error)
    res.status(500).json({ success: false, error: 'Failed to upload folder to sandbox' })
  }
})

// Sync E2B sandbox files back to local folder (uses agent's sandbox)
router.post('/sandbox/sync-to-local', async (req, res) => {
  try {
    const { threadId } = req.body
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Get local workspace path from thread metadata
    const metadata = thread.metadata ? JSON.parse(thread.metadata) : {}
    const localPath = metadata.workspacePath as string | null

    if (!localPath) {
      res.status(400).json({ success: false, error: 'No local workspace path set. Upload a folder first.' })
      return
    }

    // Validate local path still exists
    try {
      await fs.access(localPath)
    } catch {
      res.status(400).json({ success: false, error: 'Local workspace path no longer exists' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = getAgentFileBackup(agentId)

    // Get sandbox for the agent
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const sandboxRoot = getE2bWorkspacePath()

    // Recursively download files
    let downloadedCount = 0
    let errorCount = 0

    async function downloadDir(sandboxPath: string, localDir: string): Promise<void> {
      const entries = await sandbox.files.list(sandboxPath)

      for (const entry of entries) {
        // Skip hidden files
        if (entry.name.startsWith('.')) {
          continue
        }

        const sandboxFullPath = `${sandboxPath}/${entry.name}`
        const localFullPath = path.join(localDir, entry.name)

        if (entry.type === 'dir') {
          // Create directory locally
          await fs.mkdir(localFullPath, { recursive: true })
          await downloadDir(sandboxFullPath, localFullPath)
        } else {
          try {
            // Read from sandbox and write locally
            const content = await sandbox.files.read(sandboxFullPath)
            await fs.writeFile(localFullPath, content)
            downloadedCount++
          } catch (err) {
            console.error(`[Workspace] Failed to download ${sandboxFullPath}:`, err)
            errorCount++
          }
        }
      }
    }

    await downloadDir(sandboxRoot, localPath)

    res.json({
      success: true,
      filesDownloaded: downloadedCount,
      errors: errorCount,
      localPath,
      sandboxPath: sandboxRoot
    })
  } catch (error) {
    console.error('[Workspace] Sync to local error:', error)
    res.status(500).json({ success: false, error: 'Failed to sync sandbox to local folder' })
  }
})

// ============================================
// Sandbox File Backup Routes (Agent-Based)
// ============================================

// Get backup status for a thread (resolves to agent's backup)
router.get('/sandbox/backup/status', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's backup
    const agentId = thread.agent_id
    if (!agentId) {
      res.json({
        success: true,
        schedulerActive: false,
        backup: null
      })
      return
    }

    const status = getBackupStatus(agentId)

    res.json({
      success: true,
      schedulerActive: status.schedulerActive,
      backup: status.backupInfo
    })
  } catch (error) {
    console.error('[Workspace] Get backup status error:', error)
    res.status(500).json({ success: false, error: 'Failed to get backup status' })
  }
})

// Trigger manual backup (uses agent's sandbox)
router.post('/sandbox/backup', async (req, res) => {
  try {
    const { threadId } = req.body
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Perform backup for agent
    await performBackup(agentId)

    const backupInfo = getAgentBackupInfo(agentId)

    res.json({
      success: true,
      backup: backupInfo
    })
  } catch (error) {
    console.error('[Workspace] Manual backup error:', error)
    res.status(500).json({ success: false, error: 'Failed to perform backup' })
  }
})

// Force restore from backup (creates new sandbox with backed up files, uses agent's sandbox)
router.post('/sandbox/backup/restore', async (req, res) => {
  try {
    const { threadId } = req.body
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    if (!E2B_ENABLED) {
      res.status(400).json({ success: false, error: 'E2B is not enabled' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's sandbox
    const agentId = thread.agent_id
    if (!agentId) {
      res.status(400).json({ success: false, error: 'Thread has no agent assigned' })
      return
    }

    // Get agent's backup
    const backup = getAgentFileBackup(agentId)
    if (!backup || backup.length === 0) {
      res.status(404).json({ success: false, error: 'No backup found for this agent' })
      return
    }

    // Clear the old sandbox ID to force creation of a new one
    updateAgentSandboxId(agentId, null)

    // Create new sandbox with restored files for the agent
    const sandbox = await getOrCreateSandbox(agentId, backup)

    // Start backup scheduler for the new sandbox
    startBackupScheduler(agentId)

    res.json({
      success: true,
      sandboxId: sandbox.sandboxId,
      filesRestored: backup.length
    })
  } catch (error) {
    console.error('[Workspace] Restore from backup error:', error)
    res.status(500).json({ success: false, error: 'Failed to restore from backup' })
  }
})

// Clear backup for a thread (clears agent's backup)
router.delete('/sandbox/backup', async (req, res) => {
  try {
    const threadId = req.query.threadId as string
    const userId = req.user!.userId

    if (!threadId) {
      res.status(400).json({ success: false, error: 'threadId is required' })
      return
    }

    // Get thread and verify ownership
    const thread = getThread(threadId)
    if (!thread) {
      res.status(404).json({ success: false, error: 'Thread not found' })
      return
    }

    if (thread.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Resolve to agent's backup
    const agentId = thread.agent_id
    if (!agentId) {
      res.json({ success: true })
      return
    }

    clearAgentFileBackup(agentId)

    res.json({ success: true })
  } catch (error) {
    console.error('[Workspace] Clear backup error:', error)
    res.status(500).json({ success: false, error: 'Failed to clear backup' })
  }
})

export default router
