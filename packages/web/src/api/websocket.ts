/**
 * WebSocket manager using Socket.IO
 */

import { io, Socket } from 'socket.io-client'
import { getAccessToken, useAuthStore } from '@/lib/auth-store'

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001'

class WebSocketManager {
  private socket: Socket | null = null

  connect(): void {
    if (this.socket?.connected) return

    // Get current access token for authentication
    const token = getAccessToken()

    this.socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
      auth: {
        token
      }
    })

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected:', this.socket?.id)
    })

    this.socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason)
    })

    this.socket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error.message)
      // If authentication error, clear auth state
      if (error.message.includes('Authentication') || error.message.includes('Invalid')) {
        useAuthStore.getState().logout()
      }
    })
  }

  /**
   * Reconnect with new token (call after login)
   */
  reconnect(): void {
    this.disconnect()
    this.connect()
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      console.warn('[WebSocket] Not connected, cannot emit:', event)
      return
    }
    this.socket.emit(event, data)
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    this.socket?.on(event, callback)
    return () => this.socket?.off(event, callback)
  }

  once(event: string, callback: (data: unknown) => void): void {
    this.socket?.once(event, callback)
  }

  off(event: string, callback?: (data: unknown) => void): void {
    if (callback) {
      this.socket?.off(event, callback)
    } else {
      this.socket?.off(event)
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false
  }
}

export const ws = new WebSocketManager()

// Note: Don't auto-connect here. Connection should happen after authentication.
// Call ws.connect() after login succeeds.
