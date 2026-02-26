/**
 * Google Workspace Service - Main entry point for Google Workspace integration
 * Server-side implementation using googleapis
 */

import { OAuth2Client } from 'google-auth-library'
import { google, calendar_v3, gmail_v1, drive_v3, docs_v1, sheets_v4 } from 'googleapis'
import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
import { getGoogleAuthStore } from './auth-store.js'
import { marked } from 'marked'
import { convertMarkdownToDocs, type ImageReference, type TableReference, type TableCellContent, type InlineRange } from './markdown-to-docs.js'
import type { SandboxFileAccess } from '../../agent/sandbox-file-access.js'
import type {
  GoogleConnectionStatus,
  GoogleTokens,
  EmailInfo,
  EmailDetail,
  SendEmailResult,
  ModifyEmailResult,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  DriveFile,
  DocumentContent,
  SpreadsheetData,
  UploadFileResult,
  CreateFolderResult,
  ShareFileResult,
  UpdateDocumentResult,
  UpdateSpreadsheetResult,
  ContactInfo,
  EmailAttachmentInput
} from './types.js'

export type {
  GoogleConnectionStatus,
  EmailInfo,
  EmailDetail,
  SendEmailResult,
  ModifyEmailResult,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  DriveFile,
  DocumentContent,
  SpreadsheetData,
  UploadFileResult,
  CreateFolderResult,
  ShareFileResult,
  UpdateDocumentResult,
  UpdateSpreadsheetResult,
  ContactInfo,
  EmailAttachmentInput
}

/** Convert a markdown email body to styled HTML for Gmail */
function markdownToEmailHtml(body: string): string {
  const html = marked.parse(body, { async: false }) as string
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222;">${html}</div>`
}

// OAuth credentials from environment variables
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''

// Log credential status at module load
console.log('[Google Workspace] OAuth Client ID configured:', GOOGLE_OAUTH_CLIENT_ID ? `${GOOGLE_OAUTH_CLIENT_ID.substring(0, 20)}...` : 'NOT SET')
console.log('[Google Workspace] OAuth Client Secret configured:', GOOGLE_OAUTH_CLIENT_SECRET ? 'SET' : 'NOT SET')

// OAuth scopes
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // Read, send, and modify emails (includes marking read/unread)
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive', // Full Drive access (upload, download, share, delete)
  'https://www.googleapis.com/auth/documents', // Full Docs access (read and write)
  'https://www.googleapis.com/auth/spreadsheets', // Full Sheets access (read and write)
  'https://www.googleapis.com/auth/contacts.readonly', // Read contacts
  'openid',
  'email',
  'profile'
]

type ConnectionCallback = (status: GoogleConnectionStatus) => void

interface UserConnection {
  oauth2Client: OAuth2Client
  callbacks: Set<ConnectionCallback>
}

interface PendingAuth {
  userId: string
  resolve: (result: { tokens: GoogleTokens; email: string }) => void
  reject: (error: Error) => void
}

class GoogleWorkspaceService {
  // Map of userId -> connection
  private connections = new Map<string, UserConnection>()
  private oauthServer: Server | null = null
  private pendingAuths = new Map<string, PendingAuth>()
  private initialized = false

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    console.log('[Google Workspace] Initializing service...')

