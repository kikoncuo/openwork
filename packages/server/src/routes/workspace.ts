/**
 * Workspace routes - E2B sandbox operations with auth
 * All file management happens through E2B cloud sandboxes.
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getThread, getAgentFileBackup, getAgentBackupInfo, clearAgentFileBackup, updateAgentSandboxId, getAgentFileByPath, saveAgentFile, deleteAgentFile, deleteAgentFilesInFolder, listAgentBackupFiles } from '../services/db/index.js'
import { getAgent } from '../services/db/agents.js'
import { getOrCreateSandbox, getE2bWorkspacePath, isPausedSandboxError, closeSandbox } from '../services/agent/e2b-sandbox.js'
import { performBackup, getBackupStatus, startBackupScheduler } from '../services/agent/backup-scheduler.js'

const router = Router()

// Apply auth middleware to all workspace routes
router.use(requireAuth)

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
    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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
      const agent = await getAgent(agentId)
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
// Can use agentId directly, or resolve from threadId
router.get('/sandbox/files', async (req, res) => {
  try {
    const threadId = req.query.threadId as string | undefined
    const agentIdParam = req.query.agentId as string | undefined
    const userId = req.user!.userId

    if (!threadId && !agentIdParam) {
      res.status(400).json({ success: false, error: 'threadId or agentId is required', files: [] })
      return
    }

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured', files: [] })
      return
    }

    // Resolve agentId - either from param or from thread
    let agentId: string | null = agentIdParam || null

    if (!agentId && threadId) {
      // Get thread and verify ownership
      const thread = await getThread(threadId)
      if (!thread) {
        res.status(404).json({ success: false, error: 'Thread not found', files: [] })
        return
      }

      if (thread.user_id !== userId) {
        res.status(403).json({ success: false, error: 'Access denied', files: [] })
        return
      }

      agentId = thread.agent_id
    }

    // Verify agent exists and belongs to user
    if (agentId) {
      const agent = await getAgent(agentId)
      if (!agent) {
        res.status(404).json({ success: false, error: 'Agent not found', files: [] })
        return
      }
      if (agent.user_id !== userId) {
        res.status(403).json({ success: false, error: 'Access denied', files: [] })
        return
      }
    }

    if (!agentId) {
      res.status(400).json({ success: false, error: 'No agent specified', files: [] })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = await getAgentFileBackup(agentId)

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
        await updateAgentSandboxId(agentId, null)
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

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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
    const backup = await getAgentFileBackup(agentId)

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

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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
    const backup = await getAgentFileBackup(agentId)

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

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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
    const backup = await getAgentFileBackup(agentId)

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

// Execute command in E2B sandbox by agentId (for terminal panel)
router.post('/sandbox/execute-terminal', async (req, res) => {
  try {
    const { agentId, command, cwd } = req.body
    const userId = req.user!.userId

    if (!agentId || !command) {
      res.status(400).json({ success: false, error: 'agentId and command are required' })
      return
    }

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Verify agent ownership
    const agent = await getAgent(agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Fetch any existing backup for restoration when sandbox is created/recreated
    const backup = await getAgentFileBackup(agentId)

    // Get sandbox and execute command
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)
    const result = await sandbox.commands.run(command, {
      cwd: cwd || getE2bWorkspacePath(),
      timeoutMs: 120_000
    })

    res.json({
      success: true,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    })
  } catch (error) {
    console.error('[Workspace] Terminal execute error:', error)
    res.status(500).json({ success: false, error: 'Failed to execute command in sandbox' })
  }
})

// ============================================
// Sandbox File Backup Routes (Agent-Based)
// ============================================

// Get backup status (can use agentId directly or resolve from threadId)
router.get('/sandbox/backup/status', async (req, res) => {
  try {
    const threadId = req.query.threadId as string | undefined
    const agentIdParam = req.query.agentId as string | undefined
    const userId = req.user!.userId

    if (!threadId && !agentIdParam) {
      res.status(400).json({ success: false, error: 'threadId or agentId is required' })
      return
    }

    // Resolve agentId - either from param or from thread
    let agentId: string | null = agentIdParam || null

    if (!agentId && threadId) {
      // Get thread and verify ownership
      const thread = await getThread(threadId)
      if (!thread) {
        res.status(404).json({ success: false, error: 'Thread not found' })
        return
      }

      if (thread.user_id !== userId) {
        res.status(403).json({ success: false, error: 'Access denied' })
        return
      }

      agentId = thread.agent_id
    }

    // Verify agent exists and belongs to user
    if (agentId) {
      const agent = await getAgent(agentId)
      if (!agent) {
        res.status(404).json({ success: false, error: 'Agent not found' })
        return
      }
      if (agent.user_id !== userId) {
        res.status(403).json({ success: false, error: 'Access denied' })
        return
      }
    }

    if (!agentId) {
      res.json({
        success: true,
        schedulerActive: false,
        backup: null
      })
      return
    }

    const status = await getBackupStatus(agentId)

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

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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

    const backupInfo = await getAgentBackupInfo(agentId)

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

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get thread and verify ownership
    const thread = await getThread(threadId)
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
    const backup = await getAgentFileBackup(agentId)
    if (!backup || backup.length === 0) {
      res.status(404).json({ success: false, error: 'No backup found for this agent' })
      return
    }

    // Clear the old sandbox ID to force creation of a new one
    await updateAgentSandboxId(agentId, null)

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
    const thread = await getThread(threadId)
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

    await clearAgentFileBackup(agentId)

    res.json({ success: true })
  } catch (error) {
    console.error('[Workspace] Clear backup error:', error)
    res.status(500).json({ success: false, error: 'Failed to clear backup' })
  }
})

// ============================================
// Backup-First File Operations (Phase 2)
// ============================================

// Read file from backup (primary read method - no sandbox needed)
router.get('/backup/file', async (req, res) => {
  try {
    const agentId = req.query.agentId as string
    const filePath = req.query.path as string
    const userId = req.user!.userId

    if (!agentId || !filePath) {
      res.status(400).json({ success: false, error: 'agentId and path are required' })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Read file from backup
    const file = await getAgentFileByPath(agentId, filePath)
    if (!file) {
      res.status(404).json({ success: false, error: 'File not found in backup' })
      return
    }

    res.json({
      success: true,
      content: file.content,
      path: file.path,
      encoding: file.encoding || 'utf8'  // Include encoding so client knows how to decode
    })
  } catch (error) {
    console.error('[Workspace] Backup file read error:', error)
    res.status(500).json({ success: false, error: 'Failed to read file from backup' })
  }
})

// Write/upload file to backup
router.post('/backup/file', async (req, res) => {
  try {
    const { agentId, path: filePath, content, encoding } = req.body
    const userId = req.user!.userId

    if (!agentId || !filePath || content === undefined) {
      res.status(400).json({ success: false, error: 'agentId, path, and content are required' })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Save file to backup with optional encoding (base64 for binary files)
    const fileEncoding = encoding === 'base64' ? 'base64' : undefined
    await saveAgentFile(agentId, filePath, content, fileEncoding)

    res.json({
      success: true,
      path: filePath
    })
  } catch (error) {
    console.error('[Workspace] Backup file write error:', error)
    res.status(500).json({ success: false, error: 'Failed to write file to backup' })
  }
})

// Delete file from backup
router.delete('/backup/file', async (req, res) => {
  try {
    const agentId = req.query.agentId as string
    const filePath = req.query.path as string
    const userId = req.user!.userId

    if (!agentId || !filePath) {
      res.status(400).json({ success: false, error: 'agentId and path are required' })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Delete file from backup
    const deleted = await deleteAgentFile(agentId, filePath)

    res.json({
      success: true,
      deleted
    })
  } catch (error) {
    console.error('[Workspace] Backup file delete error:', error)
    res.status(500).json({ success: false, error: 'Failed to delete file from backup' })
  }
})

// ============================================
// Folder Operations
// ============================================

// Download folder as ZIP
router.get('/:agentId/folder/download', async (req, res) => {
  try {
    const agentId = req.params.agentId
    const folderPath = req.query.path as string
    const userId = req.user!.userId

    if (!folderPath) {
      res.status(400).json({ success: false, error: 'path query parameter is required' })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Security check: path must be under /home/user
    if (!folderPath.startsWith('/home/user/') && folderPath !== '/home/user') {
      res.status(403).json({ success: false, error: 'Access denied: path must be under /home/user/' })
      return
    }

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get or create sandbox for the agent
    const backup = await getAgentFileBackup(agentId)
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)

    // Create zip file in sandbox
    const zipPath = '/tmp/folder_download.zip'
    const zipResult = await sandbox.commands.run(`cd "${folderPath}" && zip -r "${zipPath}" .`, {
      timeoutMs: 120_000
    })

    if (zipResult.exitCode !== 0) {
      console.error('[Workspace] Zip creation failed:', zipResult.stderr)
      res.status(500).json({ success: false, error: 'Failed to create zip file' })
      return
    }

    // Read zip file bytes
    const zipBytes = await sandbox.files.read(zipPath)

    // Clean up temp zip file
    await sandbox.commands.run(`rm -f "${zipPath}"`)

    // Get folder name for the download filename
    const folderName = folderPath.split('/').filter(Boolean).pop() || 'folder'

    // Send binary response
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`)
    res.send(Buffer.from(zipBytes))
  } catch (error) {
    console.error('[Workspace] Download folder error:', error)
    res.status(500).json({ success: false, error: 'Failed to download folder' })
  }
})

// Empty folder contents (delete everything inside, keep the folder)
router.delete('/:agentId/folder/empty', async (req, res) => {
  try {
    const agentId = req.params.agentId
    const folderPath = req.query.path as string
    const userId = req.user!.userId

    if (!folderPath) {
      res.status(400).json({ success: false, error: 'path query parameter is required' })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    // Security check: path must be /home/user or under it, but not anything outside it
    // Normalize path (remove trailing slash if present)
    const normalizedPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath
    if (normalizedPath !== '/home/user' && !normalizedPath.startsWith('/home/user/')) {
      res.status(403).json({ success: false, error: 'Access denied: can only empty /home/user or paths under it' })
      return
    }

    if (!process.env.E2B_API_KEY) {
      res.status(400).json({ success: false, error: 'E2B_API_KEY is not configured' })
      return
    }

    // Get or create sandbox for the agent
    const backup = await getAgentFileBackup(agentId)
    const sandbox = await getOrCreateSandbox(agentId, backup || undefined)

    // Step 1: Delete files from backup storage first (this is what the UI shows)
    const deletedFromBackup = await deleteAgentFilesInFolder(agentId, folderPath)
    console.log(`[Workspace] Deleted ${deletedFromBackup} files from backup for folder ${folderPath}`)

    // Step 2: Also delete from sandbox if available (best effort, don't fail if sandbox is unavailable)
    try {
      // Delete all contents inside the folder (but keep the folder itself)
      // Using rm -rf with /* to delete contents, and also hidden files with .[!.]* and ..?*
      const rmResult = await sandbox.commands.run(
        `rm -rf "${folderPath}"/* "${folderPath}"/.[!.]* "${folderPath}"/..?* 2>/dev/null || true`,
        { timeoutMs: 120_000 }
      )

      if (rmResult.exitCode !== 0) {
        // Some errors are expected (e.g., no hidden files), so we don't fail entirely
        console.warn('[Workspace] Empty folder sandbox warnings:', rmResult.stderr)
      }
    } catch (sandboxError) {
      // Sandbox might be unavailable, but backup was already cleared so we consider this a success
      console.warn('[Workspace] Could not clear sandbox (backup was cleared):', sandboxError)
    }

    res.json({ success: true, deletedFiles: deletedFromBackup })
  } catch (error) {
    console.error('[Workspace] Empty folder error:', error)
    res.status(500).json({ success: false, error: 'Failed to empty folder' })
  }
})

// List files from backup (path + size, no content)
router.get('/backup/files', async (req, res) => {
  try {
    const agentId = req.query.agentId as string
    const userId = req.user!.userId

    if (!agentId) {
      res.status(400).json({ success: false, error: 'agentId is required', files: [] })
      return
    }

    // Verify agent exists and belongs to user
    const agent = await getAgent(agentId)
    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found', files: [] })
      return
    }
    if (agent.user_id !== userId) {
      res.status(403).json({ success: false, error: 'Access denied', files: [] })
      return
    }

    // List files from backup
    const files = await listAgentBackupFiles(agentId)

    res.json({
      success: true,
      files
    })
  } catch (error) {
    console.error('[Workspace] Backup files list error:', error)
    res.status(500).json({ success: false, error: 'Failed to list files from backup', files: [] })
  }
})

export default router
