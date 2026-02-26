/**
 * Google Workspace IPC handlers for main process
 * Exposes Google Workspace functionality to the renderer process
 */

import { IpcMain, BrowserWindow } from 'electron'
import { googleWorkspaceService } from '../apps/google-workspace'
import { getGoogleWorkspaceToolInfo, type GoogleWorkspaceToolInfo } from '../apps/google-workspace/tools'
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
} from '../apps/google-workspace'

export function registerGoogleWorkspaceHandlers(ipcMain: IpcMain): void {
  // ============= CONNECTION MANAGEMENT =============

  /**
   * Start OAuth connection flow
   * Opens browser for Google authentication
   * Returns the OAuth authorization URL
   */
  ipcMain.handle('google-workspace:connect', async (): Promise<string> => {
    try {
      return await googleWorkspaceService.connect()
    } catch (error) {
      console.error('[Google Workspace IPC] Connection error:', error)
      const message = error instanceof Error ? error.message : 'Failed to connect to Google Workspace'
      throw new Error(message)
    }
  })

  /**
   * Disconnect and clear credentials
   */
  ipcMain.handle('google-workspace:disconnect', async (): Promise<void> => {
    await googleWorkspaceService.disconnect()
  })

  /**
   * Get current connection status
   */
  ipcMain.handle('google-workspace:getStatus', async (): Promise<GoogleConnectionStatus> => {
    return googleWorkspaceService.getConnectionStatus()
  })

  /**
   * Check if Google Workspace is connected
   */
  ipcMain.handle('google-workspace:isConnected', (): boolean => {
    return googleWorkspaceService.isConnected()
  })

  // ============= EVENT SUBSCRIPTIONS =============

  let connectionCleanup: (() => void) | null = null

  /**
   * Subscribe to connection change events
   * The renderer will receive 'google-workspace:connectionChange' events
   */
  ipcMain.handle('google-workspace:subscribeConnection', (_event): void => {
    // Clean up existing subscription
    if (connectionCleanup) {
      connectionCleanup()
    }

    connectionCleanup = googleWorkspaceService.onConnectionChange((status: GoogleConnectionStatus) => {
      // Send to all renderer windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('google-workspace:connectionChange', status)
      })
    })
  })

  /**
   * Unsubscribe from connection change events
   */
  ipcMain.handle('google-workspace:unsubscribeConnection', (): void => {
    if (connectionCleanup) {
      connectionCleanup()
      connectionCleanup = null
    }
  })

  // ============= GMAIL OPERATIONS =============

  /**
   * Search emails
   */
  ipcMain.handle(
    'google-workspace:gmail:search',
    async (_event, query: string, maxResults?: number): Promise<EmailInfo[]> => {
      return googleWorkspaceService.searchEmails(query, maxResults)
    }
  )

  /**
   * Get full email content
   */
  ipcMain.handle(
    'google-workspace:gmail:get',
    async (_event, messageId: string): Promise<EmailDetail> => {
      return googleWorkspaceService.getEmail(messageId)
    }
  )

  /**
   * Send email
   */
  ipcMain.handle(
    'google-workspace:gmail:send',
    async (
      _event,
      to: string,
      subject: string,
      body: string,
      cc?: string,
      bcc?: string
    ): Promise<SendEmailResult> => {
      return googleWorkspaceService.sendEmail(to, subject, body, cc, bcc)
    }
  )

  // ============= CALENDAR OPERATIONS =============

  /**
   * Get calendar events
   */
  ipcMain.handle(
    'google-workspace:calendar:getEvents',
    async (
      _event,
      calendarId: string,
      startDate: string,
      endDate: string,
      maxResults?: number
    ): Promise<CalendarEvent[]> => {
      return googleWorkspaceService.getEvents(calendarId, startDate, endDate, maxResults)
    }
  )

  /**
   * Create calendar event
   */
  ipcMain.handle(
    'google-workspace:calendar:createEvent',
    async (_event, calendarId: string, eventData: CreateEventInput): Promise<CalendarEvent> => {
      return googleWorkspaceService.createEvent(calendarId, eventData)
    }
  )

  /**
   * Update calendar event
   */
  ipcMain.handle(
    'google-workspace:calendar:updateEvent',
    async (
      _event,
      calendarId: string,
      eventId: string,
      updates: UpdateEventInput
    ): Promise<CalendarEvent> => {
      return googleWorkspaceService.updateEvent(calendarId, eventId, updates)
    }
  )

  // ============= DRIVE OPERATIONS =============

  /**
   * List/search files
   */
  ipcMain.handle(
    'google-workspace:drive:listFiles',
    async (
      _event,
      query?: string,
      folderId?: string,
      maxResults?: number
    ): Promise<DriveFile[]> => {
      return googleWorkspaceService.listFiles(query, folderId, maxResults)
    }
  )

  /**
   * Get file content
   */
  ipcMain.handle(
    'google-workspace:drive:getFile',
    async (_event, fileId: string): Promise<string> => {
      return googleWorkspaceService.getFileContent(fileId)
    }
  )

  // ============= DOCS OPERATIONS =============

  /**
   * Read Google Doc
   */
  ipcMain.handle(
    'google-workspace:docs:readDocument',
    async (_event, documentId: string): Promise<DocumentContent> => {
      return googleWorkspaceService.readDocument(documentId)
    }
  )

  /**
   * Read Google Sheet
   */
  ipcMain.handle(
    'google-workspace:sheets:readSpreadsheet',
    async (_event, spreadsheetId: string, range?: string): Promise<SpreadsheetData> => {
      return googleWorkspaceService.readSpreadsheet(spreadsheetId, range)
    }
  )

  // ============= TOOLS INFO =============

  /**
   * Get Google Workspace tool info for the UI
   */
  ipcMain.handle('google-workspace:getTools', (): GoogleWorkspaceToolInfo[] => {
    return getGoogleWorkspaceToolInfo()
  })
}