    if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
      console.warn('[Google Workspace] OAuth credentials not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env')
    } else {
      console.log('[Google Workspace] OAuth credentials configured')
    }

    this.initialized = true
    console.log('[Google Workspace] Service initialized')
  }

  /**
   * Start OAuth connection flow for a user
   * Returns the OAuth URL to redirect the user to
   */
  async connect(userId: string): Promise<string> {
    await this.initialize()

    // Create OAuth2 client for this flow
    const redirectUri = await this.startOAuthServer()
    const oauth2Client = new OAuth2Client(
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri
    )

    // Generate state with userId
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64')

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: OAUTH_SCOPES,
      state,
      prompt: 'consent'
    })

    // Store pending auth promise
    const authPromise = new Promise<{ tokens: GoogleTokens; email: string }>((resolve, reject) => {
      this.pendingAuths.set(state, { userId, resolve, reject })

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingAuths.has(state)) {
          this.pendingAuths.delete(state)
          reject(new Error('OAuth timeout'))
        }
      }, 5 * 60 * 1000)
    })

    // Handle the auth result in background
    authPromise
      .then(async (result) => {
        await this.handleAuthSuccess(userId, result.tokens, result.email)
      })
      .catch((error) => {
        console.error('[Google Workspace] OAuth error:', error)
      })

    return authUrl
  }

  /**
   * Start local OAuth callback server
   */
  private async startOAuthServer(): Promise<string> {
    // Use a fixed port for easier Google Cloud Console configuration
    const OAUTH_PORT = 8089

    if (this.oauthServer) {
      return `http://localhost:${OAUTH_PORT}/oauth/callback`
    }

    return new Promise((resolve, reject) => {
      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url?.startsWith('/oauth/callback')) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const url = new URL(req.url, `http://localhost`)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>')

          if (state && this.pendingAuths.has(state)) {
            const pending = this.pendingAuths.get(state)!
            this.pendingAuths.delete(state)
            pending.reject(new Error(error))
          }
          return
        }

        if (!code || !state) {
          res.writeHead(400)
          res.end('Missing code or state')
          return
        }

        try {
          // Exchange code for tokens
          const redirectUri = `http://localhost:${(server.address() as { port: number }).port}/oauth/callback`
          const oauth2Client = new OAuth2Client(
            GOOGLE_OAUTH_CLIENT_ID,
            GOOGLE_OAUTH_CLIENT_SECRET,
            redirectUri
          )

          const { tokens } = await oauth2Client.getToken(code)
          oauth2Client.setCredentials(tokens)

          // Get user email
          const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
          const userInfo = await oauth2.userinfo.get()
          const email = userInfo.data.email || 'unknown'

          // Build tokens object
          const googleTokens: GoogleTokens = {
            access_token: tokens.access_token || '',
            refresh_token: tokens.refresh_token || '',
            expiry_date: tokens.expiry_date || 0,
            scope: tokens.scope || ''
          }

          // Resolve pending auth
          if (this.pendingAuths.has(state)) {
            const pending = this.pendingAuths.get(state)!
            this.pendingAuths.delete(state)
            pending.resolve({ tokens: googleTokens, email })
          }

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the application.</p></body></html>')
        } catch (err) {
          console.error('[Google Workspace] Token exchange error:', err)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Authentication failed</h1><p>Please try again.</p></body></html>')

          if (state && this.pendingAuths.has(state)) {
            const pending = this.pendingAuths.get(state)!
            this.pendingAuths.delete(state)
            pending.reject(err instanceof Error ? err : new Error('Token exchange failed'))
          }
        }
      })

      server.listen(OAUTH_PORT, 'localhost', () => {
        this.oauthServer = server
        console.log(`[Google Workspace] OAuth callback server started on port ${OAUTH_PORT}`)
        resolve(`http://localhost:${OAUTH_PORT}/oauth/callback`)
      })

      server.on('error', reject)
    })
  }

  /**
   * Handle successful authentication
   */
  private async handleAuthSuccess(userId: string, tokens: GoogleTokens, email: string): Promise<void> {
    console.log('[Google Workspace Service] handleAuthSuccess called for user:', userId, 'email:', email)
    try {
      // Save tokens
      const authStore = getGoogleAuthStore()
      console.log('[Google Workspace Service] Saving tokens...')
      await authStore.saveTokens(userId, tokens, email)
      console.log('[Google Workspace Service] Tokens saved successfully')

      // Create OAuth client
      const oauth2Client = new OAuth2Client(
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET
      )
      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      })

      // Set up token refresh
      oauth2Client.on('tokens', async (newTokens) => {
        console.log('[Google Workspace] Received new tokens')
        await authStore.updateTokens(userId, {
          access_token: newTokens.access_token || undefined,
          expiry_date: newTokens.expiry_date || undefined
        })
      })

      // Store connection - preserve existing callbacks
      const existing = this.connections.get(userId)
      console.log('[Google Workspace Service] Existing connection:', !!existing, 'existing callbacks:', existing?.callbacks?.size || 0)
      this.connections.set(userId, {
        oauth2Client,
        callbacks: existing?.callbacks || new Set()
      })
      console.log('[Google Workspace Service] Connection stored in memory')

      // Notify connection change
      console.log('[Google Workspace Service] Notifying connection change...')
      await this.notifyConnectionChange(userId)
      console.log(`[Google Workspace] Connected successfully as: ${email}`)
    } catch (error) {
      console.error('[Google Workspace Service] handleAuthSuccess error:', error)
      throw error
    }
  }

  /**
   * Restore session from stored tokens
   */
  async restoreSession(userId: string): Promise<boolean> {
    console.log('[Google Workspace Service] restoreSession called for user:', userId)
    try {
      const authStore = getGoogleAuthStore()
      console.log('[Google Workspace Service] Checking for valid tokens...')
      const hasTokens = await authStore.hasValidTokens(userId)
      console.log('[Google Workspace Service] hasValidTokens result:', hasTokens)

      if (!hasTokens) {
        return false
      }

      console.log('[Google Workspace Service] Getting tokens from store...')
      const tokens = await authStore.getTokens(userId)
      if (!tokens) {
        console.log('[Google Workspace Service] No tokens found')
        return false
      }
      console.log('[Google Workspace Service] Tokens retrieved successfully')

      const oauth2Client = new OAuth2Client(
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET
      )
      oauth2Client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      })

      // Set up token refresh
      oauth2Client.on('tokens', async (newTokens) => {
        await authStore.updateTokens(userId, {
          access_token: newTokens.access_token || undefined,
          expiry_date: newTokens.expiry_date || undefined
        })
      })

      // Refresh if expired
      if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
        console.log('[Google Workspace Service] Tokens expired, refreshing...')
        try {
          await oauth2Client.refreshAccessToken()
          console.log('[Google Workspace Service] Tokens refreshed successfully')
        } catch (error) {
          console.error('[Google Workspace] Failed to refresh tokens:', error)
          await this.disconnect(userId)
          return false
        }
      }

      const existing = this.connections.get(userId)
      this.connections.set(userId, {
        oauth2Client,
        callbacks: existing?.callbacks || new Set()
      })

      console.log(`[Google Workspace] Session restored for user ${userId}`)
      return true
    } catch (error) {
      console.error('[Google Workspace Service] restoreSession error:', error)
      console.error('[Google Workspace Service] Error stack:', error instanceof Error ? error.stack : 'no stack')
      return false
    }
  }

  /**
   * Disconnect and clear credentials
   */
  async disconnect(userId: string): Promise<void> {
    const authStore = getGoogleAuthStore()
    await authStore.clearTokens(userId)

    this.connections.delete(userId)
    await this.notifyConnectionChange(userId)

    console.log(`[Google Workspace] Disconnected user ${userId}`)
  }

  /**
   * Check if user is connected (has valid OAuth client in memory)
   */
  isConnected(userId: string): boolean {
    const connection = this.connections.get(userId)
    // Only return true if we have an actual oauth2Client (not just a placeholder from callback registration)
    return connection?.oauth2Client != null && connection.oauth2Client !== (null as unknown as OAuth2Client)
  }

  /**
   * Get connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
    console.log('[Google Workspace Service] getConnectionStatus called for user:', userId)
    try {
      const authStore = getGoogleAuthStore()
      const connected = this.isConnected(userId)
      console.log('[Google Workspace Service] isConnected (in memory):', connected)

      if (!connected) {
        // Try to restore session from database
        console.log('[Google Workspace Service] Not connected in memory, trying to restore session...')
        try {
          const restored = await this.restoreSession(userId)
          console.log('[Google Workspace Service] Session restored:', restored)
          if (!restored) {
            console.log('[Google Workspace Service] No stored session found, returning disconnected status')
            return {
              connected: false,
              email: null,
              connectedAt: null,
              services: { gmail: false, calendar: false, drive: false, docs: false }
            }
          }
        } catch (restoreError) {
          console.error('[Google Workspace Service] Error restoring session:', restoreError)
          // If restore fails, return disconnected status instead of throwing
          return {
            connected: false,
            email: null,
            connectedAt: null,
            services: { gmail: false, calendar: false, drive: false, docs: false }
          }
        }
      }

      console.log('[Google Workspace Service] Getting email...')
      const email = await authStore.getEmail(userId)
      console.log('[Google Workspace Service] Email:', email)
      console.log('[Google Workspace Service] Getting connectedAt...')
      const connectedAt = await authStore.getConnectedAt(userId)
      console.log('[Google Workspace Service] ConnectedAt:', connectedAt)
      console.log('[Google Workspace Service] Getting tokens...')
      const tokens = await authStore.getTokens(userId)
      console.log('[Google Workspace Service] Tokens retrieved:', tokens ? 'yes' : 'no')

      const scope = tokens?.scope || ''
      const services = {
        gmail: scope.includes('gmail'),
        calendar: scope.includes('calendar'),
        drive: scope.includes('drive'),
        docs: scope.includes('documents') || scope.includes('spreadsheets')
      }

      const result = {
        connected: true,
        email,
        connectedAt,
        services
      }
      console.log('[Google Workspace Service] Returning connected status:', JSON.stringify(result))
      return result
    } catch (error) {
      console.error('[Google Workspace Service] getConnectionStatus error:', error)
      console.error('[Google Workspace Service] Error stack:', error instanceof Error ? error.stack : 'no stack')
      // Return disconnected instead of throwing to avoid 500 errors
      return {
        connected: false,
        email: null,
        connectedAt: null,
        services: { gmail: false, calendar: false, drive: false, docs: false }
      }
    }
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    let connection = this.connections.get(userId)
    if (!connection) {
      connection = { oauth2Client: null as unknown as OAuth2Client, callbacks: new Set() }
      this.connections.set(userId, connection)
    }
    connection.callbacks.add(callback)

    return () => {
      const conn = this.connections.get(userId)
      if (conn) {
        conn.callbacks.delete(callback)
      }
    }
  }

  /**
   * Notify connection change callbacks
   */
  private async notifyConnectionChange(userId: string): Promise<void> {
    console.log('[Google Workspace Service] notifyConnectionChange called for user:', userId)
    const status = await this.getConnectionStatus(userId)
    console.log('[Google Workspace Service] Got status for notification:', JSON.stringify(status))
    const connection = this.connections.get(userId)
    console.log('[Google Workspace Service] Connection found:', !!connection, 'callbacks count:', connection?.callbacks?.size || 0)
    if (connection) {
      for (const callback of connection.callbacks) {
        try {
          console.log('[Google Workspace Service] Calling callback...')
          callback(status)
          console.log('[Google Workspace Service] Callback executed successfully')
        } catch (error) {
          console.error('[Google Workspace] Connection callback error:', error)
        }
      }
    } else {
      console.log('[Google Workspace Service] No connection found, no callbacks to notify')
    }
  }

  /**
   * Get OAuth client for a user
   */
  private getOAuthClient(userId: string): OAuth2Client {
    const connection = this.connections.get(userId)
    if (!connection?.oauth2Client) {
      throw new Error('Google Workspace is not connected. Please connect in Settings > Apps.')
    }
    return connection.oauth2Client
  }

  // ============= GMAIL METHODS =============

  async searchEmails(userId: string, query: string, maxResults = 20): Promise<EmailInfo[]> {
    const auth = this.getOAuthClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults
    })

    const messages = response.data.messages || []
    const results: EmailInfo[] = []

    for (const msg of messages) {
      if (!msg.id) continue
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date']
      })

      const headers = detail.data.payload?.headers || []
      const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)'
      const from = headers.find(h => h.name === 'From')?.value || ''
      const dateStr = headers.find(h => h.name === 'Date')?.value || ''

      results.push({
        id: msg.id,
        threadId: msg.threadId || '',
        subject,
        from,
        date: new Date(dateStr).getTime(),
        snippet: detail.data.snippet || ''
      })
    }

    return results
  }

  async getEmail(userId: string, messageId: string): Promise<EmailDetail> {
    const auth = this.getOAuthClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    })

    const message = response.data
    const headers = message.payload?.headers || []

    const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

    // Extract body
    let body = ''
    const extractBody = (part: gmail_v1.Schema$MessagePart): string => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
      if (part.parts) {
        for (const subpart of part.parts) {
          const text = extractBody(subpart)
          if (text) return text
        }
      }
      return ''
    }

    if (message.payload) {
      body = extractBody(message.payload)
    }

    // Extract attachments
    const attachments: EmailDetail['attachments'] = []
    const extractAttachments = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId
        })
      }
      if (part.parts) {
        for (const subpart of part.parts) {
          extractAttachments(subpart)
        }
      }
    }

    if (message.payload) {
      extractAttachments(message.payload)
    }

    return {
      id: messageId,
      threadId: message.threadId || '',
      subject: getHeader('Subject') || '(No Subject)',
      from: getHeader('From'),
      to: getHeader('To').split(',').map(s => s.trim()).filter(Boolean),
      cc: getHeader('Cc') ? getHeader('Cc').split(',').map(s => s.trim()).filter(Boolean) : undefined,
      date: parseInt(message.internalDate || '0', 10),
      snippet: message.snippet || '',
      body,
      attachments: attachments.length > 0 ? attachments : undefined,
      rfc822MessageId: getHeader('Message-ID') || undefined
    }
  }

  async sendEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string,
    attachments?: EmailAttachmentInput[],
    getFileByPath?: (filePath: string) => Promise<{ content: string; encoding?: 'utf8' | 'base64' } | null>,
    inReplyTo?: string,
    threadId?: string
  ): Promise<SendEmailResult> {
    const auth = this.getOAuthClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })
    const mime = await import('mime-types')
    const path = await import('path')

    let rawMessage: string

    // Check if we have attachments
    if (attachments && attachments.length > 0) {
      // Validate that we have a way to read files
      if (!getFileByPath) {
        throw new Error('Cannot attach files: file reader function not provided. Ensure agentId is available.')
      }

      // Generate a unique boundary string
      const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

      // Build headers
      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`
      ]
      if (cc) headers.push(`Cc: ${cc}`)
      if (bcc) headers.push(`Bcc: ${bcc}`)
      if (inReplyTo) {
        headers.push(`In-Reply-To: ${inReplyTo}`)
        headers.push(`References: ${inReplyTo}`)
      }

      // Start building the message
      const messageParts: string[] = []
      messageParts.push(headers.join('\r\n'))
      messageParts.push('')  // Empty line after headers

      // Add body as first part (convert markdown to HTML)
      messageParts.push(`--${boundary}`)
      messageParts.push('Content-Type: text/html; charset=utf-8')
      messageParts.push('')
      messageParts.push(markdownToEmailHtml(body))

      // Add each attachment
      const failedAttachments: string[] = []
      for (const attachment of attachments) {
        const file = await getFileByPath(attachment.filePath)
        if (!file) {
          failedAttachments.push(attachment.filePath)
          continue
        }

        // Determine filename and mime type
        const filename = attachment.filename || path.basename(attachment.filePath)
        const mimeType = mime.lookup(attachment.filePath) || 'application/octet-stream'

        // Get the base64 content
        // If file is already base64 encoded (binary), use it directly
        // If file is text (utf8), we need to encode it to base64
        const base64Content = file.encoding === 'base64'
          ? file.content
          : Buffer.from(file.content, 'utf8').toString('base64')

        messageParts.push('')
        messageParts.push(`--${boundary}`)
        messageParts.push(`Content-Type: ${mimeType}; name="${filename}"`)
        messageParts.push(`Content-Disposition: attachment; filename="${filename}"`)
        messageParts.push('Content-Transfer-Encoding: base64')
        messageParts.push('')
        messageParts.push(base64Content)
      }

      // If all attachments failed, throw an error
      if (failedAttachments.length === attachments.length) {
        throw new Error(`Failed to read all attachments: ${failedAttachments.join(', ')}`)
      }

      // Warn about any failed attachments (but continue with successful ones)
      if (failedAttachments.length > 0) {
        console.warn(`[Google Workspace] Some attachments could not be read: ${failedAttachments.join(', ')}`)
      }

      // Close the boundary
      messageParts.push('')
      messageParts.push(`--${boundary}--`)

      rawMessage = messageParts.join('\r\n')
    } else {
      // Simple message without attachments (existing behavior)
      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`
      ]
      if (cc) messageParts.push(`Cc: ${cc}`)
      if (bcc) messageParts.push(`Bcc: ${bcc}`)
      if (inReplyTo) {
        messageParts.push(`In-Reply-To: ${inReplyTo}`)
        messageParts.push(`References: ${inReplyTo}`)
      }
      messageParts.push('Content-Type: text/html; charset=utf-8')
      messageParts.push('')
      messageParts.push(markdownToEmailHtml(body))

      rawMessage = messageParts.join('\r\n')
    }

    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const requestBody: { raw: string; threadId?: string } = { raw: encodedMessage }
    if (threadId) {
      requestBody.threadId = threadId
    }

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody
    })

    return {
      messageId: response.data.id || '',
      threadId: response.data.threadId || ''
    }
  }

  async modifyEmailLabels(
    userId: string,
    messageId: string,
    addLabels: string[] = [],
    removeLabels: string[] = []
  ): Promise<ModifyEmailResult> {
    const auth = this.getOAuthClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    const response = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: addLabels,
        removeLabelIds: removeLabels
      }
    })

    return {
      messageId: response.data.id || messageId,
      labelsAdded: addLabels,
      labelsRemoved: removeLabels
    }
  }

  async downloadEmailAttachment(
    userId: string,
    messageId: string,
    attachmentId: string
  ): Promise<{ content: string; filename: string; mimeType: string; encoding: 'base64' }> {
    const auth = this.getOAuthClient(userId)
    const gmail = google.gmail({ version: 'v1', auth })

    // Get attachment data
    const attachmentResponse = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    })

    const data = attachmentResponse.data.data
    if (!data) {
      throw new Error('Attachment data is empty')
    }

    // Gmail returns base64url encoding, convert to standard base64
    const base64Content = data.replace(/-/g, '+').replace(/_/g, '/')

    // Get the email to find the filename
    const email = await this.getEmail(userId, messageId)
    const attachment = email.attachments?.find(a => a.attachmentId === attachmentId)

    return {
      content: base64Content,
      filename: attachment?.filename || `attachment_${attachmentId.substring(0, 8)}`,
      mimeType: attachment?.mimeType || 'application/octet-stream',
      encoding: 'base64'
    }
  }

  // ============= CONTACTS METHODS =============

  async searchContacts(userId: string, query?: string, maxResults = 50): Promise<ContactInfo[]> {
    const auth = this.getOAuthClient(userId)
    const people = google.people({ version: 'v1', auth })

    // If there's a search query, use searchContacts; otherwise list all connections
    if (query && query.trim()) {
      const response = await people.people.searchContacts({
        query: query.trim(),
        readMask: 'names,emailAddresses,phoneNumbers,organizations',
        pageSize: maxResults
      })

      const results = response.data.results || []
      return results.map(result => this.mapContact(result.person)).filter((c): c is ContactInfo => c !== null)
    } else {
      // List all contacts
      const response = await people.people.connections.list({
        resourceName: 'people/me',
        personFields: 'names,emailAddresses,phoneNumbers,organizations',
        pageSize: maxResults,
        sortOrder: 'LAST_MODIFIED_DESCENDING'
      })

      const connections = response.data.connections || []
      return connections.map(person => this.mapContact(person)).filter((c): c is ContactInfo => c !== null)
    }
  }

  private mapContact(person: any): ContactInfo | null {
    if (!person) return null

    const name = person.names?.[0]?.displayName
    const emails = (person.emailAddresses || []).map((e: any) => e.value).filter(Boolean)
    const phones = (person.phoneNumbers || []).map((p: any) => p.value).filter(Boolean)
    const org = person.organizations?.[0]

    // Skip contacts with no useful info
    if (!name && emails.length === 0 && phones.length === 0) return null

    return {
      resourceName: person.resourceName || '',
      name,
      emails,
      phones,
      organization: org?.name,
      title: org?.title
    }
  }

  // ============= CALENDAR METHODS =============

  async getEvents(userId: string, calendarId: string = 'primary', startDate: string, endDate: string, maxResults = 50): Promise<CalendarEvent[]> {
    const auth = this.getOAuthClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    const response = await calendar.events.list({
      calendarId,
      timeMin: startDate,
      timeMax: endDate,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    })

    const events = response.data.items || []
    return events.map(event => this.mapCalendarEvent(event))
  }

  async createEvent(userId: string, calendarId: string = 'primary', event: CreateEventInput): Promise<CalendarEvent> {
    const auth = this.getOAuthClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: this.parseDateTime(event.start),
        end: this.parseDateTime(event.end),
        attendees: event.attendees?.map(email => ({ email }))
      }
    })

    return this.mapCalendarEvent(response.data)
  }

  async updateEvent(userId: string, calendarId: string = 'primary', eventId: string, updates: UpdateEventInput): Promise<CalendarEvent> {
    const auth = this.getOAuthClient(userId)
    const calendar = google.calendar({ version: 'v3', auth })

    // Get existing event
    const existing = await calendar.events.get({ calendarId, eventId })
    const requestBody: calendar_v3.Schema$Event = { ...existing.data }

    if (updates.summary !== undefined) requestBody.summary = updates.summary
    if (updates.description !== undefined) requestBody.description = updates.description
    if (updates.location !== undefined) requestBody.location = updates.location
    if (updates.start !== undefined) requestBody.start = this.parseDateTime(updates.start)
    if (updates.end !== undefined) requestBody.end = this.parseDateTime(updates.end)
    if (updates.attendees !== undefined) requestBody.attendees = updates.attendees.map(email => ({ email }))

    const response = await calendar.events.update({
      calendarId,
      eventId,
      requestBody
    })

    return this.mapCalendarEvent(response.data)
  }

  private mapCalendarEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id || '',
      summary: event.summary || '(No Title)',
      description: event.description || undefined,
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      attendees: event.attendees?.map(a => a.email || '').filter(Boolean),
      location: event.location || undefined
    }
  }

  private parseDateTime(dateTime: string): calendar_v3.Schema$EventDateTime {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTime)) {
      return { date: dateTime }
    }
    return { dateTime }
  }

  // ============= DRIVE METHODS =============

  async listFiles(userId: string, query?: string, folderId?: string, maxResults = 50): Promise<DriveFile[]> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const queryParts: string[] = ['trashed = false']
    if (query) queryParts.push(`name contains '${query.replace(/'/g, "\\'")}'`)
    if (folderId) queryParts.push(`'${folderId}' in parents`)

    const response = await drive.files.list({
      q: queryParts.join(' and '),
      pageSize: maxResults,
      fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc'
    })

    const files = response.data.files || []
    return files.map(file => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      size: file.size ? parseInt(file.size, 10) : undefined,
      modifiedTime: file.modifiedTime || '',
      webViewLink: file.webViewLink || undefined
    }))
  }

  async getFileContent(userId: string, fileId: string): Promise<string> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    // First get file metadata to check type
    const metadata = await drive.files.get({
      fileId,
      fields: 'mimeType'
    })

    const mimeType = metadata.data.mimeType || ''

    // Handle Google Docs types by exporting
    if (mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/plain'
      })
      return response.data as string
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/csv'
      })
      return response.data as string
    }

    // For regular files, download content
    const response = await drive.files.get({
      fileId,
      alt: 'media'
    }, { responseType: 'text' })

    return response.data as string
  }

  async uploadFile(
    userId: string,
    name: string,
    content: string | Buffer,
    mimeType: string = 'text/plain',
    folderId?: string
  ): Promise<UploadFileResult> {
    const { Readable } = await import('stream')
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const fileMetadata: { name: string; parents?: string[] } = { name }
    if (folderId) {
      fileMetadata.parents = [folderId]
    }

    // For binary content (Buffer), use a readable stream to preserve data integrity
    // For text content (string), use directly
    const media = {
      mimeType,
      body: typeof content === 'string' ? content : Readable.from(content)
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, mimeType, webViewLink'
    })

    return {
      fileId: response.data.id || '',
      name: response.data.name || name,
      mimeType: response.data.mimeType || mimeType,
      webViewLink: response.data.webViewLink || undefined
    }
  }

  async uploadFileFromPath(
    userId: string,
    filePath: string,
    targetName?: string,
    folderId?: string
  ): Promise<UploadFileResult> {
    const fs = await import('fs')
    const path = await import('path')
    const mime = await import('mime-types')

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    // Get file stats
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }

    // Determine file name and mime type
    const fileName = targetName || path.basename(filePath)
    const mimeType = mime.lookup(filePath) || 'application/octet-stream'

    // Read file content
    const content = fs.readFileSync(filePath)

    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const fileMetadata: { name: string; parents?: string[] } = { name: fileName }
    if (folderId) {
      fileMetadata.parents = [folderId]
    }

    // Use Readable stream for the upload
    const { Readable } = await import('stream')
    const readable = new Readable()
    readable.push(content)
    readable.push(null)

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType,
        body: readable
      },
      fields: 'id, name, mimeType, webViewLink, size'
    })

    return {
      fileId: response.data.id || '',
      name: response.data.name || fileName,
      mimeType: response.data.mimeType || mimeType,
      webViewLink: response.data.webViewLink || undefined
    }
  }

  async downloadFile(userId: string, fileId: string): Promise<{ content: string; name: string; mimeType: string; encoding: 'utf8' | 'base64' }> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    // Get file metadata
    const metadata = await drive.files.get({
      fileId,
      fields: 'name, mimeType'
    })

    const name = metadata.data.name || 'unknown'
    const mimeType = metadata.data.mimeType || ''

    // Handle Google Docs types by exporting
    if (mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/plain'
      })
      return { content: response.data as string, name: `${name}.txt`, mimeType: 'text/plain', encoding: 'utf8' }
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/csv'
      })
      return { content: response.data as string, name: `${name}.csv`, mimeType: 'text/csv', encoding: 'utf8' }
    }

    if (mimeType === 'application/vnd.google-apps.presentation') {
      // Export presentations as PDF (binary format)
      const response = await drive.files.export({
        fileId,
        mimeType: 'application/pdf'
      }, { responseType: 'arraybuffer' })
      const content = Buffer.from(response.data as ArrayBuffer).toString('base64')
      return { content, name: `${name}.pdf`, mimeType: 'application/pdf', encoding: 'base64' }
    }

    // For regular files, download content as arraybuffer and encode to base64
    const response = await drive.files.get({
      fileId,
      alt: 'media'
    }, { responseType: 'arraybuffer' })

    const content = Buffer.from(response.data as ArrayBuffer).toString('base64')
    return { content, name, mimeType, encoding: 'base64' }
  }

  async createFolder(userId: string, name: string, parentId?: string): Promise<CreateFolderResult> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const fileMetadata: { name: string; mimeType: string; parents?: string[] } = {
      name,
      mimeType: 'application/vnd.google-apps.folder'
    }
    if (parentId) {
      fileMetadata.parents = [parentId]
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name, webViewLink'
    })

    return {
      folderId: response.data.id || '',
      name: response.data.name || name,
      webViewLink: response.data.webViewLink || undefined
    }
  }

  async shareFile(
    userId: string,
    fileId: string,
    email: string,
    role: 'reader' | 'writer' | 'commenter' | 'owner' = 'reader',
    sendNotification: boolean = true
  ): Promise<ShareFileResult> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const response = await drive.permissions.create({
      fileId,
      sendNotificationEmail: sendNotification,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email
      },
      fields: 'id'
    })

    return {
      permissionId: response.data.id || '',
      fileId,
      email,
      role,
      type: 'user'
    }
  }

  async shareFilePublic(
    userId: string,
    fileId: string,
    role: 'reader' | 'writer' | 'commenter' = 'reader'
  ): Promise<ShareFileResult> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const response = await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'anyone',
        role
      },
      fields: 'id'
    })

    return {
      permissionId: response.data.id || '',
      fileId,
      email: 'anyone',
      role,
      type: 'anyone'
    }
  }

  async removeSharing(userId: string, fileId: string, permissionId: string): Promise<void> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    await drive.permissions.delete({
      fileId,
      permissionId
    })
  }

  async getFilePermissions(userId: string, fileId: string): Promise<Array<{ id: string; email?: string; role: string; type: string }>> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    const response = await drive.permissions.list({
      fileId,
      fields: 'permissions(id, emailAddress, role, type)'
    })

    return (response.data.permissions || []).map(p => ({
      id: p.id || '',
      email: p.emailAddress || undefined,
      role: p.role || '',
      type: p.type || ''
    }))
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    await drive.files.delete({ fileId })
  }

  async moveFile(userId: string, fileId: string, newParentId: string, removeFromCurrent: boolean = true): Promise<DriveFile> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    // Get current parents if we need to remove from them
    let previousParents = ''
    if (removeFromCurrent) {
      const file = await drive.files.get({
        fileId,
        fields: 'parents'
      })
      previousParents = (file.data.parents || []).join(',')
    }

    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents || undefined,
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink'
    })

    return {
      id: response.data.id || '',
      name: response.data.name || '',
      mimeType: response.data.mimeType || '',
      size: response.data.size ? parseInt(response.data.size, 10) : undefined,
      modifiedTime: response.data.modifiedTime || '',
      webViewLink: response.data.webViewLink || undefined
    }
  }

  // ============= DOCS METHODS =============

  async readDocument(userId: string, documentId: string): Promise<DocumentContent> {
    const auth = this.getOAuthClient(userId)
    const docs = google.docs({ version: 'v1', auth })

    const response = await docs.documents.get({ documentId })
    const document = response.data

    // Extract text content
    let body = ''
    const extractText = (content: docs_v1.Schema$StructuralElement[] | undefined) => {
      if (!content) return
      for (const element of content) {
        if (element.paragraph?.elements) {
          for (const el of element.paragraph.elements) {
            if (el.textRun?.content) {
              body += el.textRun.content
            }
          }
        }
        if (element.table?.tableRows) {
          for (const row of element.table.tableRows) {
            if (row.tableCells) {
              for (const cell of row.tableCells) {
                extractText(cell.content)
              }
            }
          }
        }
      }
    }

    extractText(document.body?.content)

    return {
      documentId,
      title: document.title || 'Untitled',
      body
    }
  }

  async readSpreadsheet(userId: string, spreadsheetId: string, range?: string): Promise<SpreadsheetData> {
    const auth = this.getOAuthClient(userId)
    const sheets = google.sheets({ version: 'v4', auth })

    // Get spreadsheet metadata
    const metadata = await sheets.spreadsheets.get({ spreadsheetId })
    const title = metadata.data.properties?.title || 'Untitled'
    const sheetList = metadata.data.sheets || []

    const result: SpreadsheetData = {
      spreadsheetId,
      title,
      sheets: []
    }

    // Read data from each sheet or specified range
    for (const sheet of sheetList) {
      const sheetTitle = sheet.properties?.title || 'Sheet'
      const sheetId = sheet.properties?.sheetId || 0

      const readRange = range || `'${sheetTitle}'`
      const dataResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: readRange
      })

      result.sheets.push({
        sheetId,
        title: sheetTitle,
        data: (dataResponse.data.values || []) as string[][]
      })

      // Only read first sheet if no range specified
      if (!range) break
    }

    return result
  }

  /**
   * Find or create the "buddy images" folder in the user's Drive.
   * Used as a staging area for images inserted into Google Docs.
   */
  private async getOrCreateImageFolder(userId: string): Promise<string> {
    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })

    // Search for existing folder
    const searchResult = await drive.files.list({
      q: "name = 'buddy images' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id)',
      pageSize: 1,
    })

    if (searchResult.data.files && searchResult.data.files.length > 0) {
      return searchResult.data.files[0].id!
    }

    // Create the folder
    const createResult = await drive.files.create({
      requestBody: {
        name: 'buddy images',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    })

    return createResult.data.id!
  }

  /**
   * Upload images from the sandbox to Drive and build insertInlineImage requests.
   * Images are inserted in reverse order (highest index first) so earlier indexes stay valid.
   * Each image is made publicly readable so the Docs API can fetch it.
   */
  private async buildImageRequests(
    userId: string,
    images: ImageReference[],
    fileAccess?: SandboxFileAccess
  ): Promise<docs_v1.Schema$Request[]> {
    if (images.length === 0 || !fileAccess) return []

    const auth = this.getOAuthClient(userId)
    const drive = google.drive({ version: 'v3', auth })
    const folderId = await this.getOrCreateImageFolder(userId)
    const mime = await import('mime-types')
    const path = await import('path')
    const requests: docs_v1.Schema$Request[] = []

    // Process in reverse order so insertions don't shift earlier indexes
    const sorted = [...images].sort((a, b) => b.index - a.index)

    for (const img of sorted) {
      try {
        const fileData = await fileAccess.getFile(img.filePath)
        if (!fileData) {
          console.warn(`[GoogleWorkspace] Image not found in sandbox: ${img.filePath}`)
          continue
        }

        const fileName = path.basename(img.filePath)
        const mimeType = mime.lookup(img.filePath) || 'image/png'

        // Upload to Drive in the buddy images folder
        const content = fileData.encoding === 'base64'
          ? Buffer.from(fileData.content, 'base64')
          : fileData.content
        const uploadResult = await this.uploadFile(userId, fileName, content, mimeType, folderId)
        console.log(`[GoogleWorkspace] Uploaded image ${fileName} to Drive: ${uploadResult.fileId}`)

        // Make the image publicly readable so the Docs API can access it
        await drive.permissions.create({
          fileId: uploadResult.fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone',
          },
        })

        // Use the direct content URL that the Docs API can fetch
        const imageUrl = `https://drive.google.com/uc?export=view&id=${uploadResult.fileId}`

        // Delete the placeholder newline character and insert the image at that position
        requests.push({
          deleteContentRange: {
            range: { startIndex: img.index, endIndex: img.index + 1 }
          }
        })
        requests.push({
          insertInlineImage: {
            location: { index: img.index },
            uri: imageUrl,
            objectSize: {
              width: { magnitude: 400, unit: 'PT' },
              height: { magnitude: 300, unit: 'PT' },
            },
          },
        })
      } catch (error) {
        console.error(`[GoogleWorkspace] Failed to process image ${img.filePath}:`, error)
      }
    }

    return requests
  }

  /**
   * Insert tables at their placeholder positions by:
   * 1. Inserting the table structure
   * 2. Reading the document to get actual cell paragraph indices
   * 3. Inserting cell text + formatting using real indices
   *
   * Tables are processed in reverse order (highest index first) to preserve indices.
   */
  private async insertTablesWithContent(
    docs: docs_v1.Docs,
    documentId: string,
    tables: TableReference[]
  ): Promise<void> {
    if (tables.length === 0) return

    // Process in reverse order so insertions don't shift earlier indexes
    const sorted = [...tables].sort((a, b) => b.index - a.index)

    for (const table of sorted) {
      const totalRows = 1 + table.rows.length

      // Step 1: Delete placeholder + insert table structure
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            { deleteContentRange: { range: { startIndex: table.index, endIndex: table.index + 1 } } },
            { insertTable: { location: { index: table.index }, rows: totalRows, columns: table.columns } },
          ]
        }
      })

      // Step 2: Read document to discover actual cell paragraph indices
      const doc = await docs.documents.get({ documentId })
      const tableElement = doc.data.body?.content?.find(
        el => el.table && el.startIndex != null && el.startIndex >= table.index
      )

      if (!tableElement?.table?.tableRows) continue

      // Step 3: Build cell text insertions + formatting using real indices
      const cellRequests: docs_v1.Schema$Request[] = []
      const formatRequests: docs_v1.Schema$Request[] = []

      // Process cells in reverse order so text insertions don't shift earlier indices
      for (let r = tableElement.table.tableRows.length - 1; r >= 0; r--) {
        const row = tableElement.table.tableRows[r]
        if (!row.tableCells) continue

        for (let c = (row.tableCells.length || 0) - 1; c >= 0; c--) {
          const cell = row.tableCells[c]
          const paragraph = cell?.content?.[0]
          const cellIndex = paragraph?.startIndex

          if (cellIndex === undefined || cellIndex === null) continue

          // Get parsed cell content (text + inline formatting ranges)
          const cellContent: TableCellContent | undefined = r === 0
            ? table.headers[c]
            : table.rows[r - 1]?.[c]

          if (!cellContent || cellContent.text.length === 0) continue

          cellRequests.push({
            insertText: { location: { index: cellIndex }, text: cellContent.text }
          })

          // Apply inline formatting ranges (offsets are relative to cell text start)
          for (const range of cellContent.ranges) {
            const rangeStart = cellIndex + range.startOffset
            const rangeEnd = cellIndex + range.endOffset

            if (range.monospace) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: rangeStart, endIndex: rangeEnd },
                  textStyle: { weightedFontFamily: { fontFamily: 'Courier New' } },
                  fields: 'weightedFontFamily',
                }
              })
            }
            if (range.bold && range.italic) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: rangeStart, endIndex: rangeEnd },
                  textStyle: { bold: true, italic: true },
                  fields: 'bold,italic',
                }
              })
            } else if (range.bold) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: rangeStart, endIndex: rangeEnd },
                  textStyle: { bold: true },
                  fields: 'bold',
                }
              })
            } else if (range.italic) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: rangeStart, endIndex: rangeEnd },
                  textStyle: { italic: true },
                  fields: 'italic',
                }
              })
            }
            if (range.link) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: rangeStart, endIndex: rangeEnd },
                  textStyle: {
                    link: { url: range.link },
                    foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.06, green: 0.36 } } },
                    underline: true,
                  },
                  fields: 'link,foregroundColor,underline',
                }
              })
            }
          }

          // Bold header row cells (row 0) if no explicit bold range already covers the whole text
          if (r === 0 && cellContent.text.length > 0) {
            const alreadyBold = cellContent.ranges.some(
              rng => rng.bold && rng.startOffset === 0 && rng.endOffset === cellContent.text.length
            )
            if (!alreadyBold) {
              formatRequests.push({
                updateTextStyle: {
                  range: { startIndex: cellIndex, endIndex: cellIndex + cellContent.text.length },
                  textStyle: { bold: true },
                  fields: 'bold',
                }
              })
            }
          }
        }
      }

      // Apply alignment per column where specified
      for (let c = 0; c < table.columns; c++) {
        const align = table.alignments[c]
        if (!align) continue
        const docsAlign = align === 'center' ? 'CENTER' : align === 'right' ? 'END' : 'START'

        for (let r = 0; r < tableElement.table.tableRows.length; r++) {
          const cell = tableElement.table.tableRows[r]?.tableCells?.[c]
          const paragraph = cell?.content?.[0]
          const cellIndex = paragraph?.startIndex
          const cellEnd = paragraph?.endIndex
          if (cellIndex === undefined || cellEnd === undefined) continue

          formatRequests.push({
            updateParagraphStyle: {
              range: { startIndex: cellIndex, endIndex: cellEnd },
              paragraphStyle: { alignment: docsAlign },
              fields: 'alignment',
            }
          })
        }
      }

      // Execute cell text insertions + formatting
      const allRequests = [...cellRequests, ...formatRequests]
      if (allRequests.length > 0) {
        await docs.documents.batchUpdate({
          documentId,
          requestBody: { requests: allRequests }
        })
      }
    }
  }

  async createDocument(userId: string, title: string, content?: string, fileAccess?: SandboxFileAccess): Promise<DocumentContent> {
    const auth = this.getOAuthClient(userId)
    const docs = google.docs({ version: 'v1', auth })

    // Create a new document
    const createResponse = await docs.documents.create({
      requestBody: { title }
    })

    const documentId = createResponse.data.documentId || ''

    // If content is provided, insert it with markdown formatting
    if (content && documentId) {
      const { text, requests: fmtRequests, images, tables } = convertMarkdownToDocs(content, 1)

      // Phase 1: Insert text + apply formatting
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            { insertText: { location: { index: 1 }, text } },
            ...fmtRequests
          ]
        }
      })

      // Phase 2: Insert images (non-fatal — document is still valid without images)
      if (images.length > 0) {
        try {
          const imageRequests = await this.buildImageRequests(userId, images, fileAccess)
          if (imageRequests.length > 0) {
            await docs.documents.batchUpdate({
              documentId,
              requestBody: { requests: imageRequests }
            })
          }
        } catch (error) {
          console.error(`[GoogleWorkspace] Phase 2 (images) failed for doc ${documentId}:`, error)
        }
      }

      // Phase 3: Insert tables (non-fatal — document is still valid without tables)
      if (tables.length > 0) {
        try {
          await this.insertTablesWithContent(docs, documentId, tables)
        } catch (error) {
          console.error(`[GoogleWorkspace] Phase 3 (tables) failed for doc ${documentId}:`, error)
        }
      }
    }

    return {
      documentId,
      title,
      body: content || ''
    }
  }

  async appendToDocument(userId: string, documentId: string, text: string, fileAccess?: SandboxFileAccess): Promise<UpdateDocumentResult> {
    const auth = this.getOAuthClient(userId)
    const docs = google.docs({ version: 'v1', auth })

    // Get current document to find end index
    const doc = await docs.documents.get({ documentId })
    const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1

    // Append text at the end with markdown formatting
    const insertAt = endIndex - 1
    const { text: cleanText, requests: fmtRequests, images, tables } = convertMarkdownToDocs(text, insertAt)

    // Phase 1: Insert text + formatting
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: insertAt }, text: cleanText } },
          ...fmtRequests
        ]
      }
    })

    // Phase 2: Insert images (non-fatal)
    if (images.length > 0) {
      try {
        const imageRequests = await this.buildImageRequests(userId, images, fileAccess)
        if (imageRequests.length > 0) {
          await docs.documents.batchUpdate({
            documentId,
            requestBody: { requests: imageRequests }
          })
        }
      } catch (error) {
        console.error(`[GoogleWorkspace] Phase 2 (images) failed for doc ${documentId}:`, error)
      }
    }

    // Phase 3: Insert tables (non-fatal)
    if (tables.length > 0) {
      try {
        await this.insertTablesWithContent(docs, documentId, tables)
      } catch (error) {
        console.error(`[GoogleWorkspace] Phase 3 (tables) failed for doc ${documentId}:`, error)
      }
    }

    return {
      documentId,
      title: doc.data.title || 'Untitled'
    }
  }

  async replaceDocumentContent(userId: string, documentId: string, newContent: string, fileAccess?: SandboxFileAccess): Promise<UpdateDocumentResult> {
    const auth = this.getOAuthClient(userId)
    const docs = google.docs({ version: 'v1', auth })

    // Get current document
    const doc = await docs.documents.get({ documentId })
    const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1

    // Delete all content then insert new content
    const requests: docs_v1.Schema$Request[] = []

    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 }
        }
      })
    }

    const { text, requests: fmtRequests, images, tables } = convertMarkdownToDocs(newContent, 1)
    requests.push({ insertText: { location: { index: 1 }, text } })
    requests.push(...fmtRequests)

    // Phase 1: Delete old content + insert text + formatting
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests }
    })

    // Phase 2: Insert images (non-fatal)
    if (images.length > 0) {
      try {
        const imageRequests = await this.buildImageRequests(userId, images, fileAccess)
        if (imageRequests.length > 0) {
          await docs.documents.batchUpdate({
            documentId,
            requestBody: { requests: imageRequests }
          })
        }
      } catch (error) {
        console.error(`[GoogleWorkspace] Phase 2 (images) failed for doc ${documentId}:`, error)
      }
    }

    // Phase 3: Insert tables (non-fatal)
    if (tables.length > 0) {
      try {
        await this.insertTablesWithContent(docs, documentId, tables)
      } catch (error) {
        console.error(`[GoogleWorkspace] Phase 3 (tables) failed for doc ${documentId}:`, error)
      }
    }

    return {
      documentId,
      title: doc.data.title || 'Untitled'
    }
  }

  async createSpreadsheet(userId: string, title: string, data?: string[][]): Promise<SpreadsheetData> {
    const auth = this.getOAuthClient(userId)
    const sheets = google.sheets({ version: 'v4', auth })

    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title }
      }
    })

    const spreadsheetId = response.data.spreadsheetId || ''

    // If initial data is provided, write it
    if (data && data.length > 0 && spreadsheetId) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: data }
      })
    }

    return {
      spreadsheetId,
      title,
      sheets: [{
        sheetId: 0,
        title: 'Sheet1',
        data: data || []
      }]
    }
  }

  async updateSpreadsheet(
    userId: string,
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<UpdateSpreadsheetResult> {
    const auth = this.getOAuthClient(userId)
    const sheets = google.sheets({ version: 'v4', auth })

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    })

    return {
      spreadsheetId,
      updatedRange: response.data.updatedRange || range,
      updatedRows: response.data.updatedRows || 0,
      updatedColumns: response.data.updatedColumns || 0,
      updatedCells: response.data.updatedCells || 0
    }
  }

  async appendToSpreadsheet(
    userId: string,
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<UpdateSpreadsheetResult> {
    const auth = this.getOAuthClient(userId)
    const sheets = google.sheets({ version: 'v4', auth })

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    })

    return {
      spreadsheetId,
      updatedRange: response.data.updates?.updatedRange || range,
      updatedRows: response.data.updates?.updatedRows || 0,
      updatedColumns: response.data.updates?.updatedColumns || 0,
      updatedCells: response.data.updates?.updatedCells || 0
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (this.oauthServer) {
      this.oauthServer.close()
      this.oauthServer = null
    }
    this.connections.clear()
    this.pendingAuths.clear()
    this.initialized = false
    console.log('[Google Workspace] Service shutdown')
  }
}

// Singleton instance
export const googleWorkspaceService = new GoogleWorkspaceService()
