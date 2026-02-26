/**
 * Google Workspace Service - Main entry point for Google Workspace integration
 * Provides a high-level API for the agent tools and IPC handlers
 */

import { OAuth2Client } from 'google-auth-library'
import { shell } from 'electron'
import { getGoogleAuthStore } from './auth-store'
import { createOAuthServer, OAuthServer } from './oauth-server'
import { GmailService } from './services/gmail'
import { CalendarService } from './services/calendar'
import { DriveService } from './services/drive'
import { DocsService } from './services/docs'
import type {
  GoogleConnectionStatus,
  EmailInfo,
  EmailDetail,
  SendEmailResult,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  DriveFile,
  DocumentContent,
  SpreadsheetData
} from './types'

export type {
  GoogleConnectionStatus,
  EmailInfo,
  EmailDetail,
  SendEmailResult,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  DriveFile,
  DocumentContent,
  SpreadsheetData
}

// OAuth credentials (from environment variables)
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''

type ConnectionCallback = (status: GoogleConnectionStatus) => void

class GoogleWorkspaceService {
  private oauth2Client: OAuth2Client | null = null
  private oauthServer: OAuthServer | null = null
  private initialized = false
  private connectionCallbacks = new Set<ConnectionCallback>()

  // Service instances (created lazily)
  private gmailService: GmailService | null = null
  private calendarService: CalendarService | null = null
  private driveService: DriveService | null = null
  private docsService: DocsService | null = null

  /**
   * Initialize the Google Workspace service
   * Called lazily on first use
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[Google Workspace] Initializing service...')

    // Try to restore session from stored tokens
    const authStore = getGoogleAuthStore()
    if (await authStore.hasValidTokens()) {
      console.log('[Google Workspace] Found stored credentials, restoring session...')
      await this.restoreSession()
    }

    this.initialized = true
    console.log('[Google Workspace] Service initialized')
  }

  /**
   * Start OAuth connection flow
   * Opens browser for Google authentication
   * @returns The OAuth authorization URL
   */
  async connect(): Promise<string> {
    await this.initialize()

    // Clean up any existing OAuth server
    if (this.oauthServer) {
      this.oauthServer.cleanup()
    }

    // Create new OAuth server
    this.oauthServer = createOAuthServer()
    const authUrl = await this.oauthServer.startOAuthFlow()

    // Open browser for authentication
    shell.openExternal(authUrl)

    // Wait for callback in background
    this.handleOAuthCallback()

    return authUrl
  }

  /**
   * Handle OAuth callback (runs in background)
   */
  private async handleOAuthCallback(): Promise<void> {
    if (!this.oauthServer) return

    try {
      const result = await this.oauthServer.waitForCallback()

      // Save tokens
      const authStore = getGoogleAuthStore()
      await authStore.saveTokens(result.tokens, result.email)

      // Create OAuth client with tokens
      this.oauth2Client = new OAuth2Client(
        GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET
      )
      this.oauth2Client.setCredentials({
        access_token: result.tokens.access_token,
        refresh_token: result.tokens.refresh_token,
        expiry_date: result.tokens.expiry_date
      })

      // Set up token refresh handler
      this.setupTokenRefresh()

      // Clear service instances to force recreation with new auth
      this.clearServiceInstances()

      // Notify connection change
      this.notifyConnectionChange()

      console.log('[Google Workspace] Connected successfully as:', result.email)
    } catch (error) {
      console.error('[Google Workspace] OAuth callback error:', error)
    } finally {
      this.oauthServer = null
    }
  }

