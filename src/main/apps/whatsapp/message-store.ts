/**
 * WhatsApp Message Store - SQLite-based storage for contacts, chats, and messages
 */

import { getDb, saveToDisk } from '../../db'
import type { ContactInfo, ChatInfo, MessageInfo } from './types'

class WhatsAppMessageStore {
  // Contact operations

  saveContact(contact: ContactInfo): void {
    const db = getDb()
    const now = Date.now()

    db.run(
      `INSERT OR REPLACE INTO whatsapp_contacts (jid, name, push_name, phone_number, is_group, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contact.jid, contact.name, contact.pushName, contact.phoneNumber, contact.isGroup ? 1 : 0, now]
    )
    saveToDisk()
  }

  getContacts(query?: string): ContactInfo[] {
    const db = getDb()
    let sql = 'SELECT * FROM whatsapp_contacts ORDER BY name ASC'
    const params: string[] = []

    if (query) {
      sql = `SELECT * FROM whatsapp_contacts
             WHERE name LIKE ? OR push_name LIKE ? OR phone_number LIKE ?
             ORDER BY name ASC`
      const pattern = `%${query}%`
      params.push(pattern, pattern, pattern)
    }

    const stmt = db.prepare(sql)
    if (params.length > 0) {
      stmt.bind(params)
    }

    const contacts: ContactInfo[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      contacts.push({
        jid: row.jid,
        name: row.name || row.jid.split('@')[0],
        pushName: row.push_name,
        phoneNumber: row.phone_number,
        isGroup: row.is_group === 1,
      })
    }
    stmt.free()

    return contacts
  }

  // Chat operations

  saveChat(chat: ChatInfo): void {
    const db = getDb()
    const now = Date.now()

    db.run(
      `INSERT OR REPLACE INTO whatsapp_chats (jid, name, is_group, last_message_time, unread_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [chat.jid, chat.name, chat.isGroup ? 1 : 0, chat.lastMessageTime || null, chat.unreadCount, now]
    )
    saveToDisk()
  }

  getChats(limit = 50): ChatInfo[] {
    const db = getDb()
    const stmt = db.prepare(
      `SELECT * FROM whatsapp_chats
       ORDER BY last_message_time DESC NULLS LAST
       LIMIT ?`
    )
    stmt.bind([limit])

    const chats: ChatInfo[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      chats.push({
        jid: row.jid,
        name: row.name || row.jid.split('@')[0],
        isGroup: row.is_group === 1,
        lastMessageTime: row.last_message_time || undefined,
        unreadCount: row.unread_count || 0,
      })
    }
    stmt.free()

    return chats
  }

  // Message operations

  saveMessage(message: MessageInfo): void {
    const db = getDb()
    const now = Date.now()

    db.run(
      `INSERT OR REPLACE INTO whatsapp_messages
       (message_id, chat_jid, from_jid, from_me, timestamp, message_type, content, raw_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.to,
        message.from,
        message.fromMe ? 1 : 0,
        message.timestamp,
        message.type,
        message.content,
        JSON.stringify(message),
        now,
      ]
    )
    saveToDisk()
  }

  getMessages(chatJid: string, limit = 50): MessageInfo[] {
    const db = getDb()
    const stmt = db.prepare(
      `SELECT * FROM whatsapp_messages
       WHERE chat_jid = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    stmt.bind([chatJid, limit])

    const messages: MessageInfo[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      messages.push(this.rowToMessageInfo(row))
    }
    stmt.free()

    // Return in chronological order (oldest first)
    return messages.reverse()
  }

  searchMessages(query: string, chatJid?: string, limit = 20): MessageInfo[] {
    const db = getDb()
    const queryLower = query.toLowerCase()

    let sql: string
    const params: (string | number)[] = []

    if (chatJid) {
      sql = `SELECT * FROM whatsapp_messages
             WHERE chat_jid = ? AND content LIKE ?
             ORDER BY timestamp DESC
             LIMIT ?`
      params.push(chatJid, `%${queryLower}%`, limit)
    } else {
      sql = `SELECT * FROM whatsapp_messages
             WHERE content LIKE ?
             ORDER BY timestamp DESC
             LIMIT ?`
      params.push(`%${queryLower}%`, limit)
    }

    const stmt = db.prepare(sql)
    stmt.bind(params)

    const messages: MessageInfo[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as any
      messages.push(this.rowToMessageInfo(row))
    }
    stmt.free()

    return messages
  }

  // App connection operations

  getAppConnection(appId: string): { enabled: boolean; connected: boolean; data: any } | null {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM app_connections WHERE app_id = ?')
    stmt.bind([appId])

    if (!stmt.step()) {
      stmt.free()
      return null
    }

    const row = stmt.getAsObject() as any
    stmt.free()

    return {
      enabled: row.enabled === 1,
      connected: row.connected === 1,
      data: row.connection_data ? JSON.parse(row.connection_data) : null,
    }
  }

  saveAppConnection(appId: string, enabled: boolean, connected: boolean, data?: any): void {
    const db = getDb()
    const now = Date.now()

    db.run(
      `INSERT OR REPLACE INTO app_connections (app_id, enabled, connected, connection_data, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [appId, enabled ? 1 : 0, connected ? 1 : 0, data ? JSON.stringify(data) : null, now]
    )
    saveToDisk()
  }

  // Cleanup

  clearAllData(): void {
    const db = getDb()
    db.run('DELETE FROM whatsapp_messages')
    db.run('DELETE FROM whatsapp_chats')
    db.run('DELETE FROM whatsapp_contacts')
    saveToDisk()
    console.log('[WhatsApp Store] Cleared all data')
  }

  // Helper

  private rowToMessageInfo(row: any): MessageInfo {
    // Try to parse raw_message if available for full data
    if (row.raw_message) {
      try {
        return JSON.parse(row.raw_message)
      } catch {
        // Fall through to manual construction
      }
    }

    return {
      id: row.message_id,
      from: row.from_jid,
      to: row.chat_jid,
      fromMe: row.from_me === 1,
      timestamp: row.timestamp,
      type: row.message_type || 'text',
      content: row.content || '',
      isGroup: row.chat_jid?.endsWith('@g.us') || false,
    }
  }
}

// Singleton instance
let messageStoreInstance: WhatsAppMessageStore | null = null

export function getMessageStore(): WhatsAppMessageStore {
  if (!messageStoreInstance) {
    messageStoreInstance = new WhatsAppMessageStore()
  }
  return messageStoreInstance
}
