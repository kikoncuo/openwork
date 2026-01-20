/**
 * Backup Scheduler - Periodically backs up E2B sandbox files to the database.
 *
 * This service ensures that files created in E2B sandboxes are persisted
 * and can be recovered if the sandbox is paused or garbage collected.
 *
 * Backups are now agent-based: each agent has its own sandbox and backup.
 */

import { backupSandboxFiles, hasCachedSandbox } from './e2b-sandbox.js'
import { saveAgentFileBackup, getAgentBackupInfo } from '../db/index.js'

// Configuration
const BACKUP_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
const BACKUP_DEBOUNCE_MS = 30 * 1000 // 30 seconds

// Track active backup intervals per agent
const backupIntervals = new Map<string, NodeJS.Timeout>()

// Track pending debounced backups per agent
const pendingBackups = new Map<string, NodeJS.Timeout>()

/**
 * Start periodic backups for an agent's sandbox.
 * Backups run every BACKUP_INTERVAL_MS while the sandbox is active.
 */
export function startBackupScheduler(agentId: string): void {
  // Don't start if already running
  if (backupIntervals.has(agentId)) {
    return
  }

  console.log(`[Backup] Starting scheduler for agent ${agentId}`)

  const timer = setInterval(async () => {
    await performBackup(agentId)
  }, BACKUP_INTERVAL_MS)

  backupIntervals.set(agentId, timer)

  // Perform initial backup
  performBackup(agentId).catch((error) => {
    console.error(`[Backup] Initial backup failed for agent ${agentId}:`, error)
  })
}

/**
 * Stop periodic backups for an agent.
 */
export function stopBackupScheduler(agentId: string): void {
  const timer = backupIntervals.get(agentId)
  if (timer) {
    clearInterval(timer)
    backupIntervals.delete(agentId)
    console.log(`[Backup] Stopped scheduler for agent ${agentId}`)
  }

  // Also clear any pending debounced backup
  const pendingTimer = pendingBackups.get(agentId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingBackups.delete(agentId)
  }
}

/**
 * Trigger a debounced backup for an agent.
 * Used after file writes to ensure changes are persisted.
 * Multiple calls within BACKUP_DEBOUNCE_MS will be coalesced into one backup.
 */
export function triggerDebouncedBackup(agentId: string): void {
  // Clear any existing pending backup
  const existing = pendingBackups.get(agentId)
  if (existing) {
    clearTimeout(existing)
  }

  // Schedule new backup
  const timer = setTimeout(async () => {
    pendingBackups.delete(agentId)
    await performBackup(agentId)
  }, BACKUP_DEBOUNCE_MS)

  pendingBackups.set(agentId, timer)
}

/**
 * Perform an immediate backup for an agent.
 */
export async function performBackup(agentId: string): Promise<void> {
  // Only backup if sandbox is active
  if (!hasCachedSandbox(agentId)) {
    return
  }

  try {
    const files = await backupSandboxFiles(agentId)

    if (files.length > 0) {
      saveAgentFileBackup(agentId, files)

      const totalSize = files.reduce((sum, f) => sum + f.content.length, 0)
      console.log(
        `[Backup] Saved ${files.length} files (${formatBytes(totalSize)}) for agent ${agentId}`
      )
    }
  } catch (error) {
    console.error(`[Backup] Failed for agent ${agentId}:`, error)
  }
}

/**
 * Get backup status for an agent.
 */
export function getBackupStatus(agentId: string): {
  schedulerActive: boolean
  backupInfo: { fileCount: number; totalSize: number; updatedAt: number } | null
} {
  return {
    schedulerActive: backupIntervals.has(agentId),
    backupInfo: getAgentBackupInfo(agentId)
  }
}

/**
 * Stop all backup schedulers (for shutdown).
 */
export function stopAllBackupSchedulers(): void {
  for (const [agentId, timer] of backupIntervals) {
    clearInterval(timer)
    console.log(`[Backup] Stopped scheduler for agent ${agentId}`)
  }
  backupIntervals.clear()

  for (const timer of pendingBackups.values()) {
    clearTimeout(timer)
  }
  pendingBackups.clear()
}

/**
 * Format bytes to human readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
