import { Socket } from 'socket.io'
import { googleWorkspaceService } from '../services/apps/google-workspace/index.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, { connection?: () => void }>()

export function registerGoogleWorkspaceHandlers(socket: Socket): void {
  // Extract userId from authenticated socket
  const userId = socket.user?.userId

  console.log('[Google Workspace WS] registerGoogleWorkspaceHandlers called, userId:', userId, 'socketId:', socket.id)

  if (!userId) {
    console.warn('[Google Workspace WS] Socket missing userId, skipping handler registration')
    return
  }

  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, {})

  // Subscribe to connection change events
  socket.on('google-workspace:subscribeConnection', () => {
    console.log('[Google Workspace WS] subscribeConnection received for user:', userId)
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.connection) {
      cleanups.connection()
    }

    cleanups.connection = googleWorkspaceService.onConnectionChange(userId, (status) => {
      console.log('[Google Workspace WS] Connection change callback fired, emitting to socket:', socket.id)
      console.log('[Google Workspace WS] Status:', JSON.stringify(status))
      socket.emit('google-workspace:connection', status)
    })
    console.log('[Google Workspace WS] Subscription registered for user:', userId)
  })

  // Unsubscribe from connection change events
  socket.on('google-workspace:unsubscribeConnection', () => {
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
