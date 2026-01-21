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
import { getAuthStore, SQLiteAuthState } from './auth-store.js'
import { getMessageStore } from './message-store.js'
import type { ContactInfo, ChatInfo, MessageInfo, ConnectionStatus, SendMessageResult } from './types.js'

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
  private sessions = new Map<string, WhatsAppSession>()
  private qrCallbacks = new Map<string, Set<QRCallback>>()
  private connectionCallbacks = new Map<string, Set<ConnectionCallback>>()
  private reconnectTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<string, number>()
  private maxReconnectAttempts = 5
  // We track userInitiated state per session inside the session object or a map?
  // Let's add it to connectionCallbacks map or just a separate map.
  // Actually, let's look at WhatsAppSession interface. It already has some state.
  // Let's add isUserInitiated to WhatsAppSession or track it separately.
  // The original code had `isUserInitiated` as a class property.
  private userInitiatedStates = new Map<string, boolean>()

  private getOrCreateSession(userId: string): WhatsAppSession {
    let session = this.sessions.get(userId)
    if (!session) {
      session = {
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
      this.sessions.set(userId, session)
    }
    return session
  }

  private getSession(userId: string): WhatsAppSession | undefined {
    return this.sessions.get(userId)
  }

  private setReconnectTimeout(userId: string, timeout: ReturnType<typeof setTimeout>) {
    if (this.reconnectTimeouts.has(userId)) {
      clearTimeout(this.reconnectTimeouts.get(userId)!)
    }
    this.reconnectTimeouts.set(userId, timeout)
  }

  private clearReconnectTimeout(userId: string) {
    if (this.reconnectTimeouts.has(userId)) {
      clearTimeout(this.reconnectTimeouts.get(userId)!)
      this.reconnectTimeouts.delete(userId)
    }
  }

  private getReconnectAttempts(userId: string): number {
    return this.reconnectAttempts.get(userId) || 0
  }

  private setReconnectAttempts(userId: string, attempts: number) {
    this.reconnectAttempts.set(userId, attempts)
  }

  private incrementReconnectAttempts(userId: string): number {
    const attempts = this.getReconnectAttempts(userId) + 1
    this.reconnectAttempts.set(userId, attempts)
    return attempts
  }

  private isUserInitiated(userId: string): boolean {
    return this.userInitiatedStates.get(userId) || false
  }

  private setUserInitiated(userId: string, value: boolean) {
    this.userInitiatedStates.set(userId, value)
  }

  /**
   * Connect to WhatsApp
   * @param userId - The user ID to connect for
   * @param isReconnect - Whether this is an automatic reconnection attempt
   * @param isAutoConnect - Whether this is an automatic connection on startup (not user-initiated)
   * @returns QR code data URL if needed, null if already connected
   */
  async connect(userId: string, isReconnect = false, isAutoConnect = false): Promise<string | null> {
    const session = this.getOrCreateSession(userId)

    if (session.socket && session.connectionState === 'open') {
      console.log(`[WhatsApp] User ${userId} already connected`)
      return null
    }

    // Prevent duplicate connection attempts
    if (session.connectionState === 'connecting') {
      console.log(`[WhatsApp] User ${userId} connection already in progress`)
      return session.qrCode
    }

    // If this is a user-initiated connection (not reconnect, not auto), reset reconnect attempts
    if (!isReconnect && !isAutoConnect) {
      this.setUserInitiated(userId, true)
      this.setReconnectAttempts(userId, 0)
    }

    // Mark as connecting to prevent duplicate attempts
    session.connectionState = 'connecting'

    return new Promise(async (resolve) => {
      try {
        let authState: SQLiteAuthState

        if (isReconnect && session.authState) {
          console.log(`[WhatsApp] Reconnecting user ${userId} (attempt ${this.getReconnectAttempts(userId) + 1}/${this.maxReconnectAttempts})`)
          authState = session.authState
        } else {
          const authStore = getAuthStore()
          authState = await authStore.getAuthState(userId)
          session.authState = authState
        }

        const { version } = await fetchLatestBaileysVersion()
        console.log(`[WhatsApp] User ${userId} using version ${version.join('.')}`)

        const sock = makeWASocket({
          version,
          auth: {
            creds: authState.creds,
            // Cast to any to handle Baileys type mismatches
            keys: makeCacheableSignalKeyStore(authState.keys as any, baileysLogger as any),
          },
          printQRInTerminal: false,
          logger: baileysLogger.child({ userId }) as any,
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
            console.log(`[WhatsApp] User ${userId} QR code received`)
            const qrDataUrl = await QRCode.toDataURL(qr)
            session.qrCode = qrDataUrl
            session.connectionState = 'connecting'

            // Notify all QR callbacks for this user
            const callbacks = this.qrCallbacks.get(userId)
            if (callbacks) {
              for (const callback of callbacks) {
                callback(qrDataUrl)
              }
            }

            resolve(qrDataUrl)
          }

          if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            const loggedOut = statusCode === DisconnectReason.loggedOut
            const restartRequired = statusCode === DisconnectReason.restartRequired
            const connectionLost = statusCode === DisconnectReason.connectionLost
            const connectionClosed = statusCode === DisconnectReason.connectionClosed

            const reconnectAttempts = this.getReconnectAttempts(userId)
            // Only auto-reconnect for specific disconnect reasons and if under attempt limit
            const canReconnect = !loggedOut &&
              this.isUserInitiated(userId) &&
              reconnectAttempts < this.maxReconnectAttempts &&
              (restartRequired || connectionLost || connectionClosed)

            console.log(`[WhatsApp] User ${userId} connection closed, statusCode: ${statusCode}, canReconnect: ${canReconnect}, attempts: ${reconnectAttempts}/${this.maxReconnectAttempts}`)

            session.connectionState = 'close'
            session.qrCode = null

            if (loggedOut) {
              const authStore = getAuthStore()
              await authStore.deleteAuthState(userId)
              session.phoneNumber = null
              session.connectedAt = null
              this.setUserInitiated(userId, false)
              this.setReconnectAttempts(userId, 0)
              // Resolve promise so the REST endpoint doesn't hang
              resolve(null)
            }

            // Notify connection callbacks
            const callbacks = this.connectionCallbacks.get(userId)
            if (callbacks) {
              for (const callback of callbacks) {
                callback(false)
              }
            }

            if (canReconnect) {
              const attempts = this.incrementReconnectAttempts(userId)
              // Exponential backoff: 3s, 6s, 12s, 24s, 48s
              const delay = 3000 * Math.pow(2, attempts - 1)
              console.log(`[WhatsApp] User ${userId} will attempt reconnect in ${delay}ms`)
              const timeout = setTimeout(() => this.connect(userId, true), delay)
              this.setReconnectTimeout(userId, timeout)
            } else if (!loggedOut && reconnectAttempts >= this.maxReconnectAttempts) {
              console.log(`[WhatsApp] User ${userId} max reconnect attempts reached, giving up`)
              this.setUserInitiated(userId, false)
              this.setReconnectAttempts(userId, 0)
              // Resolve promise so the REST endpoint doesn't hang
              resolve(null)
            } else if (!canReconnect && !loggedOut) {
              // Connection failed and won't reconnect - resolve to prevent hang
              resolve(null)
            }
          } else if (connection === 'open') {
            console.log(`[WhatsApp] User ${userId} connected`)
            session.connectionState = 'open'
            session.qrCode = null
            // Reset reconnect attempts on successful connection
            this.setReconnectAttempts(userId, 0)
            session.connectedAt = new Date()
            session.phoneNumber = sock.user?.id?.split(':')[0] || null

            // Notify connection callbacks
            const callbacks = this.connectionCallbacks.get(userId)
            if (callbacks) {
              for (const callback of callbacks) {
                callback(true, session.phoneNumber)
              }
            }

            resolve(null)
          }
        })

        // Handle contacts
        sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
          console.log(`[WhatsApp] User ${userId} received ${contacts.length} contacts`)
          for (const contact of contacts) {
            session.store.contacts[contact.id] = contact
          }
          this.persistContacts(userId)
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
          console.log(`[WhatsApp] User ${userId} received ${chats.length} chats`)
          for (const chat of chats) {
            const existingIndex = session.store.chats.findIndex((c: Chat) => c.id === chat.id)
            if (existingIndex >= 0) {
              session.store.chats[existingIndex] = chat
            } else {
              session.store.chats.push(chat)
            }
          }
          this.persistChats(userId)
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
          console.log(`[WhatsApp] User ${userId} history sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${messages?.length || 0} messages`)

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
                messageStore.saveMessage(this.formatMessage(msg), userId)
              }
            }
          }

          if (isLatest) {
            session.historySyncComplete = true
            console.log(`[WhatsApp] User ${userId} history sync complete`)
            this.persistContacts(userId)
            this.persistChats(userId)
          }
        })

        // Handle new messages
        sock.ev.on('messages.upsert', async ({ messages }: any) => {
          const messageStore = getMessageStore()
          for (const msg of messages) {
            if (msg.key?.id) {
              const formattedMessage = this.formatMessage(msg)
              messageStore.saveMessage(formattedMessage, userId)
              this.extractChatAndContactFromMessage(session, msg)

              // Trigger agent if configured and not fromMe
              if (!formattedMessage.fromMe) {
                this.triggerAgentIfConfigured(userId, formattedMessage)
              }
            }
          }
          session.lastActivity = new Date()
          // Persist chats to database so they survive server restarts
          this.persistChats(userId)
        })

      } catch (error) {
        console.error(`[WhatsApp] User ${userId} error connecting:`, error)
        // Reset connection state on error
        session.connectionState = 'close'
        // Reject so the error propagates to the caller
        throw error
      }
    })
  }

  /**
   * Disconnect from WhatsApp and clear all auth state
   * @param userId - The user ID to disconnect
   */
  async disconnect(userId: string): Promise<void> {
    const session = this.getSession(userId)

    // Clear reconnect timeout if exists
    this.clearReconnectTimeout(userId)
    this.setUserInitiated(userId, false)
    this.setReconnectAttempts(userId, 0)

    if (session?.socket) {
      console.log(`[WhatsApp] User ${userId} disconnecting and clearing auth...`)
      session.socket.end(undefined)
      session.socket = null
      session.connectionState = 'close'
      session.qrCode = null
      session.connectedAt = null
      session.phoneNumber = null
      session.authState = null
      // Clear in-memory store
      session.store = { contacts: {}, chats: [] }
    }

    // Delete stored auth credentials so next connect shows QR code
    const authStore = getAuthStore()
    await authStore.deleteAuthState(userId)
    console.log(`[WhatsApp] User ${userId} auth state cleared`)
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(userId: string): ConnectionStatus {
    const session = this.getSession(userId)
    return {
      connected: session?.connectionState === 'open',
      connecting: session?.connectionState === 'connecting',
      qrCode: session?.qrCode || null,
      phoneNumber: session?.phoneNumber || null,
      connectedAt: session?.connectedAt || null,
    }
  }

  /**
   * Check if connected
   */
  isConnected(userId: string): boolean {
    const session = this.getSession(userId)
    return session?.connectionState === 'open'
  }

  /**
   * Auto-reconnect if we have stored credentials
   */
  async autoReconnectIfNeeded(userId: string): Promise<boolean> {
    const session = this.getSession(userId)

    if (session?.connectionState === 'open') {
      return true
    }

    if (session?.connectionState === 'connecting') {
      console.log(`[WhatsApp] User ${userId} Auto-reconnect: connection already in progress`)
      return false
    }

    const authStore = getAuthStore()
    const hasStoredCreds = await authStore.hasAuthState(userId)

    if (!hasStoredCreds) {
      return false
    }

    console.log(`[WhatsApp] User ${userId} Auto-reconnecting with stored credentials`)
    // Pass isAutoConnect=true so it doesn't set isUserInitiated
    await this.connect(userId, true)

    // Wait for connection
    const maxWait = 10000
    const interval = 500
    let waited = 0

    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval))
      waited += interval

      // Re-fetch session state after async wait (connectionState may have changed)
      const currentSession = this.getSession(userId)
      if (currentSession?.connectionState === 'open') {
        console.log(`[WhatsApp] User ${userId} Auto-reconnect successful`)
        return true
      }
      if (currentSession?.qrCode) {
        console.log(`[WhatsApp] User ${userId} Auto-reconnect requires new QR code`)
        return false
      }
    }

    console.warn(`[WhatsApp] User ${userId} Auto-reconnect timeout`)
    return false
  }

  /**
   * Send a text message
   */
  async sendMessage(userId: string, to: string, text: string): Promise<SendMessageResult> {
    const session = this.getOrCreateSession(userId)

    if (!session.socket) {
      throw new Error('Not connected to WhatsApp')
    }

    try {
      // Ensure JID is formatted correctly
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`

      const sent = await session.socket.sendMessage(jid, { text })
      console.log(`[WhatsApp] User ${userId} sent message to ${jid}`)
      session.lastActivity = new Date()

      // Save to store
      if (sent?.key?.id) {
        const messageStore = getMessageStore()
        messageStore.saveMessage({
          id: sent.key.id,
          to: sent.key.remoteJid || to,
          from: session.phoneNumber ? `${session.phoneNumber}@s.whatsapp.net` : (session.socket.user?.id || ''),
          fromMe: true,
          timestamp: Math.floor(Date.now() / 1000),
          type: 'text',
          content: text,
          isGroup: jid.endsWith('@g.us'),
        }, userId)
      }

      return { success: true, messageId: sent?.key?.id || undefined }
    } catch (error) {
      console.error(`[WhatsApp] User ${userId} error sending message:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // ============= DATA ACCESS =============

  getContacts(userId: string, query?: string): ContactInfo[] {
    const messageStore = getMessageStore()
    return messageStore.getContacts(userId, query)
  }

  getChats(userId: string, limit = 50): ChatInfo[] {
    // First try database
    const messageStore = getMessageStore()
    const dbChats = messageStore.getChats(userId, limit)

    console.log(`[WhatsApp] getChats for user ${userId}: DB has ${dbChats.length} chats`)

    if (dbChats.length > 0) {
      return dbChats
    }

    // Fallback to in-memory session store
    const session = this.getSession(userId)
    console.log(`[WhatsApp] getChats: session exists=${!!session}, chats in memory=${session?.store?.chats?.length || 0}`)

    if (!session?.store?.chats || session.store.chats.length === 0) {
      return []
    }

    const storeContacts = session.store.contacts || {}
    // Also get contacts from database for name lookup
    const dbContacts = messageStore.getContacts(userId)
    const dbContactMap = new Map(dbContacts.map(c => [c.jid, c]))

    const sortedChats = [...session.store.chats]
      .sort((a: any, b: any) => {
        const aTime = this.toNumber(a.conversationTimestamp) || 0
        const bTime = this.toNumber(b.conversationTimestamp) || 0
        return bTime - aTime
      })
      .slice(0, limit)

    return sortedChats.map((chat: any) => {
      // Look up name: 1) in-memory contacts, 2) database contacts, 3) chat.name, 4) JID
      let name: string | undefined

      // Try in-memory contacts first
      const memContact = storeContacts[chat.id]
      if (memContact) {
        name = memContact.name || memContact.notify
      }

      // Try database contacts
      if (!name) {
        const dbContact = dbContactMap.get(chat.id)
        if (dbContact) {
          name = dbContact.name || dbContact.pushName
        }
      }

      // Fallback to chat.name or JID
      name = name || chat.name || chat.id.split('@')[0]

      return {
        jid: chat.id,
        name,
        isGroup: chat.id.endsWith('@g.us'),
        lastMessageTime: this.toNumber(chat.conversationTimestamp),
        unreadCount: chat.unreadCount || 0,
      }
    })
  }

  searchMessages(userId: string, query: string, chatJid?: string, limit?: number): MessageInfo[] {
    const messageStore = getMessageStore()
    return messageStore.searchMessages(query, userId, chatJid, limit)
  }

  getMessageHistory(userId: string, chatJid: string, limit?: number): MessageInfo[] {
    const messageStore = getMessageStore()
    return messageStore.getMessages(chatJid, userId, limit)
  }

  // ============= EVENT SUBSCRIPTION =============

  onQRCode(userId: string, callback: QRCallback): () => void {
    if (!this.qrCallbacks.has(userId)) {
      this.qrCallbacks.set(userId, new Set())
    }
    this.qrCallbacks.get(userId)!.add(callback)

    // If there's an existing QR code, send it immediately
    const session = this.getSession(userId)
    if (session?.qrCode) {
      callback(session.qrCode)
    }

    return () => {
      const callbacks = this.qrCallbacks.get(userId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.qrCallbacks.delete(userId)
        }
      }
    }
  }

  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    if (!this.connectionCallbacks.has(userId)) {
      this.connectionCallbacks.set(userId, new Set())
    }
    this.connectionCallbacks.get(userId)!.add(callback)

    // Send current status immediately
    const session = this.getSession(userId)
    if (session) {
      callback(session.connectionState === 'open', session.phoneNumber)
    } else {
      callback(false)
    }

    return () => {
      const callbacks = this.connectionCallbacks.get(userId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.connectionCallbacks.delete(userId)
        }
      }
    }
  }

  // ============= HELPERS =============

  private persistContacts(userId: string) {
    const session = this.getSession(userId)
    if (!session) return

    const messageStore = getMessageStore()
    Object.values(session.store.contacts).forEach(contact => {
      messageStore.saveContact({
        jid: contact.id,
        name: contact.name || contact.notify || '',
        pushName: contact.notify || null,
        phoneNumber: contact.id.split('@')[0],
        isGroup: contact.id.endsWith('@g.us'),
      }, userId)
    })
  }

  private persistChats(userId: string) {
    const session = this.getSession(userId)
    if (!session) return

    const chatCount = session.store.chats?.length || 0
    console.log(`[WhatsApp] persistChats called for user ${userId}: ${chatCount} chats to persist`)

    if (chatCount === 0) return

    const messageStore = getMessageStore()
    const storeContacts = session.store.contacts || {}

    let savedCount = 0
    session.store.chats.forEach((chat: Chat) => {
      try {
        // Look up name from contacts store (works for both contacts and groups)
        let name: string | undefined
        const contact = storeContacts[chat.id]
        if (contact) {
          name = contact.name || contact.notify
        }
        // Fallback to chat.name, then empty string
        name = name || chat.name || ''

        messageStore.saveChat({
          jid: chat.id,
          name,
          isGroup: chat.id.endsWith('@g.us'),
          lastMessageTime: this.toNumber(chat.conversationTimestamp),
          unreadCount: chat.unreadCount || 0,
        }, userId)
        savedCount++
      } catch (err) {
        console.error(`[WhatsApp] Error saving chat ${chat.id}:`, err)
      }
    })
    console.log(`[WhatsApp] persistChats: saved ${savedCount}/${chatCount} chats`)
  }

  // Convert Long/BigInt/number to regular number (for SQLite compatibility)
  private toNumber(value: any): number | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'number') return value
    if (typeof value === 'bigint') return Number(value)
    // Handle Long objects from protobuf
    if (typeof value === 'object' && 'low' in value) return value.low
    if (typeof value === 'object' && 'toNumber' in value) return value.toNumber()
    return undefined
  }

  private formatJid(jid: string): string {
    return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`
  }

  private formatMessage(msg: any): MessageInfo {
    const content = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      'Media Message'

    return {
      id: msg.key.id,
      to: msg.key.remoteJid,
      from: msg.key.participant || msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      timestamp: this.toNumber(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
      type: (Object.keys(msg.message || {})[0] || 'other') as MessageInfo['type'],
      content,
      isGroup: msg.key.remoteJid?.endsWith('@g.us') || false,
    }
  }

  private extractChatAndContactFromMessage(session: WhatsAppSession, msg: any) {
    if (!msg.key.remoteJid) return

    const isGroup = msg.key.remoteJid.endsWith('@g.us')
    const senderJid = msg.key.participant || msg.key.remoteJid

    // Update contacts
    if (senderJid && msg.pushName && !session.store.contacts[senderJid]) {
      session.store.contacts[senderJid] = {
        id: senderJid,
        name: msg.pushName
      }
    }

    // Update chat
    const chatIndex = session.store.chats.findIndex((c: Chat) => c.id === msg.key.remoteJid)
    if (chatIndex >= 0) {
      session.store.chats[chatIndex].conversationTimestamp = msg.messageTimestamp
      session.store.chats[chatIndex].unreadCount = (session.store.chats[chatIndex].unreadCount || 0) + 1
    } else {
      session.store.chats.push({
        id: msg.key.remoteJid,
        conversationTimestamp: msg.messageTimestamp,
        unreadCount: 1
      })
    }
  }

  /**
   * Trigger agent handler if auto-agent is configured for this user.
   * Runs asynchronously in the background.
   */
  private async triggerAgentIfConfigured(userId: string, message: MessageInfo): Promise<void> {
    // Import dynamically to avoid circular dependencies
    try {
      const { handleIncomingMessage, isAutoAgentEnabled } = await import('./agent-handler.js')

      // Check if auto-agent is enabled before processing
      if (!isAutoAgentEnabled(userId)) {
        return
      }

      // Handle message asynchronously (don't await to not block message processing)
      handleIncomingMessage(userId, message).catch(error => {
        console.error(`[WhatsApp] Error triggering agent for user ${userId}:`, error)
      })
    } catch (error) {
      console.error('[WhatsApp] Error loading agent handler:', error)
    }
  }

  /**
   * Auto-reconnect all users with stored credentials
   * Called on server startup
   */
  async autoReconnectAll(): Promise<void> {
    const authStore = getAuthStore()
    const userIds = await authStore.getAllUserIds()

    console.log(`[WhatsApp] Auto-reconnecting ${userIds.length} users...`)

    for (const userId of userIds) {
      // connecting each sequentially to avoid flooding
      try {
        await this.connect(userId, false, true)
        // small delay between connections
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (e) {
        console.error(`[WhatsApp] Failed to auto-reconnect user ${userId}:`, e)
      }
    }
  }

  /**
   * Cleanup on server shutdown
   */
  async shutdown(): Promise<void> {
    // Iterate over all sessions and disconnect them
    for (const userId of this.sessions.keys()) {
      await this.disconnect(userId)
    }

    this.qrCallbacks.clear()
    this.connectionCallbacks.clear()

    // Clear all timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.reconnectTimeouts.clear()
    this.sessions.clear()
  }
}

// Singleton instance
export const socketManager = new WhatsAppSocketManager()
