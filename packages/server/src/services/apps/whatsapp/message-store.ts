/**
 * WhatsApp Message Store - Supabase-based storage for contacts, chats, and messages
 */

import { getSupabase } from '../../db/supabase-client.js'
import type { ContactInfo, ChatInfo, MessageInfo } from './types.js'

class WhatsAppMessageStore {
  // Contact operations

  async saveContact(contact: ContactInfo, userId: string): Promise<void> {
    const now = Date.now()

    await getSupabase()
      .from('whatsapp_contacts')
      .upsert({
        jid: contact.jid,
        user_id: userId,
        name: contact.name,
        push_name: contact.pushName,
        phone_number: contact.phoneNumber,
        is_group: contact.isGroup ? 1 : 0,
        updated_at: now,
      }, { onConflict: 'jid,user_id' })
  }

  async getContacts(userId: string, query?: string): Promise<ContactInfo[]> {
    let qb = getSupabase()
      .from('whatsapp_contacts')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true })

    if (query) {
      const pattern = `%${query}%`
      qb = qb.or(`name.ilike.${pattern},push_name.ilike.${pattern},phone_number.ilike.${pattern}`)
    }

    const { data, error } = await qb
    if (error || !data) return []

    return data.map((row: any) => ({
      jid: row.jid,
      name: row.name || row.jid.split('@')[0],
      pushName: row.push_name,
      phoneNumber: row.phone_number,
      isGroup: row.is_group === 1,
    }))
  }

  // Chat operations

  async saveChat(chat: ChatInfo, userId: string): Promise<void> {
    const now = Date.now()

    await getSupabase()
      .from('whatsapp_chats')
      .upsert({
        jid: chat.jid,
        user_id: userId,
        name: chat.name,
        is_group: chat.isGroup ? 1 : 0,
        last_message_time: chat.lastMessageTime || null,
        unread_count: chat.unreadCount,
        updated_at: now,
      }, { onConflict: 'jid,user_id' })
  }

  async getChats(userId: string, limit = 50): Promise<ChatInfo[]> {
    // Supabase doesn't support JOINs directly in the JS client for different tables
    // So we fetch chats and contacts separately
    const { data: chats } = await getSupabase()
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_time', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (!chats || chats.length === 0) return []

    // Get contacts for name resolution
    const jids = chats.map((c: any) => c.jid)
    const { data: contacts } = await getSupabase()
      .from('whatsapp_contacts')
      .select('jid, name, push_name')
      .eq('user_id', userId)
      .in('jid', jids)

    const contactMap = new Map<string, { name: string | null; push_name: string | null }>()
    if (contacts) {
      for (const c of contacts) {
        contactMap.set(c.jid, { name: c.name, push_name: c.push_name })
      }
    }

    return chats.map((row: any) => {
      const contact = contactMap.get(row.jid)
      const name = contact?.name || contact?.push_name || row.name || row.jid.split('@')[0]
      return {
        jid: row.jid,
        name,
        isGroup: row.is_group === 1,
        lastMessageTime: row.last_message_time || undefined,
        unreadCount: row.unread_count || 0,
      }
    })
  }

  // Message operations

  async saveMessage(message: MessageInfo, userId: string): Promise<void> {
    const now = Date.now()

    await getSupabase()
      .from('whatsapp_messages')
      .upsert({
        message_id: message.id,
        user_id: userId,
        chat_jid: message.to,
        from_jid: message.from,
        from_me: message.fromMe ? 1 : 0,
        timestamp: message.timestamp,
        message_type: message.type,
        content: message.content,
        raw_message: JSON.stringify(message),
        created_at: now,
      }, { onConflict: 'message_id,user_id' })
  }

  async getMessages(chatJid: string, userId: string, limit = 50): Promise<MessageInfo[]> {
    const { data, error } = await getSupabase()
      .from('whatsapp_messages')
      .select('*')
      .eq('chat_jid', chatJid)
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    const messages = data.map((row: any) => this.rowToMessageInfo(row))
    // Return in chronological order (oldest first)
    return messages.reverse()
  }

  async searchMessages(query: string, userId: string, chatJid?: string, limit = 20): Promise<MessageInfo[]> {
    const queryLower = query.toLowerCase()
    const pattern = `%${queryLower}%`

    let qb = getSupabase()
      .from('whatsapp_messages')
      .select('*')
      .eq('user_id', userId)
      .ilike('content', pattern)
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (chatJid) {
      qb = qb.eq('chat_jid', chatJid)
    }

    const { data, error } = await qb
    if (error || !data) return []

    return data.map((row: any) => this.rowToMessageInfo(row))
  }

  // App connection operations

  async getAppConnection(appId: string): Promise<{ enabled: boolean; connected: boolean; data: any } | null> {
    const { data, error } = await getSupabase()
      .from('app_connections')
      .select('*')
      .eq('id', appId)
      .single()

    if (error || !data) return null

    return {
      enabled: (data as any).enabled === 1,
      connected: (data as any).connected === 1,
      data: (data as any).connection_data ? JSON.parse((data as any).connection_data) : null,
    }
  }

  async saveAppConnection(appId: string, enabled: boolean, connected: boolean, data?: any): Promise<void> {
    const now = Date.now()

    await getSupabase()
      .from('app_connections')
      .upsert({
        id: appId,
        enabled: enabled ? 1 : 0,
        connected: connected ? 1 : 0,
        connection_data: data ? JSON.stringify(data) : null,
        updated_at: now,
      }, { onConflict: 'id' })
  }

  // Cleanup

  async clearAllData(userId: string): Promise<void> {
    await getSupabase().from('whatsapp_messages').delete().eq('user_id', userId)
    await getSupabase().from('whatsapp_chats').delete().eq('user_id', userId)
    await getSupabase().from('whatsapp_contacts').delete().eq('user_id', userId)
    console.log(`[WhatsApp Store] Cleared all data for user ${userId}`)
  }

  // Helper

  private rowToMessageInfo(row: any): MessageInfo {
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
