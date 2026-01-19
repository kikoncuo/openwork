/**
 * WhatsApp IPC handlers for main process
 * Exposes WhatsApp functionality to the renderer process
 */

import { IpcMain, BrowserWindow } from 'electron'
import { whatsappService } from '../apps/whatsapp'
import { getWhatsAppToolInfo, type WhatsAppToolInfo } from '../apps/whatsapp/tools'
import type { ConnectionStatus, ContactInfo, ChatInfo, MessageInfo, SendMessageResult } from '../apps/whatsapp'

export function registerWhatsAppHandlers(ipcMain: IpcMain): void {
  // ============= CONNECTION MANAGEMENT =============

  /**
   * Connect to WhatsApp
   * Returns QR code data URL if needed, null if already connected
   * Throws error if connection fails
   */
  ipcMain.handle('whatsapp:connect', async (): Promise<string | null> => {
    try {
      return await whatsappService.connect()
    } catch (error) {
      console.error('[WhatsApp IPC] Connection error:', error)
      const message = error instanceof Error ? error.message : 'Failed to connect to WhatsApp'
      throw new Error(message)
    }
  })

  /**
   * Disconnect and logout from WhatsApp
   */
  ipcMain.handle('whatsapp:disconnect', async (): Promise<void> => {
    await whatsappService.disconnect()
  })

  /**
   * Get current connection status
   */
  ipcMain.handle('whatsapp:getStatus', (): ConnectionStatus => {
    return whatsappService.getConnectionStatus()
  })

  /**
   * Check if WhatsApp is connected
   */
  ipcMain.handle('whatsapp:isConnected', (): boolean => {
    return whatsappService.isConnected()
  })

  // ============= DATA ACCESS =============

  /**
   * Get contacts list with optional search query
   */
  ipcMain.handle('whatsapp:getContacts', (_event, query?: string): ContactInfo[] => {
    return whatsappService.getContacts(query)
  })

  /**
   * Get recent chats
   */
  ipcMain.handle('whatsapp:getChats', (_event, limit?: number): ChatInfo[] => {
    return whatsappService.getChats(limit)
  })

  /**
   * Search messages by query
   */
  ipcMain.handle(
    'whatsapp:searchMessages',
    (_event, query: string, chatJid?: string, limit?: number): MessageInfo[] => {
      return whatsappService.searchMessages(query, chatJid, limit)
    }
  )

  /**
   * Get message history for a specific chat
   */
  ipcMain.handle(
    'whatsapp:getHistory',
    (_event, chatJid: string, limit?: number): MessageInfo[] => {
      return whatsappService.getMessageHistory(chatJid, limit)
    }
  )

  // ============= ACTIONS =============

  /**
   * Send a text message
   */
  ipcMain.handle(
    'whatsapp:sendMessage',
    async (_event, to: string, text: string): Promise<SendMessageResult> => {
      return whatsappService.sendMessage(to, text)
    }
  )

  // ============= EVENT SUBSCRIPTIONS =============
  // These set up listeners that forward events to the renderer

  // Track active subscriptions for cleanup
  let qrCleanup: (() => void) | null = null
  let connectionCleanup: (() => void) | null = null

  /**
   * Subscribe to QR code events
   * The renderer will receive 'whatsapp:qrCode' events
   */
  ipcMain.handle('whatsapp:subscribeQR', (_event): void => {
    // Clean up existing subscription
    if (qrCleanup) {
      qrCleanup()
    }

    qrCleanup = whatsappService.onQRCode((qr: string) => {
      // Send to all renderer windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('whatsapp:qrCode', qr)
      })
    })
  })

  /**
   * Unsubscribe from QR code events
   */
  ipcMain.handle('whatsapp:unsubscribeQR', (): void => {
    if (qrCleanup) {
      qrCleanup()
      qrCleanup = null
    }
  })

  /**
   * Subscribe to connection change events
   * The renderer will receive 'whatsapp:connectionChange' events
   */
  ipcMain.handle('whatsapp:subscribeConnection', (_event): void => {
    // Clean up existing subscription
    if (connectionCleanup) {
      connectionCleanup()
    }

    connectionCleanup = whatsappService.onConnectionChange((connected: boolean, phoneNumber?: string | null) => {
      // Send to all renderer windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('whatsapp:connectionChange', { connected, phoneNumber })
      })
    })
  })

  /**
   * Unsubscribe from connection change events
   */
  ipcMain.handle('whatsapp:unsubscribeConnection', (): void => {
    if (connectionCleanup) {
      connectionCleanup()
      connectionCleanup = null
    }
  })

  // ============= TOOLS INFO =============

  /**
   * Get WhatsApp tool info for the UI
   * Returns tool metadata that can be displayed in the Tools tab
   */
  ipcMain.handle('whatsapp:getTools', (): WhatsAppToolInfo[] => {
    return getWhatsAppToolInfo()
  })
}
