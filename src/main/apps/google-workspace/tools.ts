/**
 * Google Workspace Agent Tools
 * Tools for the agent to interact with Gmail, Calendar, Drive, and Docs
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { googleWorkspaceService } from './index'

/**
 * Create Google Workspace tools for the agent
 */
export function createGoogleWorkspaceTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // ============= GMAIL TOOLS =============

  // Tool 1: Search Emails
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_search_emails',
      description: `Search through Gmail emails using Gmail's query syntax.
Examples of queries:
- "from:example@gmail.com" - emails from a specific sender
- "to:example@gmail.com" - emails to a specific recipient
- "subject:meeting" - emails with "meeting" in the subject
- "is:unread" - unread emails
- "has:attachment" - emails with attachments
- "after:2024/01/01 before:2024/12/31" - emails within a date range
- "label:important" - emails with a specific label
You can combine these with AND/OR operators.
Returns up to 20 emails by default.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('Gmail search query'),
        maxResults: z.number().optional().default(20).describe('Maximum number of results (default: 20)')
      }),
      func: async ({ query, maxResults }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const emails = await googleWorkspaceService.searchEmails(query, maxResults)

          if (emails.length === 0) {
            return `No emails found matching query: "${query}"`
          }

          const results = emails.map((email, i) => {
            const date = new Date(email.date).toLocaleString()
            return `${i + 1}. [${date}] From: ${email.from}\n   Subject: ${email.subject}\n   Snippet: ${email.snippet}\n   ID: ${email.id}`
          })

          return `Found ${emails.length} email(s) matching "${query}":\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to search emails: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 2: Get Email
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_get_email',
      description: `Get the full content of a specific email by its message ID.
Use this after searching to read the complete email content.
Returns the full email body, recipients, and attachment info.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        messageId: z.string().describe('The email message ID (from gmail_search_emails)')
      }),
      func: async ({ messageId }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const email = await googleWorkspaceService.getEmail(messageId)
          const date = new Date(email.date).toLocaleString()

          let result = `Subject: ${email.subject}\n`
          result += `From: ${email.from}\n`
          result += `To: ${email.to.join(', ')}\n`
          if (email.cc) result += `CC: ${email.cc.join(', ')}\n`
          result += `Date: ${date}\n`
          if (email.attachments && email.attachments.length > 0) {
            result += `Attachments: ${email.attachments.map(a => `${a.filename} (${a.mimeType})`).join(', ')}\n`
          }
          result += `\n--- Body ---\n${email.body}`

          return result
        } catch (error) {
          return `Failed to get email: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 3: Send Email (requires approval)
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_send_email',
      description: `Send an email through Gmail.
IMPORTANT: This action requires user approval before sending.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text)'),
        cc: z.string().optional().describe('Optional CC recipients (comma-separated)'),
        bcc: z.string().optional().describe('Optional BCC recipients (comma-separated)')
      }),
      func: async ({ to, subject, body, cc, bcc }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const result = await googleWorkspaceService.sendEmail(to, subject, body, cc, bcc)
          return `Email sent successfully!\nMessage ID: ${result.messageId}\nThread ID: ${result.threadId}`
        } catch (error) {
          return `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= CALENDAR TOOLS =============

  // Tool 4: Get Calendar Events
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_get_events',
      description: `Get calendar events within a date range.
Returns events with their title, time, location, and attendees.
Date format should be ISO 8601 (e.g., "2024-01-15T00:00:00Z" or "2024-01-15").
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        startDate: z.string().describe('Start date in ISO format (e.g., "2024-01-15" or "2024-01-15T00:00:00Z")'),
        endDate: z.string().describe('End date in ISO format'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary" for main calendar)'),
        maxResults: z.number().optional().default(50).describe('Maximum number of results (default: 50)')
      }),
      func: async ({ startDate, endDate, calendarId, maxResults }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const events = await googleWorkspaceService.getEvents(calendarId, startDate, endDate, maxResults)

          if (events.length === 0) {
            return `No events found between ${startDate} and ${endDate}`
          }

          const results = events.map((event, i) => {
            let result = `${i + 1}. ${event.summary}\n`
            result += `   Start: ${event.start}\n`
            result += `   End: ${event.end}`
            if (event.location) result += `\n   Location: ${event.location}`
            if (event.attendees && event.attendees.length > 0) {
              result += `\n   Attendees: ${event.attendees.join(', ')}`
            }
            result += `\n   ID: ${event.id}`
            return result
          })

          return `Found ${events.length} event(s):\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 5: Create Calendar Event (requires approval)
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_create_event',
      description: `Create a new calendar event.
IMPORTANT: This action requires user approval before creating.
Date/time format should be ISO 8601 (e.g., "2024-01-15T10:00:00" for datetime or "2024-01-15" for all-day).
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        summary: z.string().describe('Event title'),
        startDateTime: z.string().describe('Start date/time in ISO format'),
        endDateTime: z.string().describe('End date/time in ISO format'),
        description: z.string().optional().describe('Event description'),
        location: z.string().optional().describe('Event location'),
        attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary")')
      }),
      func: async ({ summary, startDateTime, endDateTime, description, location, attendees, calendarId }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const event = await googleWorkspaceService.createEvent(calendarId, {
            summary,
            start: startDateTime,
            end: endDateTime,
            description,
            location,
            attendees
          })

          return `Event created successfully!\nTitle: ${event.summary}\nStart: ${event.start}\nEnd: ${event.end}\nID: ${event.id}`
        } catch (error) {
          return `Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 6: Update Calendar Event (requires approval)
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_update_event',
      description: `Update an existing calendar event.
IMPORTANT: This action requires user approval before updating.
Only provide the fields you want to update.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        eventId: z.string().describe('Event ID to update'),
        summary: z.string().optional().describe('New event title'),
        startDateTime: z.string().optional().describe('New start date/time in ISO format'),
        endDateTime: z.string().optional().describe('New end date/time in ISO format'),
        description: z.string().optional().describe('New event description'),
        location: z.string().optional().describe('New event location'),
        attendees: z.array(z.string()).optional().describe('New list of attendee email addresses'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary")')
      }),
      func: async ({ eventId, summary, startDateTime, endDateTime, description, location, attendees, calendarId }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const event = await googleWorkspaceService.updateEvent(calendarId, eventId, {
            summary,
            start: startDateTime,
            end: endDateTime,
            description,
            location,
            attendees
          })

          return `Event updated successfully!\nTitle: ${event.summary}\nStart: ${event.start}\nEnd: ${event.end}\nID: ${event.id}`
        } catch (error) {
          return `Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= DRIVE TOOLS =============

  // Tool 7: List Drive Files
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_list_files',
      description: `List or search files in Google Drive.
You can optionally filter by:
- Search term in file name
- Folder ID to list files from a specific folder
Returns file name, type, size, and modification time.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        searchTerm: z.string().optional().describe('Optional search term to filter files by name'),
        folderId: z.string().optional().describe('Optional folder ID to list files from'),
        maxResults: z.number().optional().default(50).describe('Maximum number of results (default: 50)')
      }),
      func: async ({ searchTerm, folderId, maxResults }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const query = searchTerm ? `name contains '${searchTerm.replace(/'/g, "\\'")}'` : undefined
          const files = await googleWorkspaceService.listFiles(query, folderId, maxResults)

          if (files.length === 0) {
            return 'No files found' + (searchTerm ? ` matching "${searchTerm}"` : '')
          }

          const results = files.map((file, i) => {
            const modified = new Date(file.modifiedTime).toLocaleString()
            const size = file.size ? `${Math.round(file.size / 1024)} KB` : 'N/A'
            return `${i + 1}. ${file.name}\n   Type: ${file.mimeType}\n   Size: ${size}\n   Modified: ${modified}\n   ID: ${file.id}`
          })

          return `Found ${files.length} file(s):\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 8: Get Drive File Content
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_get_file_content',
      description: `Read the content of a file from Google Drive.