  /**
   * Restore session from stored tokens
   */
  private async restoreSession(): Promise<void> {
    const authStore = getGoogleAuthStore()
    const tokens = await authStore.getTokens()

    if (!tokens) {
      console.log('[Google Workspace] No stored tokens found')
      return
    }

    // Create OAuth client
    this.oauth2Client = new OAuth2Client(
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET
    )
    this.oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    })

    // Set up token refresh handler
    this.setupTokenRefresh()

    // Refresh tokens if expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[Google Workspace] Tokens expired, refreshing...')
      try {
        await this.refreshTokens()
      } catch (error) {
        console.error('[Google Workspace] Failed to refresh tokens:', error)
        await this.disconnect()
        return
      }
    }

    console.log('[Google Workspace] Session restored')
  }

  /**
   * Set up automatic token refresh
   */
  private setupTokenRefresh(): void {
    if (!this.oauth2Client) return

    this.oauth2Client.on('tokens', async (tokens) => {
      console.log('[Google Workspace] Received new tokens')
      const authStore = getGoogleAuthStore()
      await authStore.updateTokens({
        access_token: tokens.access_token || undefined,
        expiry_date: tokens.expiry_date || undefined
      })
    })
  }

  /**
   * Manually refresh tokens
   */
  private async refreshTokens(): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth client not initialized')
    }

    const { credentials } = await this.oauth2Client.refreshAccessToken()
    this.oauth2Client.setCredentials(credentials)

    const authStore = getGoogleAuthStore()
    await authStore.updateTokens({
      access_token: credentials.access_token || undefined,
      expiry_date: credentials.expiry_date || undefined
    })
  }

  /**
   * Disconnect and clear credentials
   */
  async disconnect(): Promise<void> {
    // Clear tokens
    const authStore = getGoogleAuthStore()
    await authStore.clearTokens()

    // Clear OAuth client
    this.oauth2Client = null

    // Clear service instances
    this.clearServiceInstances()

    // Clean up OAuth server if running
    if (this.oauthServer) {
      this.oauthServer.cleanup()
      this.oauthServer = null
    }

    // Notify connection change
    this.notifyConnectionChange()

    console.log('[Google Workspace] Disconnected')
  }

  /**
   * Clear service instances
   */
  private clearServiceInstances(): void {
    this.gmailService = null
    this.calendarService = null
    this.driveService = null
    this.docsService = null
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.oauth2Client !== null
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<GoogleConnectionStatus> {
    const authStore = getGoogleAuthStore()
    const connected = this.isConnected()

    if (!connected) {
      return {
        connected: false,
        email: null,
        connectedAt: null,
        services: {
          gmail: false,
          calendar: false,
          drive: false,
          docs: false
        }
      }
    }

    const email = await authStore.getEmail()
    const connectedAt = await authStore.getConnectedAt()
    const tokens = await authStore.getTokens()

    // Check which services are available based on scopes
    const scope = tokens?.scope || ''
    const services = {
      gmail: scope.includes('gmail'),
      calendar: scope.includes('calendar'),
      drive: scope.includes('drive'),
      docs: scope.includes('documents') || scope.includes('spreadsheets')
    }

    return {
      connected: true,
      email,
      connectedAt,
      services
    }
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback)
    return () => {
      this.connectionCallbacks.delete(callback)
    }
  }

  /**
   * Notify all connection change callbacks
   */
  private async notifyConnectionChange(): Promise<void> {
    const status = await this.getConnectionStatus()
    for (const callback of this.connectionCallbacks) {
      try {
        callback(status)
      } catch (error) {
        console.error('[Google Workspace] Connection callback error:', error)
      }
    }
  }

  // ============= GMAIL METHODS =============

  private getGmailService(): GmailService {
    if (!this.oauth2Client) {
      throw new Error('Google Workspace is not connected. Please connect in Settings > Apps.')
    }
    if (!this.gmailService) {
      this.gmailService = new GmailService(this.oauth2Client)
    }
    return this.gmailService
  }

  async searchEmails(query: string, maxResults?: number): Promise<EmailInfo[]> {
    return this.getGmailService().searchEmails(query, maxResults)
  }

  async getEmail(messageId: string): Promise<EmailDetail> {
    return this.getGmailService().getEmail(messageId)
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string
  ): Promise<SendEmailResult> {
    return this.getGmailService().sendEmail(to, subject, body, cc, bcc)
  }

  // ============= CALENDAR METHODS =============

  private getCalendarService(): CalendarService {
    if (!this.oauth2Client) {
      throw new Error('Google Workspace is not connected. Please connect in Settings > Apps.')
    }
    if (!this.calendarService) {
      this.calendarService = new CalendarService(this.oauth2Client)
    }
    return this.calendarService
  }

  async getEvents(
    calendarId: string,
    startDate: string,
    endDate: string,
    maxResults?: number
  ): Promise<CalendarEvent[]> {
    return this.getCalendarService().getEvents(calendarId, startDate, endDate, maxResults)
  }

  async createEvent(calendarId: string, event: CreateEventInput): Promise<CalendarEvent> {
    return this.getCalendarService().createEvent(calendarId, event)
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    updates: UpdateEventInput
  ): Promise<CalendarEvent> {
    return this.getCalendarService().updateEvent(calendarId, eventId, updates)
  }

  // ============= DRIVE METHODS =============

  private getDriveService(): DriveService {
    if (!this.oauth2Client) {
      throw new Error('Google Workspace is not connected. Please connect in Settings > Apps.')
    }
    if (!this.driveService) {
      this.driveService = new DriveService(this.oauth2Client)
    }
    return this.driveService
  }

  async listFiles(query?: string, folderId?: string, maxResults?: number): Promise<DriveFile[]> {
    return this.getDriveService().listFiles(query, folderId, maxResults)
  }

  async getFileContent(fileId: string): Promise<string> {
    return this.getDriveService().getFileContent(fileId)
  }

  // ============= DOCS METHODS =============

  private getDocsService(): DocsService {
    if (!this.oauth2Client) {
      throw new Error('Google Workspace is not connected. Please connect in Settings > Apps.')
    }
    if (!this.docsService) {
      this.docsService = new DocsService(this.oauth2Client)
    }
    return this.docsService
  }

  async readDocument(documentId: string): Promise<DocumentContent> {
    return this.getDocsService().readDocument(documentId)
  }

  async readSpreadsheet(spreadsheetId: string, range?: string): Promise<SpreadsheetData> {
    return this.getDocsService().readSpreadsheet(spreadsheetId, range)
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (this.oauthServer) {
      this.oauthServer.cleanup()
      this.oauthServer = null
    }
    this.oauth2Client = null
    this.clearServiceInstances()
    this.initialized = false
    console.log('[Google Workspace] Service shutdown')
  }
}

// Singleton instance
export const googleWorkspaceService = new GoogleWorkspaceService()
