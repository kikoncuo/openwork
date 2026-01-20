import { Socket } from 'socket.io'
import { onFilesChanged } from '../services/misc/workspace-watcher.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, Map<string, () => void>>()

export function registerWorkspaceHandlers(socket: Socket): void {
  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, new Map())

  // Subscribe to workspace file changes
  socket.on('workspace:subscribe', ({ threadId }: { threadId: string }) => {
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription for this thread
    const existingCleanup = cleanups.get(threadId)
    if (existingCleanup) {
      existingCleanup()
    }

    // Subscribe to file changes
    const cleanup = onFilesChanged(threadId, (files) => {
      socket.emit(`workspace:files-changed:${threadId}`, files)
    })

    cleanups.set(threadId, cleanup)
  })

  // Unsubscribe from workspace file changes
  socket.on('workspace:unsubscribe', ({ threadId }: { threadId: string }) => {
    const cleanups = socketCleanups.get(socket.id)
    const cleanup = cleanups?.get(threadId)
    if (cleanup) {
      cleanup()
      cleanups?.delete(threadId)
    }
  })

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    const cleanups = socketCleanups.get(socket.id)
    if (cleanups) {
      for (const cleanup of cleanups.values()) {
        cleanup()
      }
      socketCleanups.delete(socket.id)
    }
  })
}
