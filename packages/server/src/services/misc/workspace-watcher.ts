import * as fs from 'fs'
import * as path from 'path'

// Store active watchers by thread ID
const activeWatchers = new Map<string, fs.FSWatcher>()

// Store callbacks for file change notifications
const fileChangeCallbacks = new Map<string, Set<(files: { threadId: string; workspacePath: string }) => void>>()

// Debounce timers to prevent rapid-fire updates
const debounceTimers = new Map<string, NodeJS.Timeout>()

const DEBOUNCE_DELAY = 500 // ms

/**
 * Register a callback to be notified when files change in a thread's workspace
 * Returns a cleanup function to unregister the callback
 */
export function onFilesChanged(
  threadId: string,
  callback: (files: { threadId: string; workspacePath: string }) => void
): () => void {
  let callbacks = fileChangeCallbacks.get(threadId)
  if (!callbacks) {
    callbacks = new Set()
    fileChangeCallbacks.set(threadId, callbacks)
  }
  callbacks.add(callback)

  // Return cleanup function
  return () => {
    callbacks?.delete(callback)
    if (callbacks?.size === 0) {
      fileChangeCallbacks.delete(threadId)
    }
  }
}

/**
 * Start watching a workspace directory for file changes.
 * Returns true if watching was started successfully, false otherwise.
 */
export function startWatching(threadId: string, workspacePath: string): boolean {
  // Stop any existing watcher for this thread
  stopWatching(threadId)

  // Resolve to absolute path
  const resolvedPath = path.resolve(workspacePath)

  // Verify the path exists and is a directory
  try {
    const stat = fs.statSync(resolvedPath)
    if (!stat.isDirectory()) {
      console.warn(`[WorkspaceWatcher] Path is not a directory: ${resolvedPath}`)
      return false
    }
  } catch (e) {
    console.warn(`[WorkspaceWatcher] Cannot access path: ${resolvedPath}`, e)
    return false
  }

  try {
    // Use recursive watching (supported on macOS and Windows)
    const watcher = fs.watch(resolvedPath, { recursive: true }, (eventType, filename) => {
      // Skip hidden files and common non-project files
      if (filename) {
        const parts = filename.split(path.sep)
        if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) {
          return
        }
      }

      console.log(`[WorkspaceWatcher] ${eventType}: ${filename} in thread ${threadId}`)

      // Debounce to prevent rapid updates
      const existingTimer = debounceTimers.get(threadId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      const timer = setTimeout(() => {
        debounceTimers.delete(threadId)
        notifyCallbacks(threadId, resolvedPath)
      }, DEBOUNCE_DELAY)

      debounceTimers.set(threadId, timer)
    })

    watcher.on('error', (error) => {
      console.error(`[WorkspaceWatcher] Error watching ${resolvedPath}:`, error)
      stopWatching(threadId)
    })

    activeWatchers.set(threadId, watcher)
    console.log(`[WorkspaceWatcher] Started watching ${resolvedPath} for thread ${threadId}`)
    return true
  } catch (e) {
    console.error(`[WorkspaceWatcher] Failed to start watching ${resolvedPath}:`, e)
    return false
  }
}

/**
 * Stop watching the workspace for a specific thread.
 */
export function stopWatching(threadId: string): void {
  const watcher = activeWatchers.get(threadId)
  if (watcher) {
    watcher.close()
    activeWatchers.delete(threadId)
    console.log(`[WorkspaceWatcher] Stopped watching for thread ${threadId}`)
  }

  const timer = debounceTimers.get(threadId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(threadId)
  }
}

/**
 * Stop all active watchers.
 */
export function stopAllWatching(): void {
  for (const threadId of activeWatchers.keys()) {
    stopWatching(threadId)
  }
}

/**
 * Notify all registered callbacks about file changes.
 */
function notifyCallbacks(threadId: string, workspacePath: string): void {
  const callbacks = fileChangeCallbacks.get(threadId)
  if (callbacks) {
    for (const callback of callbacks) {
      try {
        callback({ threadId, workspacePath })
      } catch (e) {
        console.error('[WorkspaceWatcher] Callback error:', e)
      }
    }
  }
}

/**
 * Check if a thread's workspace is currently being watched.
 */
export function isWatching(threadId: string): boolean {
  return activeWatchers.has(threadId)
}
