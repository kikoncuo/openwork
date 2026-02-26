import { Socket } from 'socket.io'
import { slackService } from '../services/apps/slack/index.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, { connection?: () => void }>()

export function registerSlackHandlers(socket: Socket): void {
  const userId = socket.user?.userId
  if (!userId) return

  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, {})

  // Subscribe to connection change events
  socket.on('slack:subscribeConnection', () => {
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.connection) {
      cleanups.connection()
    }

    cleanups.connection = slackService.onConnectionChange(userId, (status) => {
      socket.emit('slack:connection', status)
    })
  })

  // Unsubscribe from connection change events
  socket.on('slack:unsubscribeConnection', () => {
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
