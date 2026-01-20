import { Socket } from 'socket.io'
import { whatsappService } from '../services/apps/whatsapp/index.js'

// Track cleanup functions per socket
const socketCleanups = new Map<string, { qr?: () => void; connection?: () => void }>()

export function registerWhatsAppHandlers(socket: Socket): void {
  // Extract userId from authenticated socket
  const userId = socket.user?.userId

  if (!userId) {
    console.warn('[WhatsApp WS] Socket missing userId, skipping handler registration')
    return
  }

  // Initialize cleanup tracking for this socket
  socketCleanups.set(socket.id, {})

  // Subscribe to QR code events
  socket.on('whatsapp:subscribeQR', () => {
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.qr) {
      cleanups.qr()
    }

    cleanups.qr = whatsappService.onQRCode(userId, (qr: string) => {
      socket.emit('whatsapp:qr', qr)
    })
  })

  // Unsubscribe from QR code events
  socket.on('whatsapp:unsubscribeQR', () => {
    const cleanups = socketCleanups.get(socket.id)
    if (cleanups?.qr) {
      cleanups.qr()
      cleanups.qr = undefined
    }
  })

  // Subscribe to connection change events
  socket.on('whatsapp:subscribeConnection', () => {
    const cleanups = socketCleanups.get(socket.id)!

    // Clean up existing subscription
    if (cleanups.connection) {
      cleanups.connection()
    }

    cleanups.connection = whatsappService.onConnectionChange(userId, (connected: boolean, phoneNumber?: string | null) => {
      socket.emit('whatsapp:connection', { connected, phoneNumber })
    })
  })

  // Unsubscribe from connection change events
  socket.on('whatsapp:unsubscribeConnection', () => {
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
      if (cleanups.qr) cleanups.qr()
      if (cleanups.connection) cleanups.connection()
      socketCleanups.delete(socket.id)
    }
  })
}
