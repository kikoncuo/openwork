import { Socket } from 'socket.io'
import { microsoftTeamsService } from '../services/apps/microsoft-teams/index.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, { connection?: () => void }>()

export function registerMicrosoftTeamsHandlers(socket: Socket): void {
  const userId = socket.user?.userId

  if (!userId) {
    return
  }

  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, {})

  // Subscribe to connection change events
  socket.on('microsoft-teams:subscribeConnection', () => {
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.connection) {
      cleanups.connection()
    }

    cleanups.connection = microsoftTeamsService.onConnectionChange(userId, (status) => {
      socket.emit('microsoft-teams:connection', status)
    })
  })

  // Unsubscribe from connection change events
  socket.on('microsoft-teams:unsubscribeConnection', () => {
    const cleanups = socketCleanups.get(socket.id)
    if (cleanups?.connection) {
      cleanups.connection()
      cleanups.connection = undefined
    }
  })

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    const cleanups = socketCleanups.get(socket.id)
    if (cleanups) {
      if (cleanups.connection) cleanups.connection()
      socketCleanups.delete(socket.id)
    }
  })
}
