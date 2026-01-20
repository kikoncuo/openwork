// Load environment variables first (before any other imports that check env vars)
import './env.js'

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

import { initializeDatabase } from './services/db/index.js'
import { registerRoutes } from './routes/index.js'
import { registerWebSocketHandlers } from './websocket/index.js'

const app = express()
const httpServer = createServer(app)

// Socket.IO setup with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))

// Suppress expected errors from LangChain stream handlers when streams are aborted
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  const message = args.map((a) => String(a)).join(' ')
  if (
    message.includes('Controller is already closed') ||
    message.includes('ERR_INVALID_STATE') ||
    (message.includes('StreamMessagesHandler') && message.includes('aborted'))
  ) {
    return
  }
  originalConsoleError.apply(console, args)
}

process.on('uncaughtException', (error) => {
  if (
    error.message?.includes('Controller is already closed') ||
    error.message?.includes('aborted')
  ) {
    return
  }
  originalConsoleError('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message?.includes('Controller is already closed') || message?.includes('aborted')) {
    return
  }
  originalConsoleError('Unhandled rejection:', reason)
})

async function main() {
  console.log('Starting OpenWork server...')

  // Initialize database
  await initializeDatabase()
  console.log('Database initialized')

  // Register REST routes
  registerRoutes(app)
  console.log('REST routes registered')

  // Register WebSocket handlers
  registerWebSocketHandlers(io)
  console.log('WebSocket handlers registered')

  // Start server
  const PORT = parseInt(process.env.PORT || '3001', 10)
  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
    console.log(`WebSocket server ready`)
  })
}

main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})

export { app, io }
