/**
 * WhatsApp Types - Shared type definitions for WhatsApp integration
 */

export interface ContactInfo {
  jid: string
  name: string
  pushName: string | null
  phoneNumber: string
  isGroup: boolean
}

export interface ChatInfo {
  jid: string
  name: string
  isGroup: boolean
  lastMessageTime?: number
  unreadCount: number
}

export interface MessageInfo {
  id: string
  from: string
  to: string
  fromMe: boolean
  timestamp: number
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other'
  content: string
  isGroup: boolean
  senderName?: string
}

export interface ConnectionStatus {
  connected: boolean
  phoneNumber: string | null
  connectedAt: string | null
}

export interface SendMessageResult {
  messageId: string
  timestamp: number
}
