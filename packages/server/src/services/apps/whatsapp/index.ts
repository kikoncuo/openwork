/**
 * WhatsApp Service - Main entry point for WhatsApp integration
 * Provides a high-level API for the agent tools and IPC handlers
 */

import { socketManager } from './socket-manager.js'
import { getMessageStore } from './message-store.js'
import { getAuthStore } from './auth-store.js'
import type { ContactInfo, ChatInfo, MessageInfo, ConnectionStatus, SendMessageResult } from './types.js'

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

    // Try to auto-reconnect all users
    await socketManager.autoReconnectAll()

    this.initialized = true
    console.log('[WhatsApp] Service initialized')
  }

  /**
   * Connect to WhatsApp
   * @returns QR code data URL if needed, null if already connected
   */
  async connect(userId: string): Promise<string | null> {
    await this.initialize()
    return socketManager.connect(userId)
  }

  /**
   * Disconnect and logout
   */
  async disconnect(userId: string): Promise<void> {
    await socketManager.disconnect(userId)
    // We don't clear all data on disconnect anymore as it affects other users
    // And actually we probably shouldn't clear data on disconnect anyway, only on "logout" or explicit clear.
    // getMessageStore().clearAllData(userId) // If we had clearUserData
  }

  /**
   * Check if connected
   */
  isConnected(userId: string): boolean {
    return socketManager.isConnected(userId)
  }

  /**
   * Get connection status
   */
  getConnectionStatus(userId: string): ConnectionStatus {
    return socketManager.getConnectionStatus(userId)
  }

  /**
   * Register QR code callback
   * @returns Cleanup function
   */
  onQRCode(userId: string, callback: QRCallback): () => void {
    return socketManager.onQRCode(userId, callback)
  }

  /**
   * Register connection change callback
   * @returns Cleanup function
   */
  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    return socketManager.onConnectionChange(userId, callback)
  }

  /**
   * Get contacts
   */
  getContacts(userId: string, query?: string): ContactInfo[] {
    // First try from socket manager (live data)
    let contacts = socketManager.getContacts(userId, query)

    // If no contacts from socket, fall back to database
    if (contacts.length === 0) {
      contacts = getMessageStore().getContacts(userId, query)
    }

    return contacts
  }

  /**
   * Get recent chats
   */
  getChats(userId: string, limit?: number): ChatInfo[] {
    // First try from socket manager (live data)
    let chats = socketManager.getChats(userId, limit)

    // If no chats from socket, fall back to database
    if (chats.length === 0) {
      chats = getMessageStore().getChats(userId, limit)
    }

    return chats
  }

  /**
   * Search messages
   */
  searchMessages(userId: string, query: string, chatJid?: string, limit?: number): MessageInfo[] {
    return socketManager.searchMessages(userId, query, chatJid, limit)
  }

  /**
   * Get message history for a chat
   */
  getMessageHistory(userId: string, chatJid: string, limit?: number): MessageInfo[] {
    return socketManager.getMessageHistory(userId, chatJid, limit)
  }

  /**
   * Send a text message
   */
  async sendMessage(userId: string, to: string, text: string): Promise<SendMessageResult> {
    if (!this.isConnected(userId)) {
      throw new Error('WhatsApp is not connected. Please connect in Settings > Apps.')
    }

    const result = await socketManager.sendMessage(userId, to, text)
    if (!result.success) {
      throw new Error(result.error || 'Failed to send message')
    }

    // result.messageId is string | undefined. We need to ensure we return SendMessageResult which has messageId: string.
    // If success is true, messageId should be present.
    if (!result.messageId) {
      throw new Error('Message sent but no ID returned')
    }

    return {
      success: true,
      messageId: result.messageId,
      timestamp: Math.floor(Date.now() / 1000)
    }
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
