import { Router } from 'express'
import { googleWorkspaceService } from '../services/apps/google-workspace/index.js'
import { getGoogleWorkspaceToolInfo } from '../services/apps/google-workspace/tools.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// ============================================
// Connection Management
// ============================================

// Start OAuth connection
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const authUrl = await googleWorkspaceService.connect(userId)
    res.json({ authUrl })
  } catch (error) {
    console.error('[Google Workspace] Connect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect to Google Workspace'
    res.status(500).json({ error: message })
  }
})

// Disconnect from Google Workspace
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    await googleWorkspaceService.disconnect(userId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Google Workspace] Disconnect error:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Get connection status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    console.log('[Google Workspace Route] Getting status for user:', userId)
    const status = await googleWorkspaceService.getConnectionStatus(userId)
    console.log('[Google Workspace Route] Status result:', JSON.stringify(status))
    res.json(status)
  } catch (error) {
    console.error('[Google Workspace Route] Status error:', error)
    console.error('[Google Workspace Route] Error message:', error instanceof Error ? error.message : String(error))
    console.error('[Google Workspace Route] Error stack:', error instanceof Error ? error.stack : 'No stack')
    const message = error instanceof Error ? error.message : 'Failed to get status'
    res.status(500).json({ error: message, details: error instanceof Error ? error.message : String(error) })
  }
})

// ============================================
// Gmail Routes
// ============================================

// Search emails
router.get('/gmail/search', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const query = String(req.query.query || '')
    const maxResults = req.query.maxResults ? parseInt(String(req.query.maxResults), 10) : undefined

    const emails = await googleWorkspaceService.searchEmails(userId, query, maxResults)
    res.json(emails)
  } catch (error) {
    console.error('[Google Workspace] Search emails error:', error)
    const message = error instanceof Error ? error.message : 'Failed to search emails'
    res.status(500).json({ error: message })
  }
})

// Get email by ID
router.get('/gmail/messages/:messageId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const messageId = String(req.params.messageId)

    const email = await googleWorkspaceService.getEmail(userId, messageId)
    res.json(email)
  } catch (error) {
    console.error('[Google Workspace] Get email error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get email'
    res.status(500).json({ error: message })
  }
})

// Send email
router.post('/gmail/send', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { to, subject, body, cc, bcc } = req.body

    const result = await googleWorkspaceService.sendEmail(userId, to, subject, body, cc, bcc)
    res.json(result)
  } catch (error) {
    console.error('[Google Workspace] Send email error:', error)
    const message = error instanceof Error ? error.message : 'Failed to send email'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Calendar Routes
// ============================================

// Get events
router.get('/calendar/events', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const calendarId = String(req.query.calendarId || 'primary')
    const startDate = String(req.query.startDate)
    const endDate = String(req.query.endDate)
    const maxResults = req.query.maxResults ? parseInt(String(req.query.maxResults), 10) : undefined

    const events = await googleWorkspaceService.getEvents(userId, calendarId, startDate, endDate, maxResults)
    res.json(events)
  } catch (error) {
    console.error('[Google Workspace] Get events error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get events'
    res.status(500).json({ error: message })
  }
})

// Create event
router.post('/calendar/events', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { calendarId = 'primary', summary, description, start, end, attendees, location } = req.body

    const event = await googleWorkspaceService.createEvent(userId, calendarId, {
      summary,
      description,
      start,
      end,
      attendees,
      location
    })
    res.json(event)
  } catch (error) {
    console.error('[Google Workspace] Create event error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create event'
    res.status(500).json({ error: message })
  }
})

// Update event
router.patch('/calendar/events/:eventId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const eventId = String(req.params.eventId)
    const { calendarId = 'primary', summary, description, start, end, attendees, location } = req.body

    const event = await googleWorkspaceService.updateEvent(userId, String(calendarId), eventId, {
      summary,
      description,
      start,
      end,
      attendees,
      location
    })
    res.json(event)
  } catch (error) {
    console.error('[Google Workspace] Update event error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update event'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Drive Routes
// ============================================

// List files
router.get('/drive/files', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const query = req.query.query ? String(req.query.query) : undefined
    const folderId = req.query.folderId ? String(req.query.folderId) : undefined
    const maxResults = req.query.maxResults ? parseInt(String(req.query.maxResults), 10) : undefined

    const files = await googleWorkspaceService.listFiles(userId, query, folderId, maxResults)
    res.json(files)
  } catch (error) {
    console.error('[Google Workspace] List files error:', error)
    const message = error instanceof Error ? error.message : 'Failed to list files'
    res.status(500).json({ error: message })
  }
})

// Get file content
router.get('/drive/files/:fileId/content', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const fileId = String(req.params.fileId)

    const content = await googleWorkspaceService.getFileContent(userId, fileId)
    res.json({ content })
  } catch (error) {
    console.error('[Google Workspace] Get file content error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get file content'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Docs Routes
// ============================================

// Read document
router.get('/docs/documents/:documentId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const documentId = String(req.params.documentId)

    const document = await googleWorkspaceService.readDocument(userId, documentId)
    res.json(document)
  } catch (error) {
    console.error('[Google Workspace] Read document error:', error)
    const message = error instanceof Error ? error.message : 'Failed to read document'
    res.status(500).json({ error: message })
  }
})

// Read spreadsheet
router.get('/docs/spreadsheets/:spreadsheetId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const spreadsheetId = String(req.params.spreadsheetId)
    const range = req.query.range ? String(req.query.range) : undefined

    const spreadsheet = await googleWorkspaceService.readSpreadsheet(userId, spreadsheetId, range)
    res.json(spreadsheet)
  } catch (error) {
    console.error('[Google Workspace] Read spreadsheet error:', error)
    const message = error instanceof Error ? error.message : 'Failed to read spreadsheet'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Tools Route
// ============================================

router.get('/tools', requireAuth, async (req, res) => {
  try {
    res.json(getGoogleWorkspaceToolInfo())
  } catch (error) {
    console.error('[Google Workspace] Get tools error:', error)
    res.status(500).json({ error: 'Failed to get tools' })
  }
})

export default router
