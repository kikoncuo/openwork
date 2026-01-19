/**
 * WhatsApp Service - Main entry point for WhatsApp integration
 * Provides a high-level API for the agent tools and IPC handlers
 */

import { socketManager } from './socket-manager'
import { getMessageStore } from './message-store'
import { getAuthStore } from './auth-store'
import type { ContactInfo, ChatInfo, MessageInfo, ConnectionStatus, SendMessageResult } from './types'

export type { ContactInfo, ChatInfo, MessageInfo, ConnectionStatus, SendMessageResult }

type QRCallback = (qr: string) => void
type ConnectionCallback = (connected: boolean, phoneNumber?: string | null) => void

class WhatsAppService {
  private initialized = false

  /**
   * Initialize the WhatsApp service
   * Called lazily on first use
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[WhatsApp] Initializing service...')

    // Try to auto-reconnect if we have stored credentials
    const authStore = getAuthStore()
    if (await authStore.hasAuthState()) {
      console.log('[WhatsApp] Found stored credentials, attempting auto-reconnect...')
      await socketManager.autoReconnectIfNeeded()
    }

    this.initialized = true
    console.log('[WhatsApp] Service initialized')
  }

  /**
   * Connect to WhatsApp
   * @returns QR code data URL if needed, null if already connected
   */
  async connect(): Promise<string | null> {
    await this.initialize()
    return socketManager.connect()
  }

  /**
   * Disconnect and logout
   */
  async disconnect(): Promise<void> {
    await socketManager.disconnect()
    getMessageStore().clearAllData()
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return socketManager.isConnected()
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return socketManager.getConnectionStatus()
  }

  /**
   * Register QR code callback
   * @returns Cleanup function
   */
  onQRCode(callback: QRCallback): () => void {
    return socketManager.onQRCode(callback)
  }

  /**
   * Register connection change callback
   * @returns Cleanup function
   */
  onConnectionChange(callback: ConnectionCallback): () => void {
    return socketManager.onConnectionChange(callback)
  }

  /**
   * Get contacts
   */
  getContacts(query?: string): ContactInfo[] {
    // First try from socket manager (live data)
    let contacts = socketManager.getContacts(query)

    // If no contacts from socket, fall back to database
    if (contacts.length === 0) {
      contacts = getMessageStore().getContacts(query)
    }

    return contacts
  }

  /**
   * Get recent chats
   */
  getChats(limit?: number): ChatInfo[] {
    // First try from socket manager (live data)
    let chats = socketManager.getChats(limit)

    // If no chats from socket, fall back to database
    if (chats.length === 0) {
      chats = getMessageStore().getChats(limit)
    }

    return chats
  }

  /**
   * Search messages
   */
  searchMessages(query: string, chatJid?: string, limit?: number): MessageInfo[] {
    return socketManager.searchMessages(query, chatJid, limit)
  }

  /**
   * Get message history for a chat
   */
  getMessageHistory(chatJid: string, limit?: number): MessageInfo[] {
    return socketManager.getMessageHistory(chatJid, limit)
  }

  /**
   * Send a text message
   */
  async sendMessage(to: string, text: string): Promise<SendMessageResult> {
    if (!this.isConnected()) {
      throw new Error('WhatsApp is not connected. Please connect in Settings > Apps.')
    }

    const result = await socketManager.sendTextMessage(to, text)
    if (!result) {
      throw new Error('Failed to send message')
    }

    return result
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await socketManager.shutdown()
    this.initialized = false
    console.log('[WhatsApp] Service shutdown')
  }
}

// Singleton instance
export const whatsappService = new WhatsAppService()
