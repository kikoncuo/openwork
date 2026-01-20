/**
 * WhatsApp Socket Manager - Manages the Baileys WebSocket connection
 * Adapted from whatsapp-rest/socket-manager.ts for local Electron app (single user)
 */

import {
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from 'baileys'
import type { WASocket, WAMessage, WAMessageKey, Chat, Contact } from 'baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import { getAuthStore, SQLiteAuthState } from './auth-store'
import { getMessageStore } from './message-store'
import type { ContactInfo, ChatInfo, MessageInfo } from './types'

// Create a pino-compatible logger that wraps console
// Baileys expects logger.child() which returns a new logger with extra context
function createLogger(prefix = '[WhatsApp]') {
  const logger = {
    level: 'info',
    info: (...args: unknown[]) => console.log(prefix, ...args),
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    trace: (...args: unknown[]) => console.debug(prefix, '[trace]', ...args),
    fatal: (...args: unknown[]) => console.error(prefix, '[fatal]', ...args),
    child: (bindings: Record<string, unknown>) => {
      const childPrefix = `${prefix}[${Object.values(bindings).join(':')}]`
      return createLogger(childPrefix)
    },
  }
  return logger
}

const baileysLogger = createLogger('[Baileys]')

interface SimpleStore {
  contacts: Record<string, Contact>
  chats: Chat[]
}

interface WhatsAppSession {
  socket: WASocket | null
  connectionState: 'open' | 'connecting' | 'close'
  qrCode: string | null
  phoneNumber: string | null
  connectedAt: Date | null
  lastActivity: Date
  authState: SQLiteAuthState | null
  store: SimpleStore
  historySyncComplete: boolean
}

type QRCallback = (qr: string) => void
type ConnectionCallback = (connected: boolean, phoneNumber?: string | null) => void

class WhatsAppSocketManager {
  private session: WhatsAppSession | null = null
  private qrCallbacks: Set<QRCallback> = new Set()
  private connectionCallbacks: Set<ConnectionCallback> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private isUserInitiated = false  // Track if connection was user-initiated

  private getOrCreateSession(): WhatsAppSession {
    if (!this.session) {
      this.session = {
        socket: null,
        connectionState: 'close',
        qrCode: null,
        phoneNumber: null,
        connectedAt: null,
        lastActivity: new Date(),
        authState: null,
        store: { contacts: {}, chats: [] },
        historySyncComplete: false,
      }
    }
    return this.session
  }

  /**
   * Connect to WhatsApp
   * @param isReconnect - Whether this is an automatic reconnection attempt
   * @param isAutoConnect - Whether this is an automatic connection on startup (not user-initiated)
   * @returns QR code data URL if needed, null if already connected
   */
  async connect(isReconnect = false, isAutoConnect = false): Promise<string | null> {
    const session = this.getOrCreateSession()

    if (session.socket && session.connectionState === 'open') {
      console.log('[WhatsApp] Already connected')
      return null
    }

    // Prevent duplicate connection attempts
    if (session.connectionState === 'connecting') {
      console.log('[WhatsApp] Connection already in progress')
      return session.qrCode
    }

    // If this is a user-initiated connection (not reconnect, not auto), reset reconnect attempts
    if (!isReconnect && !isAutoConnect) {
      this.isUserInitiated = true
      this.reconnectAttempts = 0
    }

    // Mark as connecting to prevent duplicate attempts
    session.connectionState = 'connecting'

    return new Promise(async (resolve) => {
      try {
        let authState: SQLiteAuthState

        if (isReconnect && session.authState) {
          console.log(`[WhatsApp] Reconnecting (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`)
          authState = session.authState
        } else {
          const authStore = getAuthStore()
          authState = await authStore.getAuthState()
          session.authState = authState
        }

        const { version } = await fetchLatestBaileysVersion()
        console.log(`[WhatsApp] Using version ${version.join('.')}`)

        const sock = makeWASocket({
          version,
          auth: {
            creds: authState.creds,
            keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger as any),
          },
          printQRInTerminal: false,
          logger: baileysLogger as any,
          generateHighQualityLinkPreview: true,
          syncFullHistory: true,
          shouldSyncHistoryMessage: () => true,
          markOnlineOnConnect: true,
          fireInitQueries: true,
          getMessage: async (key: WAMessageKey) => {
            // Return cached message if available
            return undefined
          },
        })

        session.socket = sock

        // Save credentials on update
        sock.ev.on('creds.update', async () => {
          await authState.saveCreds()
        })

        // Handle connection updates
        sock.ev.on('connection.update', async (update: any) => {
          const { connection, lastDisconnect, qr } = update

          if (qr) {
            console.log('[WhatsApp] QR code received')
            const qrDataUrl = await QRCode.toDataURL(qr)
            session.qrCode = qrDataUrl
            session.connectionState = 'connecting'

            // Notify all QR callbacks
            for (const callback of this.qrCallbacks) {
              callback(qrDataUrl)
            }

            resolve(qrDataUrl)
          }

          if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            const loggedOut = statusCode === DisconnectReason.loggedOut
            const restartRequired = statusCode === DisconnectReason.restartRequired
            const connectionLost = statusCode === DisconnectReason.connectionLost
            const connectionClosed = statusCode === DisconnectReason.connectionClosed

            // Only auto-reconnect for specific disconnect reasons and if under attempt limit
            const canReconnect = !loggedOut &&
                                 this.isUserInitiated &&
                                 this.reconnectAttempts < this.maxReconnectAttempts &&
                                 (restartRequired || connectionLost || connectionClosed)

            console.log(`[WhatsApp] Connection closed, statusCode: ${statusCode}, canReconnect: ${canReconnect}, attempts: ${this.reconnectAttempts}/${this.maxReconnectAttempts}`)

            session.connectionState = 'close'
            session.qrCode = null

            if (loggedOut) {
              const authStore = getAuthStore()
              await authStore.deleteAuthState()
              session.phoneNumber = null
              session.connectedAt = null
              this.isUserInitiated = false
              this.reconnectAttempts = 0
            }

            // Notify connection callbacks
            for (const callback of this.connectionCallbacks) {
              callback(false)
            }

            if (canReconnect) {
              this.reconnectAttempts++
              // Exponential backoff: 3s, 6s, 12s, 24s, 48s
              const delay = 3000 * Math.pow(2, this.reconnectAttempts - 1)
              console.log(`[WhatsApp] Will attempt reconnect in ${delay}ms`)
              this.reconnectTimeout = setTimeout(() => this.connect(true), delay)
            } else if (!loggedOut && this.reconnectAttempts >= this.maxReconnectAttempts) {
              console.log('[WhatsApp] Max reconnect attempts reached, giving up')
              this.isUserInitiated = false
              this.reconnectAttempts = 0
            }
          } else if (connection === 'open') {
            console.log('[WhatsApp] Connected')
            session.connectionState = 'open'
            session.qrCode = null
            // Reset reconnect attempts on successful connection
            this.reconnectAttempts = 0
            session.connectedAt = new Date()
            session.phoneNumber = sock.user?.id?.split(':')[0] || null

            // Notify connection callbacks
            for (const callback of this.connectionCallbacks) {
              callback(true, session.phoneNumber)
            }

            resolve(null)
          }
        })

        // Handle contacts
        sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
          console.log(`[WhatsApp] Received ${contacts.length} contacts`)
          for (const contact of contacts) {
            session.store.contacts[contact.id] = contact
          }
          this.persistContacts()
        })

        sock.ev.on('contacts.update', (updates: Partial<Contact>[]) => {
          for (const update of updates) {
            if (update.id && session.store.contacts[update.id]) {
              Object.assign(session.store.contacts[update.id], update)
            }
          }
        })

        // Handle chats
        sock.ev.on('chats.upsert', (chats: Chat[]) => {
          console.log(`[WhatsApp] Received ${chats.length} chats`)
          for (const chat of chats) {
            const existingIndex = session.store.chats.findIndex((c: Chat) => c.id === chat.id)
            if (existingIndex >= 0) {
              session.store.chats[existingIndex] = chat
            } else {
              session.store.chats.push(chat)
            }
          }
          this.persistChats()
        })

        sock.ev.on('chats.update', (updates: Partial<Chat>[]) => {
          for (const update of updates) {
            const existingIndex = session.store.chats.findIndex((c: Chat) => c.id === update.id)
            if (existingIndex >= 0) {
              Object.assign(session.store.chats[existingIndex], update)
            }
          }
        })

        // Handle history sync
        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
          console.log(`[WhatsApp] History sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${messages?.length || 0} messages`)

          if (contacts) {
            for (const contact of contacts) {
              session.store.contacts[contact.id] = contact
            }
          }

          if (chats) {
            for (const chat of chats) {
              const existingIndex = session.store.chats.findIndex((c: Chat) => c.id === chat.id)
              if (existingIndex >= 0) {
                session.store.chats[existingIndex] = chat
              } else {
                session.store.chats.push(chat)
              }
            }
          }

          if (messages && messages.length > 0) {
            const messageStore = getMessageStore()
            for (const msg of messages) {
              if (msg.key?.id) {
                messageStore.saveMessage(this.formatMessage(msg))
              }
            }
          }

          if (isLatest) {
            session.historySyncComplete = true
            console.log('[WhatsApp] History sync complete')
            this.persistContacts()
            this.persistChats()
          }
        })

        // Handle new messages
        sock.ev.on('messages.upsert', async ({ messages }: any) => {
          const messageStore = getMessageStore()
          for (const msg of messages) {
            if (msg.key?.id) {
              messageStore.saveMessage(this.formatMessage(msg))
              this.extractChatAndContactFromMessage(session, msg)
            }
          }
          session.lastActivity = new Date()
        })

      } catch (error) {
        console.error('[WhatsApp] Error connecting:', error)
        // Reset connection state on error
        session.connectionState = 'close'
        // Reject so the error propagates to the caller
        throw error
      }
    })
  }

  /**
   * Disconnect and logout
   */
  async disconnect(): Promise<void> {
    // Stop any reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.isUserInitiated = false
    this.reconnectAttempts = 0

    if (!this.session?.socket) {
      return
    }

    try {
      await this.session.socket.logout()
    } catch (e) {
      console.warn('[WhatsApp] Error during logout:', e)
    }

    this.session.socket = null
    this.session.connectionState = 'close'
    this.session.qrCode = null
    this.session.phoneNumber = null
    this.session.connectedAt = null

    const authStore = getAuthStore()
    await authStore.deleteAuthState()

    console.log('[WhatsApp] Disconnected')
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.session?.connectionState === 'open'
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): {
    connected: boolean
    phoneNumber: string | null
    connectedAt: string | null
  } {
    return {
      connected: this.session?.connectionState === 'open',
      phoneNumber: this.session?.phoneNumber || null,
      connectedAt: this.session?.connectedAt?.toISOString() || null,
    }
  }

  /**
   * Auto-reconnect if we have stored credentials
   */
  async autoReconnectIfNeeded(): Promise<boolean> {
    if (this.session?.connectionState === 'open') {
      return true
    }

    if (this.session?.connectionState === 'connecting') {
      console.log('[WhatsApp] Auto-reconnect: connection already in progress')
      return false
    }

    const authStore = getAuthStore()
    const hasStoredCreds = await authStore.hasAuthState()

    if (!hasStoredCreds) {
      return false
    }

    console.log('[WhatsApp] Auto-reconnecting with stored credentials')
    // Pass isAutoConnect=true so it doesn't set isUserInitiated
    await this.connect(false, true)

    // Wait for connection
    const maxWait = 10000
    const interval = 500
    let waited = 0

    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval))
      waited += interval

      if (this.session?.connectionState === 'open') {
        console.log('[WhatsApp] Auto-reconnect successful')
        return true
      }
      if (this.session?.qrCode) {
        console.log('[WhatsApp] Auto-reconnect requires new QR code')
        return false
      }
    }

    console.warn('[WhatsApp] Auto-reconnect timeout')
    return false
  }

  /**
   * Send a text message
   */
  async sendTextMessage(to: string, text: string): Promise<{ messageId: string; timestamp: number } | null> {
    if (!this.session?.socket || this.session.connectionState !== 'open') {
      throw new Error('Not connected to WhatsApp')
    }

    const jid = this.formatJid(to)
    const result = await this.session.socket.sendMessage(jid, { text })
    this.session.lastActivity = new Date()

    if (result) {
      const messageStore = getMessageStore()
      messageStore.saveMessage(this.formatMessage(result))

      return {
        messageId: result.key.id || '',
        timestamp: Date.now(),
      }
    }

    return null
  }

  /**
   * Get contacts
   */
  getContacts(query?: string): ContactInfo[] {
    if (!this.session?.store) {
      return []
    }

    const contacts: ContactInfo[] = []
    const storeContacts = this.session.store.contacts || {}

    for (const [jid, contact] of Object.entries(storeContacts)) {
      if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) continue

      const c = contact as any
      const name = c.name || c.notify || jid.split('@')[0]
      const phoneNumber = jid.split('@')[0]

      // Filter by query if provided
      if (query) {
        const queryLower = query.toLowerCase()
        if (!name.toLowerCase().includes(queryLower) && !phoneNumber.includes(query)) {
          continue
        }
      }

      contacts.push({
        jid,
        name,
        pushName: c.notify || null,
        phoneNumber,
        isGroup: jid.endsWith('@g.us'),
      })
    }

    return contacts
  }

  /**
   * Get chats
   */
  getChats(limit = 50): ChatInfo[] {
    if (!this.session?.store) {
      return []
    }

    const chats: ChatInfo[] = []
    const storeChats = this.session.store.chats
    const storeContacts = this.session.store.contacts || {}

    if (storeChats && storeChats.length > 0) {
      const sortedChats = [...storeChats]
        .sort((a: any, b: any) => (b.conversationTimestamp || 0) - (a.conversationTimestamp || 0))
        .slice(0, limit)

      for (const chat of sortedChats) {
        // Look up name from contacts store (works for both contacts and groups)
        let name: string | undefined
        const contact = storeContacts[chat.id] as any
        if (contact) {
          name = contact.name || contact.notify
        }
        // Fallback to chat.name, then to JID extraction
        name = name || chat.name || chat.id.split('@')[0]

        chats.push({
          jid: chat.id,
          name,
          isGroup: chat.id.endsWith('@g.us'),
          lastMessageTime: chat.conversationTimestamp ? Number(chat.conversationTimestamp) * 1000 : undefined,
          unreadCount: chat.unreadCount || 0,
        })
      }
    }

    return chats
  }

  /**
   * Search messages
   */
  searchMessages(query: string, chatJid?: string, limit = 20): MessageInfo[] {
    const messageStore = getMessageStore()
    return messageStore.searchMessages(query, chatJid, limit)
  }

  /**
   * Get message history for a chat
   */
  getMessageHistory(chatJid: string, limit = 50): MessageInfo[] {
    const messageStore = getMessageStore()
    return messageStore.getMessages(chatJid, limit)
  }

  /**
   * Register QR code callback
   */
  onQRCode(callback: QRCallback): () => void {
    this.qrCallbacks.add(callback)
    return () => this.qrCallbacks.delete(callback)
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback)
    return () => this.connectionCallbacks.delete(callback)
  }

  /**
   * Cleanup
   */
  async shutdown(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.session?.socket) {
      try {
        this.session.socket.end(undefined)
      } catch (e) {
        // Ignore
      }
    }

    this.qrCallbacks.clear()
    this.connectionCallbacks.clear()
  }

  // Private helpers

  private formatMessage(msg: WAMessage): MessageInfo {
    const text = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption ||
                 msg.message?.videoMessage?.caption ||
                 ''

    let type: MessageInfo['type'] = 'text'
    if (msg.message?.imageMessage) type = 'image'
    else if (msg.message?.videoMessage) type = 'video'
    else if (msg.message?.audioMessage) type = 'audio'
    else if (msg.message?.documentMessage) type = 'document'
    else if (msg.message?.stickerMessage) type = 'sticker'
    else if (!msg.message?.conversation && !msg.message?.extendedTextMessage) type = 'other'

    return {
      id: msg.key.id || '',
      from: msg.key.participant || msg.key.remoteJid || '',
      to: msg.key.remoteJid || '',
      fromMe: msg.key.fromMe || false,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
      type,
      content: text,
      isGroup: msg.key.remoteJid?.endsWith('@g.us') || false,
      senderName: msg.pushName || undefined,
    }
  }

  private formatJid(phoneOrJid: string): string {
    if (phoneOrJid.includes('@')) {
      return phoneOrJid
    }
    const cleaned = phoneOrJid.replace(/[^0-9]/g, '')
    return `${cleaned}@s.whatsapp.net`
  }

  private extractChatAndContactFromMessage(session: WhatsAppSession, msg: WAMessage): void {
    if (!msg.key?.remoteJid) return

    const jid = msg.key.remoteJid
    if (jid === 'status@broadcast' || (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us'))) {
      return
    }

    // Update chat
    const existingChatIndex = session.store.chats.findIndex((c: Chat) => c.id === jid)
    const messageTimestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000)

    if (existingChatIndex >= 0) {
      const existingChat = session.store.chats[existingChatIndex]
      if (!existingChat.conversationTimestamp || messageTimestamp > Number(existingChat.conversationTimestamp)) {
        session.store.chats[existingChatIndex] = {
          ...existingChat,
          conversationTimestamp: messageTimestamp as any,
        }
      }
    } else {
      session.store.chats.push({
        id: jid,
        name: msg.pushName || jid.split('@')[0],
        conversationTimestamp: messageTimestamp as any,
        unreadCount: 0,
      } as Chat)
    }

    // Update contact
    const senderJid = msg.key.participant || (msg.key.fromMe ? undefined : jid)
    if (senderJid && msg.pushName && !session.store.contacts[senderJid]) {
      session.store.contacts[senderJid] = {
        id: senderJid,
        name: msg.pushName,
        notify: msg.pushName,
      } as Contact
    }
  }

  private persistContacts(): void {
    if (!this.session?.store) return

    const messageStore = getMessageStore()
    const contacts = this.getContacts()
    for (const contact of contacts) {
      messageStore.saveContact(contact)
    }
  }

  private persistChats(): void {
    if (!this.session?.store) return

    const messageStore = getMessageStore()
    const chats = this.getChats(100)
    for (const chat of chats) {
      messageStore.saveChat(chat)
    }
  }
}

// Singleton instance
export const socketManager = new WhatsAppSocketManager()
