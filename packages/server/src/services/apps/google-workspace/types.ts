/**
 * Google Workspace Types for Server
 */

export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  scope: string
}

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

export interface EmailInfo {
  id: string
  threadId: string
  subject: string
  from: string
  date: number
  snippet: string
}

export interface AttachmentInfo {
  filename: string
  mimeType: string
  size: number
  attachmentId: string
}

export interface EmailAttachmentInput {
  filePath: string      // Path in sandbox (e.g., "/home/user/document.pdf")
  filename?: string     // Optional: override filename for attachment
}

export interface EmailDetail extends EmailInfo {
  to: string[]
  cc?: string[]
  body: string
  attachments?: AttachmentInfo[]
  rfc822MessageId?: string  // The RFC 822 Message-ID header (for replies)
}

export interface SendEmailResult {
  messageId: string
  threadId: string
}

export interface ModifyEmailResult {
  messageId: string
  labelsAdded: string[]
  labelsRemoved: string[]
}

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

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime: string
  webViewLink?: string
}

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

export interface UploadFileResult {
  fileId: string
  name: string
  mimeType: string
  webViewLink?: string
}

export interface CreateFolderResult {
  folderId: string
  name: string
  webViewLink?: string
}

export interface ShareFileResult {
  permissionId: string
  fileId: string
  email: string
  role: string
  type: string
}

export interface UpdateDocumentResult {
  documentId: string
  title: string
}

export interface UpdateSpreadsheetResult {
  spreadsheetId: string
  updatedRange: string
  updatedRows: number
  updatedColumns: number
  updatedCells: number
}

export interface ContactInfo {
  resourceName: string
  name?: string
  emails: string[]
  phones: string[]
  organization?: string
  title?: string
}
