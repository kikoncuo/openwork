import { Server, Socket } from 'socket.io'
import { registerAgentStreamHandlers } from './agent-stream.js'
import { registerWhatsAppHandlers } from './whatsapp.js'
import { registerWorkspaceHandlers } from './workspace.js'
import { verifySocketAuth } from '../middleware/auth.js'

// Extend Socket type to include user info
declare module 'socket.io' {
  interface Socket {
    user?: {
      userId: string
      email: string
    }
  }
}

// Track user -> socket IDs for broadcasting to specific users
const userSockets = new Map<string, Set<string>>()
let ioInstance: Server | null = null

/**
 * Broadcast an event to all sockets belonging to a specific user
 */
export function broadcastToUser(userId: string, event: string, data: unknown): void {
  if (!ioInstance) {
    console.warn('[WebSocket] Cannot broadcast - io not initialized')
    return
  }

  const socketIds = userSockets.get(userId)
  if (!socketIds || socketIds.size === 0) {
    console.log(`[WebSocket] No sockets found for user ${userId}`)
    return
  }

  for (const socketId of socketIds) {
    const socket = ioInstance.sockets.sockets.get(socketId)
    if (socket) {
      socket.emit(event, data)
    }
  }
  console.log(`[WebSocket] Broadcast '${event}' to ${socketIds.size} socket(s) for user ${userId}`)
}

export function registerWebSocketHandlers(io: Server): void {
  // Store io instance for broadcastToUser
  ioInstance = io

  // Authentication middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '')

    if (!token) {
      return next(new Error('Authentication required'))
    }

    const payload = verifySocketAuth(token)
    if (!payload) {
      return next(new Error('Invalid or expired token'))
    }

    // Attach user info to socket
    socket.user = {
      userId: payload.userId,
      email: payload.email
    }

    next()
  })

  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}, user: ${socket.user?.email}`)

    // Track socket by user ID for broadcasting
    const userId = socket.user?.userId
    if (userId) {
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set())
      }
      userSockets.get(userId)!.add(socket.id)
    }

    // Register domain-specific handlers
    registerAgentStreamHandlers(socket)
    registerWhatsAppHandlers(socket)
    registerWorkspaceHandlers(socket)

    socket.on('disconnect', (reason) => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`)

      // Clean up user socket tracking
      if (userId) {
        userSockets.get(userId)?.delete(socket.id)
        // Clean up empty sets
        if (userSockets.get(userId)?.size === 0) {
          userSockets.delete(userId)
        }
      }
    })
  })
}
