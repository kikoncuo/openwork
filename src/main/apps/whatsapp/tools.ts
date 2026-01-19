/**
 * WhatsApp Agent Tools
 * Tools for the agent to interact with WhatsApp messaging
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { whatsappService } from './index'

/**
 * Create WhatsApp tools for the agent
 * These tools allow the agent to search messages, get contacts, view history, and send messages
 */
export function createWhatsAppTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // Tool 1: Search Messages
  tools.push(
    new DynamicStructuredTool({
      name: 'whatsapp_search_messages',
      description: `Search through WhatsApp messages by keyword or phrase.
Use this tool to find messages containing specific text.
You can optionally filter by a specific chat (contact or group).
Returns up to 50 messages by default.
IMPORTANT: This tool only works if WhatsApp is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('The search query to find in messages'),
        chatJid: z.string().optional().describe('Optional: JID of a specific chat to search within (e.g., "1234567890@s.whatsapp.net" or "groupid@g.us")'),
        limit: z.number().optional().default(50).describe('Maximum number of messages to return (default: 50)')
      }),
      func: async ({ query, chatJid, limit }) => {
        if (!whatsappService.isConnected()) {
          return 'WhatsApp is not connected. Please connect WhatsApp in Settings > Apps to use this tool.'
        }

        const messages = whatsappService.searchMessages(query, chatJid, limit)

        if (messages.length === 0) {
          return `No messages found matching "${query}"${chatJid ? ` in the specified chat` : ''}.`
        }

        const results = messages.map((msg, i) => {
          const direction = msg.fromMe ? 'Sent' : 'Received'
          const date = new Date(msg.timestamp * 1000).toLocaleString()
          const sender = msg.isGroup && msg.senderName ? `${msg.senderName}: ` : ''
          return `${i + 1}. [${date}] ${direction}${msg.isGroup ? ' in group' : ''}: ${sender}${msg.content || '[media]'}`
        })

        return `Found ${messages.length} message${messages.length !== 1 ? 's' : ''} matching "${query}":\n\n${results.join('\n')}`
      }
    })
  )

  // Tool 2: Get Contacts
  tools.push(
    new DynamicStructuredTool({
      name: 'whatsapp_get_contacts',
      description: `Get a list of WhatsApp contacts, optionally filtered by name or phone number.
Use this tool to find contact details or look up someone's WhatsApp JID.
The JID is needed for other WhatsApp tools like getting history or sending messages.
IMPORTANT: This tool only works if WhatsApp is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().optional().describe('Optional: Search query to filter contacts by name or phone number')
      }),
      func: async ({ query }) => {
        if (!whatsappService.isConnected()) {
          return 'WhatsApp is not connected. Please connect WhatsApp in Settings > Apps to use this tool.'
        }

        const contacts = whatsappService.getContacts(query)

        if (contacts.length === 0) {
          return query
            ? `No contacts found matching "${query}".`
            : 'No contacts found. WhatsApp contacts may need time to sync after connecting.'
        }

        const results = contacts.slice(0, 50).map((contact, i) => {
          const name = contact.name || contact.pushName || 'Unknown'
          const phone = contact.phoneNumber || contact.jid.split('@')[0]
          const type = contact.isGroup ? ' (Group)' : ''
          return `${i + 1}. ${name}${type} - ${phone}\n   JID: ${contact.jid}`
        })

        const total = contacts.length
        const shown = Math.min(total, 50)
        const suffix = total > 50 ? `\n\n(Showing first ${shown} of ${total} contacts)` : ''

        return `Found ${total} contact${total !== 1 ? 's' : ''}${query ? ` matching "${query}"` : ''}:\n\n${results.join('\n')}${suffix}`
      }
    })
  )

  // Tool 3: Get Message History
  tools.push(
    new DynamicStructuredTool({
      name: 'whatsapp_get_history',
      description: `Get the message history for a specific WhatsApp chat.
Use this tool to view recent messages from a contact or group.
You need the chat's JID (from whatsapp_get_contacts or a previous search).
Returns up to 100 messages by default.
IMPORTANT: This tool only works if WhatsApp is connected in Settings > Apps.`,
      schema: z.object({
        chatJid: z.string().describe('The JID of the chat to get history from (e.g., "1234567890@s.whatsapp.net" or "groupid@g.us")'),
        limit: z.number().optional().default(100).describe('Maximum number of messages to return (default: 100)')
      }),
      func: async ({ chatJid, limit }) => {
        if (!whatsappService.isConnected()) {
          return 'WhatsApp is not connected. Please connect WhatsApp in Settings > Apps to use this tool.'
        }

        const messages = whatsappService.getMessageHistory(chatJid, limit)

        if (messages.length === 0) {
          return `No message history found for chat ${chatJid}. The chat may not exist or no messages have been synced yet.`
        }

        const results = messages.map((msg, i) => {
          const direction = msg.fromMe ? '→' : '←'
          const date = new Date(msg.timestamp * 1000).toLocaleString()
          const sender = msg.isGroup && msg.senderName && !msg.fromMe ? `${msg.senderName}: ` : ''
          return `${i + 1}. [${date}] ${direction} ${sender}${msg.content || '[media]'}`
        })

        return `Message history for ${chatJid} (${messages.length} messages):\n\n${results.join('\n')}`
      }
    })
  )

  // Tool 4: Get Recent Chats
  tools.push(
    new DynamicStructuredTool({
      name: 'whatsapp_get_chats',
      description: `Get a list of recent WhatsApp chats sorted by last message time.
Use this tool to see what conversations are active and get their JIDs.
IMPORTANT: This tool only works if WhatsApp is connected in Settings > Apps.`,
      schema: z.object({
        limit: z.number().optional().default(20).describe('Maximum number of chats to return (default: 20)')
      }),
      func: async ({ limit }) => {
        if (!whatsappService.isConnected()) {
          return 'WhatsApp is not connected. Please connect WhatsApp in Settings > Apps to use this tool.'
        }

        const chats = whatsappService.getChats(limit)

        if (chats.length === 0) {
          return 'No chats found. WhatsApp chats may need time to sync after connecting.'
        }

        const results = chats.map((chat, i) => {
          const name = chat.name || 'Unknown'
          const type = chat.isGroup ? ' (Group)' : ''
          const lastMsg = chat.lastMessageTime
            ? new Date(chat.lastMessageTime * 1000).toLocaleString()
            : 'No messages'
          const unread = chat.unreadCount > 0 ? ` [${chat.unreadCount} unread]` : ''
          return `${i + 1}. ${name}${type}${unread}\n   Last: ${lastMsg}\n   JID: ${chat.jid}`
        })

        return `Recent WhatsApp chats (${chats.length}):\n\n${results.join('\n')}`
      }
    })
  )

  // Tool 5: Send Message (requires human approval)
  tools.push(
    new DynamicStructuredTool({
      name: 'whatsapp_send_message',
      description: `Send a text message to a WhatsApp contact or group.
You need the recipient's JID (from whatsapp_get_contacts or whatsapp_get_chats).
CAUTION: This action requires human approval before executing.
IMPORTANT: This tool only works if WhatsApp is connected in Settings > Apps.`,
      schema: z.object({
        to: z.string().describe('The JID of the recipient (e.g., "1234567890@s.whatsapp.net" for individual, "groupid@g.us" for group)'),
        message: z.string().describe('The text message to send')
      }),
      func: async ({ to, message }) => {
        if (!whatsappService.isConnected()) {
          return 'WhatsApp is not connected. Please connect WhatsApp in Settings > Apps to use this tool.'
        }

        try {
          const result = await whatsappService.sendMessage(to, message)
          const timestamp = new Date(result.timestamp * 1000).toLocaleString()
          return `Message sent successfully to ${to} at ${timestamp}.\nMessage ID: ${result.messageId}`
        } catch (error) {
          return `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  return tools
}

/**
 * Get the names of WhatsApp tools that require human approval
 */
export function getWhatsAppInterruptTools(): string[] {
  return ['whatsapp_send_message']
}

/**
 * Tool info for UI display
 */
export interface WhatsAppToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
}

/**
 * Get WhatsApp tool info for the UI settings
 * Returns tool metadata that can be displayed in the Tools tab
 */
export function getWhatsAppToolInfo(): WhatsAppToolInfo[] {
  return [
    {
      id: 'whatsapp_search_messages',
      name: 'Search Messages',
      description: 'Search through WhatsApp messages by keyword or phrase',
      requireApproval: false
    },
    {
      id: 'whatsapp_get_contacts',
      name: 'Get Contacts',
      description: 'Get a list of WhatsApp contacts, optionally filtered by name or phone',
      requireApproval: false
    },
    {
      id: 'whatsapp_get_history',
      name: 'Get Chat History',
      description: 'Get the message history for a specific WhatsApp chat',
      requireApproval: false
    },
    {
      id: 'whatsapp_get_chats',
      name: 'Get Recent Chats',
      description: 'Get a list of recent WhatsApp chats sorted by last message time',
      requireApproval: false
    },
    {
      id: 'whatsapp_send_message',
      name: 'Send Message',
      description: 'Send a text message to a WhatsApp contact or group',
      requireApproval: true
    }
  ]
}
