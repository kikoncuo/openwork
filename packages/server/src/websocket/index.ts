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

export function registerWebSocketHandlers(io: Server): void {
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

    // Register domain-specific handlers
    registerAgentStreamHandlers(socket)
    registerWhatsAppHandlers(socket)
    registerWorkspaceHandlers(socket)

    socket.on('disconnect', (reason) => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`)
    })
  })
}