Works with text files, Google Docs (exported as plain text), and Google Sheets (exported as CSV).
Note: Binary files (images, PDFs, etc.) cannot be read as text.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        fileId: z.string().describe('The file ID (from drive_list_files)')
      }),
      func: async ({ fileId }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const content = await googleWorkspaceService.getFileContent(fileId)
          return `File content:\n\n${content}`
        } catch (error) {
          return `Failed to get file content: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= DOCS TOOLS =============

  // Tool 9: Read Google Doc
  tools.push(
    new DynamicStructuredTool({
      name: 'docs_read_document',
      description: `Read the content of a Google Doc.
Returns the document as plain text, preserving structure as much as possible.
You can get the document ID from the URL or from drive_list_files.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        documentId: z.string().describe('The Google Doc ID')
      }),
      func: async ({ documentId }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const doc = await googleWorkspaceService.readDocument(documentId)
          return `Document: ${doc.title}\n\n${doc.body}`
        } catch (error) {
          return `Failed to read document: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 10: Read Google Sheet
  tools.push(
    new DynamicStructuredTool({
      name: 'sheets_read_spreadsheet',
      description: `Read data from a Google Sheet.
Returns the spreadsheet data as formatted text tables.
You can optionally specify a range (e.g., "Sheet1!A1:D10") to read only part of the sheet.
Without a range, reads all sheets in the spreadsheet.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        spreadsheetId: z.string().describe('The Google Sheet ID'),
        range: z.string().optional().describe('Optional range (e.g., "Sheet1!A1:D10")')
      }),
      func: async ({ spreadsheetId, range }) => {
        if (!googleWorkspaceService.isConnected()) {
          return 'Google Workspace is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const spreadsheet = await googleWorkspaceService.readSpreadsheet(spreadsheetId, range)

          let result = `Spreadsheet: ${spreadsheet.title}\n`

          for (const sheet of spreadsheet.sheets) {
            result += `\n--- ${sheet.title} ---\n`
            if (sheet.data.length === 0) {
              result += '(empty)\n'
            } else {
              // Format as table
              for (const row of sheet.data) {
                result += row.join('\t') + '\n'
              }
            }
          }

          return result
        } catch (error) {
          return `Failed to read spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  return tools
}

/**
 * Get the names of Google Workspace tools that require human approval
 */
export function getGoogleWorkspaceInterruptTools(): string[] {
  return ['gmail_send_email', 'calendar_create_event', 'calendar_update_event']
}

/**
 * Tool info for UI display
 */
export interface GoogleWorkspaceToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
  service: 'gmail' | 'calendar' | 'drive' | 'docs'
}

/**
 * Get Google Workspace tool info for the UI settings
 */
export function getGoogleWorkspaceToolInfo(): GoogleWorkspaceToolInfo[] {
  return [
    {
      id: 'gmail_search_emails',
      name: 'Search Emails',
      description: 'Search through Gmail emails using query syntax',
      requireApproval: false,
      service: 'gmail'
    },
    {
      id: 'gmail_get_email',
      name: 'Get Email',
      description: 'Get the full content of a specific email',
      requireApproval: false,
      service: 'gmail'
    },
    {
      id: 'gmail_send_email',
      name: 'Send Email',
      description: 'Send an email through Gmail',
      requireApproval: true,
      service: 'gmail'
    },
    {
      id: 'calendar_get_events',
      name: 'Get Events',
      description: 'List calendar events within a date range',
      requireApproval: false,
      service: 'calendar'
    },
    {
      id: 'calendar_create_event',
      name: 'Create Event',
      description: 'Create a new calendar event',
      requireApproval: true,
      service: 'calendar'
    },
    {
      id: 'calendar_update_event',
      name: 'Update Event',
      description: 'Update an existing calendar event',
      requireApproval: true,
      service: 'calendar'
    },
    {
      id: 'drive_list_files',
      name: 'List Files',
      description: 'List or search files in Google Drive',
      requireApproval: false,
      service: 'drive'
    },
    {
      id: 'drive_get_file_content',
      name: 'Get File Content',
      description: 'Read the content of a file from Drive',
      requireApproval: false,
      service: 'drive'
    },
    {
      id: 'docs_read_document',
      name: 'Read Document',
      description: 'Read the content of a Google Doc',
      requireApproval: false,
      service: 'docs'
    },
    {
      id: 'sheets_read_spreadsheet',
      name: 'Read Spreadsheet',
      description: 'Read data from a Google Sheet',
      requireApproval: false,
      service: 'docs'
    }
  ]
}
