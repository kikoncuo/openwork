/**
 * Google Workspace Types - Shared type definitions for Google Workspace integration
 */

export interface GoogleConnectionStatus {
  connected: boolean
  email: string | null
  connectedAt: number | null
  services: {
    gmail: boolean
    calendar: boolean
    drive: boolean
    docs: boolean
  }
}

export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  scope: string
}

// Gmail types
export interface AttachmentInfo {
  filename: string
  mimeType: string
  size: number
  attachmentId: string
}

export interface EmailInfo {
  id: string
  threadId: string
  subject: string
  from: string
  date: number
  snippet: string
}

export interface EmailDetail extends EmailInfo {
  body: string
  to: string[]
  cc?: string[]
  attachments?: AttachmentInfo[]
}

export interface SendEmailResult {
  messageId: string
  threadId: string
}

// Calendar types
export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: string
  end: string
  attendees?: string[]
  location?: string
}

export interface CreateEventInput {
  summary: string
  description?: string
  start: string
  end: string
  attendees?: string[]
  location?: string
}

export interface UpdateEventInput {
  summary?: string
  description?: string
  start?: string
  end?: string
  attendees?: string[]
  location?: string
}

// Drive types
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime: string
  webViewLink?: string
}

// Docs types
export interface DocumentContent {
  documentId: string
  title: string
  body: string
}

export interface SheetData {
  sheetId: number
  title: string
  data: string[][]
}

export interface SpreadsheetData {
  spreadsheetId: string
  title: string
  sheets: SheetData[]
}
