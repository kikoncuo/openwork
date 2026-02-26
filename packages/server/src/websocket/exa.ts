import { Socket } from 'socket.io'
import { exaService } from '../services/apps/exa/index.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, { connection?: () => void }>()

export function registerExaHandlers(socket: Socket): void {
  // Extract userId from authenticated socket
  const userId = socket.user?.userId

  console.log('[Exa WS] registerExaHandlers called, userId:', userId, 'socketId:', socket.id)

  if (!userId) {
    console.warn('[Exa WS] Socket missing userId, skipping handler registration')
    return
  }

  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, {})

  // Subscribe to connection change events
  socket.on('exa:subscribeConnection', () => {
    console.log('[Exa WS] subscribeConnection received for user:', userId)
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.connection) {
      cleanups.connection()
    }

    cleanups.connection = exaService.onConnectionChange(userId, (status) => {
      console.log('[Exa WS] Connection change callback fired, emitting to socket:', socket.id)
      console.log('[Exa WS] Status:', JSON.stringify(status))
      socket.emit('exa:connection', status)
    })
    console.log('[Exa WS] Subscription registered for user:', userId)
  })

  // Unsubscribe from connection change events
  socket.on('exa:unsubscribeConnection', () => {
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
