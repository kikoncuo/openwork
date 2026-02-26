/**
 * Google Workspace Agent Tools
 * Tools for the agent to interact with Gmail, Calendar, Drive, and Docs
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { googleWorkspaceService } from './index.js'
import type { SandboxFileAccess } from '../../agent/sandbox-file-access.js'

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} bytes`
}

/**
 * Create Google Workspace tools for the agent
 * These tools allow the agent to interact with Gmail, Calendar, Drive, and Docs
 *
 * @param userId - The user ID to scope Google Workspace operations to
 * @param agentId - The agent ID for accessing sandbox files (optional, needed for file uploads)
 * @param fileAccess - File access abstraction for reading/writing sandbox files
 */
export function createGoogleWorkspaceTools(userId: string, agentId?: string, fileAccess?: SandboxFileAccess): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // ============= GMAIL TOOLS =============

  // Tool 1: Search Emails
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_search_emails',
      description: `Search Gmail messages using Gmail query syntax.
Use this tool to find emails by sender, subject, date, or content.
Examples: "from:john@example.com", "subject:meeting", "is:unread", "after:2024/01/01"
Returns up to 20 emails by default.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('Gmail search query (e.g., "from:john@example.com", "subject:meeting", "is:unread")'),
        maxResults: z.number().optional().default(20).describe('Maximum number of emails to return (default: 20)')
      }),
      func: async ({ query, maxResults }) => {
        try {
          const emails = await googleWorkspaceService.searchEmails(userId, query, maxResults)

          if (emails.length === 0) {
            return `No emails found matching "${query}".`
          }

          const results = emails.map((email, i) => {
            const date = new Date(email.date).toLocaleString()
            return `${i + 1}. [${date}] From: ${email.from}\n   Subject: ${email.subject}\n   ${email.snippet}\n   ID: ${email.id}`
          })

          return `Found ${emails.length} email${emails.length !== 1 ? 's' : ''} matching "${query}":\n\n${results.join('\n\n')}`
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
      description: `Get the full content of an email by its ID.
Use this tool after searching to read the complete email body.
Returns the full email including body, attachment info, Thread ID, and Message-ID (needed for replies).
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        messageId: z.string().describe('The email message ID (from gmail_search_emails)')
      }),
      func: async ({ messageId }) => {
        try {
          const email = await googleWorkspaceService.getEmail(userId, messageId)

          const date = new Date(email.date).toLocaleString()
          const attachments = email.attachments?.length
            ? `\n\nAttachments (${email.attachments.length}):\n${email.attachments.map((a, i) =>
                `  ${i + 1}. ${a.filename}\n     Type: ${a.mimeType}\n     Size: ${formatSize(a.size)}\n     ID: ${a.attachmentId}`
              ).join('\n')}\n\nUse gmail_download_attachment with the attachment ID to download files.`
            : ''

          return `From: ${email.from}
To: ${email.to.join(', ')}${email.cc ? `\nCc: ${email.cc.join(', ')}` : ''}
Date: ${date}
Subject: ${email.subject}
Thread ID: ${email.threadId}
Message-ID: ${email.rfc822MessageId || 'N/A'}
${attachments}

Body:
${email.body}`
        } catch (error) {
          return `Failed to get email: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 3: Send Email
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_send_email',
      description: `Send an email via Gmail, optionally with file attachments.
Attachments should be specified as an array of file paths in the sandbox.
To reply to an existing email, provide inReplyTo (the Message-ID) and threadId from gmail_get_email.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject line'),
        body: z.string().describe('Email body text'),
        cc: z.string().optional().describe('Optional CC recipients (comma-separated)'),
        bcc: z.string().optional().describe('Optional BCC recipients (comma-separated)'),
        attachments: z.array(z.string()).optional().describe(
          'Optional: Array of file paths in the sandbox to attach (e.g., ["/home/user/report.pdf", "/home/user/data.csv"])'
        ),
        inReplyTo: z.string().optional().describe('The Message-ID header of the email being replied to (from gmail_get_email). Set this to reply in the same thread.'),
        threadId: z.string().optional().describe('The thread ID to reply in (from gmail_get_email). Required together with inReplyTo for replies.')
      }),
      func: async ({ to, subject, body, cc, bcc, attachments, inReplyTo, threadId }) => {
        try {
          // Convert string paths to EmailAttachmentInput objects
          const attachmentInputs = attachments?.map((filePath: string) => ({ filePath }))

          // Create file reader function if we have attachments and fileAccess
          let getFileByPath: ((filePath: string) => Promise<{ content: string; encoding?: 'utf8' | 'base64' } | null>) | undefined
          if (attachmentInputs && attachmentInputs.length > 0) {
            if (!fileAccess) {
              return 'ERROR: Cannot attach files - file access not available. Cannot access sandbox files. Please ensure the agent is properly configured.'
            }
            getFileByPath = (filePath: string) => fileAccess.getFile(filePath)
          }

          const result = await googleWorkspaceService.sendEmail(
            userId,
            to,
            subject,
            body,
            cc,
            bcc,
            attachmentInputs,
            getFileByPath,
            inReplyTo,
            threadId
          )

          const attachmentInfo = attachments && attachments.length > 0
            ? `\nAttachments: ${attachments.length} file(s) attached`
            : ''
          return `Email sent successfully!${attachmentInfo}\nMessage ID: ${result.messageId}\nThread ID: ${result.threadId}`
        } catch (error) {
          return `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 4: Modify Email Labels (mark read/unread, add/remove labels)
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_modify_labels',
      description: `Modify labels on a Gmail message. Use this to mark emails as read or unread, or to add/remove other labels.
Common label IDs:
- "UNREAD": Mark as unread (add) or read (remove)
- "STARRED": Star or unstar emails
- "IMPORTANT": Mark as important or not
- "INBOX": Move to inbox or archive (remove)
- "TRASH": Move to trash
- "SPAM": Mark as spam
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.
NOTE: If you previously connected Google Workspace, you may need to disconnect and reconnect to grant the email modify permission.`,
      schema: z.object({
        messageId: z.string().describe('The email message ID (from gmail_search_emails or gmail_get_email)'),
        addLabels: z.array(z.string()).optional().describe('Labels to add (e.g., ["UNREAD"] to mark as unread, ["STARRED"] to star)'),
        removeLabels: z.array(z.string()).optional().describe('Labels to remove (e.g., ["UNREAD"] to mark as read, ["INBOX"] to archive)')
      }),
      func: async ({ messageId, addLabels, removeLabels }) => {
        try {
          const result = await googleWorkspaceService.modifyEmailLabels(
            userId,
            messageId,
            addLabels || [],
            removeLabels || []
          )

          const actions: string[] = []
          if (result.labelsRemoved.includes('UNREAD')) actions.push('marked as read')
          if (result.labelsAdded.includes('UNREAD')) actions.push('marked as unread')
          if (result.labelsAdded.includes('STARRED')) actions.push('starred')
          if (result.labelsRemoved.includes('STARRED')) actions.push('unstarred')
          if (result.labelsAdded.includes('IMPORTANT')) actions.push('marked as important')
          if (result.labelsRemoved.includes('IMPORTANT')) actions.push('unmarked as important')
          if (result.labelsRemoved.includes('INBOX')) actions.push('archived')
          if (result.labelsAdded.includes('INBOX')) actions.push('moved to inbox')
          if (result.labelsAdded.includes('TRASH')) actions.push('moved to trash')
          if (result.labelsAdded.includes('SPAM')) actions.push('marked as spam')

          // Add any other labels
          for (const label of result.labelsAdded) {
            if (!['UNREAD', 'STARRED', 'IMPORTANT', 'INBOX', 'TRASH', 'SPAM'].includes(label)) {
              actions.push(`added label "${label}"`)
            }
          }
          for (const label of result.labelsRemoved) {
            if (!['UNREAD', 'STARRED', 'IMPORTANT', 'INBOX', 'TRASH', 'SPAM'].includes(label)) {
              actions.push(`removed label "${label}"`)
            }
          }

          const actionStr = actions.length > 0 ? actions.join(', ') : 'labels modified'
          return `Email ${actionStr} successfully!\nMessage ID: ${result.messageId}`
        } catch (error) {
          return `Failed to modify email: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 5: Download Email Attachment
  tools.push(
    new DynamicStructuredTool({
      name: 'gmail_download_attachment',
      description: `Download an email attachment and save it to the local sandbox.
Use gmail_get_email first to see available attachments and their IDs.
Supports all file types: PDFs, documents, images, spreadsheets, etc.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        messageId: z.string().describe('The email message ID (from gmail_get_email or gmail_search_emails)'),
        attachmentId: z.string().describe('The attachment ID (from gmail_get_email)'),
        savePath: z.string().optional().describe('Path in sandbox to save (e.g., "/home/user/document.pdf"). Auto-generates if not provided.')
      }),
      func: async ({ messageId, attachmentId, savePath }) => {
        try {
          if (!fileAccess) {
            return 'ERROR: File access not available. Cannot save files to sandbox.'
          }

          const result = await googleWorkspaceService.downloadEmailAttachment(userId, messageId, attachmentId)
          const targetPath = savePath || `/home/user/${result.filename}`

          await fileAccess.saveFile(targetPath, result.content, result.encoding)

          const sizeInBytes = Math.floor(result.content.length * 3 / 4)
          const sizeDisplay = formatSize(sizeInBytes)

          return `Attachment downloaded successfully!\nFilename: ${result.filename}\nType: ${result.mimeType}\nSize: ${sizeDisplay}\nSaved to: ${targetPath}`
        } catch (error) {
          return `Failed to download attachment: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= CONTACTS TOOLS =============

  // Tool: Search Contacts
  tools.push(
    new DynamicStructuredTool({
      name: 'contacts_search',
      description: `Search Google Contacts by name, email, or phone number.
Use this tool to find contact information for people.
If no query is provided, returns your most recently modified contacts.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().optional().describe('Optional search query (name, email, or phone). Leave empty to list all contacts.'),
        maxResults: z.number().optional().default(20).describe('Maximum number of contacts to return (default: 20)')
      }),
      func: async ({ query, maxResults }) => {
        try {
          const contacts = await googleWorkspaceService.searchContacts(userId, query, maxResults)

          if (contacts.length === 0) {
            return query
              ? `No contacts found matching "${query}".`
              : 'No contacts found. Your Google Contacts may be empty.'
          }

          const results = contacts.map((contact, i) => {
            const parts: string[] = []
            if (contact.name) parts.push(`Name: ${contact.name}`)
            if (contact.emails.length > 0) parts.push(`Email: ${contact.emails.join(', ')}`)
            if (contact.phones.length > 0) parts.push(`Phone: ${contact.phones.join(', ')}`)
            if (contact.organization) {
              const orgStr = contact.title
                ? `${contact.title} at ${contact.organization}`
                : contact.organization
              parts.push(`Work: ${orgStr}`)
            }
            return `${i + 1}. ${parts.join('\n   ')}`
          })

          const header = query
            ? `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''} matching "${query}":`
            : `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}:`

          return `${header}\n\n${results.join('\n\n')}`
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          if (errMsg.includes('403') || errMsg.includes('permission')) {
            return 'ERROR: Permission denied. You may need to disconnect and reconnect Google Workspace to grant contacts access.'
          }
          return `Failed to search contacts: ${errMsg}`
        }
      }
    })
  )

  // ============= CALENDAR TOOLS =============

  // Tool: Get Calendar Events
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_get_events',
      description: `List calendar events within a date range.
Use this tool to check meetings, appointments, and events.
Dates should be in ISO format (e.g., "2024-01-15T00:00:00Z").
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        startDate: z.string().describe('Start date in ISO format (e.g., "2024-01-15T00:00:00Z")'),
        endDate: z.string().describe('End date in ISO format (e.g., "2024-01-22T23:59:59Z")'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary")'),
        maxResults: z.number().optional().default(50).describe('Maximum number of events to return (default: 50)')
      }),
      func: async ({ startDate, endDate, calendarId, maxResults }) => {
        try {
          const events = await googleWorkspaceService.getEvents(userId, calendarId, startDate, endDate, maxResults)

          if (events.length === 0) {
            return `No events found between ${startDate} and ${endDate}.`
          }

          const results = events.map((event, i) => {
            const start = event.start.includes('T') ? new Date(event.start).toLocaleString() : event.start
            const end = event.end.includes('T') ? new Date(event.end).toLocaleString() : event.end
            const attendees = event.attendees?.length ? `\n   Attendees: ${event.attendees.join(', ')}` : ''
            const location = event.location ? `\n   Location: ${event.location}` : ''
            return `${i + 1}. ${event.summary}\n   ${start} - ${end}${location}${attendees}\n   ID: ${event.id}`
          })

          return `Found ${events.length} event${events.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 5: Create Calendar Event
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_create_event',
      description: `Create a new calendar event.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        summary: z.string().describe('Event title'),
        start: z.string().describe('Start time in ISO format (e.g., "2024-01-15T10:00:00Z") or date only (e.g., "2024-01-15" for all-day)'),
        end: z.string().describe('End time in ISO format (e.g., "2024-01-15T11:00:00Z") or date only'),
        description: z.string().optional().describe('Optional event description'),
        location: z.string().optional().describe('Optional event location'),
        attendees: z.array(z.string()).optional().describe('Optional list of attendee email addresses'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary")')
      }),
      func: async ({ summary, start, end, description, location, attendees, calendarId }) => {
        try {
          const event = await googleWorkspaceService.createEvent(userId, calendarId, {
            summary,
            start,
            end,
            description,
            location,
            attendees
          })
          return `Event created successfully!\nTitle: ${event.summary}\nTime: ${event.start} - ${event.end}\nEvent ID: ${event.id}`
        } catch (error) {
          return `Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 6: Update Calendar Event
  tools.push(
    new DynamicStructuredTool({
      name: 'calendar_update_event',
      description: `Update an existing calendar event.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        eventId: z.string().describe('The event ID to update (from calendar_get_events)'),
        summary: z.string().optional().describe('New event title'),
        start: z.string().optional().describe('New start time in ISO format'),
        end: z.string().optional().describe('New end time in ISO format'),
        description: z.string().optional().describe('New event description'),
        location: z.string().optional().describe('New event location'),
        attendees: z.array(z.string()).optional().describe('New list of attendee email addresses'),
        calendarId: z.string().optional().default('primary').describe('Calendar ID (default: "primary")')
      }),
      func: async ({ eventId, summary, start, end, description, location, attendees, calendarId }) => {
        try {
          const event = await googleWorkspaceService.updateEvent(userId, calendarId, eventId, {
            summary,
            start,
            end,
            description,
            location,
            attendees
          })
          return `Event updated successfully!\nTitle: ${event.summary}\nTime: ${event.start} - ${event.end}`
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
Use this tool to find documents, spreadsheets, and other files.
You can search by name or list files in a specific folder.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().optional().describe('Optional search query to filter files by name'),
        folderId: z.string().optional().describe('Optional folder ID to list files within'),
        maxResults: z.number().optional().default(50).describe('Maximum number of files to return (default: 50)')
      }),
      func: async ({ query, folderId, maxResults }) => {
        try {
          const files = await googleWorkspaceService.listFiles(userId, query, folderId, maxResults)

          if (files.length === 0) {
            return query ? `No files found matching "${query}".` : 'No files found.'
          }

          const results = files.map((file, i) => {
            const size = file.size ? ` (${Math.round(file.size / 1024)} KB)` : ''
            const modified = new Date(file.modifiedTime).toLocaleString()
            return `${i + 1}. ${file.name}${size}\n   Type: ${file.mimeType}\n   Modified: ${modified}\n   ID: ${file.id}`
          })

          return `Found ${files.length} file${files.length !== 1 ? 's' : ''}${query ? ` matching "${query}"` : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 8: Get File Content
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_get_file_content',
      description: `Download and read the content of a file from Google Drive.
Works with Google Docs, Sheets (as CSV), and text files.
Use the file ID from drive_list_files.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        fileId: z.string().describe('The file ID to read (from drive_list_files)')
      }),
      func: async ({ fileId }) => {
        try {
          const content = await googleWorkspaceService.getFileContent(userId, fileId)
          return `File content:\n\n${content}`
        } catch (error) {
          return `Failed to get file content: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool: Upload File to Drive
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_upload_file',
      description: `Upload a file from the sandbox to Google Drive.
Provide the full path to the file in the sandbox (e.g., "/home/user/document.pdf").
The file will be uploaded with automatic MIME type detection.
Markdown files (.md) are automatically converted to formatted Google Docs with proper headings, tables, lists, and styling.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        filePath: z.string().describe('Full path to the file in the sandbox (e.g., "/home/user/document.pdf")'),
        targetName: z.string().optional().describe('Optional: rename the file in Drive (defaults to original filename)'),
        folderId: z.string().optional().describe('Optional: folder ID to upload into (defaults to root)')
      }),
      func: async ({ filePath, targetName, folderId }) => {
        try {
          // Read file from sandbox
          if (!fileAccess) {
            return 'ERROR: File access not available. Cannot access sandbox files. Please ensure the agent is properly configured.'
          }

          const file = await fileAccess.getFile(filePath)
          if (!file) {
            return `ERROR: File not found at path "${filePath}" in the sandbox. Please verify the file exists using ls or read_file first.`
          }

          // Determine filename and mime type
          const path = await import('path')
          const mime = await import('mime-types')
          const fileName = targetName || path.basename(filePath)
          const ext = path.extname(filePath).toLowerCase()
          const mimeType = mime.lookup(filePath) || 'application/octet-stream'

          // Markdown files → create a formatted Google Doc instead of raw upload
          if (ext === '.md' || ext === '.markdown') {
            const docTitle = (targetName || path.basename(filePath)).replace(/\.(md|markdown)$/i, '')
            const result = await googleWorkspaceService.createDocument(userId, docTitle, file.content, fileAccess)
            return `Markdown file converted to Google Doc!\nTitle: ${result.title}\nDocument ID: ${result.documentId}`
          }

          // Handle content based on encoding
          // Binary files are stored as base64 and need to be decoded before upload
          let content: string | Buffer
          if (file.encoding === 'base64') {
            // Decode base64 to Buffer for binary files
            content = Buffer.from(file.content, 'base64')
          } else {
            // Text files use content directly
            content = file.content
          }

          // Upload the content
          const result = await googleWorkspaceService.uploadFile(userId, fileName, content, mimeType, folderId)
          return `File uploaded successfully!\nName: ${result.name}\nFile ID: ${result.fileId}\nType: ${result.mimeType}${result.webViewLink ? `\nLink: ${result.webViewLink}` : ''}`
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          return `Failed to upload file: ${errMsg}`
        }
      }
    })
  )

  // Tool: Download File from Drive
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_download_file',
      description: `Download a file from Google Drive and save it to the local sandbox.
Provide a savePath to save the file locally (e.g., "/home/user/document.pdf").
For Google Docs/Sheets/Slides, automatically exports to text/CSV/PDF.
Use the file ID from drive_list_files.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        fileId: z.string().describe('The file ID to download (from drive_list_files)'),
        savePath: z.string().optional().describe('Path in the sandbox to save the file (e.g., "/home/user/document.pdf"). If not provided, the file will be saved to /home/user/ with its original name.')
      }),
      func: async ({ fileId, savePath }) => {
        try {
          // Check if we have file access for saving files
          if (!fileAccess) {
            return 'ERROR: File access not available. Cannot save files to sandbox. Please ensure the agent is properly configured.'
          }

          const result = await googleWorkspaceService.downloadFile(userId, fileId)

          // Determine the save path
          const targetPath = savePath || `/home/user/${result.name}`

          // Save the file using the encoding returned by downloadFile
          // - utf8 for exported Google Docs/Sheets (text content)
          // - base64 for binary files (PDFs, images, etc.)
          await fileAccess.saveFile(targetPath, result.content, result.encoding)

          // Calculate file size
          const sizeInBytes = result.encoding === 'base64'
            ? Math.floor(result.content.length * 3 / 4) // base64 to bytes approximation
            : result.content.length
          const sizeDisplay = sizeInBytes > 1024 * 1024
            ? `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
            : sizeInBytes > 1024
              ? `${(sizeInBytes / 1024).toFixed(1)} KB`
              : `${sizeInBytes} bytes`

          return `File downloaded and saved successfully!\nName: ${result.name}\nType: ${result.mimeType}\nSize: ${sizeDisplay}\nSaved to: ${targetPath}`
        } catch (error) {
          return `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool: Manage Files (create folder, delete, move)
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_manage_files',
      description: `Manage files and folders in Google Drive: create folders, delete files, or move files.

Actions:
- "create_folder": Create a new folder. Requires: name. Optional: parentId.
- "delete": Permanently delete a file/folder. Requires: fileId. WARNING: Cannot be undone!
- "move": Move a file/folder to a new location. Requires: fileId, destinationFolderId.

IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        action: z.enum(['create_folder', 'delete', 'move']).describe('The action to perform'),
        fileId: z.string().optional().describe('File/folder ID (required for delete and move)'),
        name: z.string().optional().describe('Name for new folder (required for create_folder)'),
        parentId: z.string().optional().describe('Parent folder ID (optional for create_folder)'),
        destinationFolderId: z.string().optional().describe('Destination folder ID (required for move)')
      }),
      func: async ({ action, fileId, name, parentId, destinationFolderId }) => {
        try {
          switch (action) {
            case 'create_folder': {
              if (!name) {
                return 'ERROR: "name" is required for create_folder action. Please provide a name for the new folder.'
              }
              const result = await googleWorkspaceService.createFolder(userId, name, parentId)
              return `Folder created successfully!\nName: ${result.name}\nFolder ID: ${result.folderId}${result.webViewLink ? `\nLink: ${result.webViewLink}` : ''}`
            }
            case 'delete': {
              if (!fileId) {
                return 'ERROR: "fileId" is required for delete action. Use drive_list_files to find the file ID.'
              }
              await googleWorkspaceService.deleteFile(userId, fileId)
              return `File/folder deleted successfully!\nDeleted ID: ${fileId}`
            }
            case 'move': {
              if (!fileId) {
                return 'ERROR: "fileId" is required for move action. Use drive_list_files to find the file ID.'
              }
              if (!destinationFolderId) {
                return 'ERROR: "destinationFolderId" is required for move action. Use drive_list_files to find the destination folder ID.'
              }
              const result = await googleWorkspaceService.moveFile(userId, fileId, destinationFolderId)
              return `File moved successfully!\nName: ${result.name}\nFile ID: ${result.id}\nNew location: ${destinationFolderId}`
            }
            default:
              return `ERROR: Unknown action "${action}". Valid actions are: create_folder, delete, move.`
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          // Provide helpful error messages based on common issues
          if (errMsg.includes('404') || errMsg.includes('not found')) {
            return `ERROR: File or folder not found. The fileId "${fileId}" may be invalid or the file was already deleted. Use drive_list_files to find valid file IDs.`
          }
          if (errMsg.includes('403') || errMsg.includes('permission')) {
            return `ERROR: Permission denied. You may not have access to this file/folder, or it may be owned by someone else.`
          }
          return `Failed to ${action}: ${errMsg}`
        }
      }
    })
  )

  // Tool: Manage Sharing Permissions
  tools.push(
    new DynamicStructuredTool({
      name: 'drive_manage_sharing',
      description: `Manage sharing permissions for Google Drive files and folders.

Actions:
- "share": Share with a specific user. Requires: fileId, email. Optional: role (reader/writer/commenter), sendNotification.
- "make_public": Make accessible to anyone with the link. Requires: fileId. Optional: role.
- "list": View current permissions. Requires: fileId.
- "remove": Remove a sharing permission. Requires: fileId, permissionId (get from "list" action).

Roles: "reader" (view only), "writer" (can edit), "commenter" (can comment). Default is "reader".

IMPORTANT: Sharing actions require human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        action: z.enum(['share', 'make_public', 'list', 'remove']).describe('The sharing action to perform'),
        fileId: z.string().describe('The file or folder ID'),
        email: z.string().optional().describe('Email address to share with (required for "share" action)'),
        role: z.enum(['reader', 'writer', 'commenter']).optional().default('reader').describe('Permission level'),
        permissionId: z.string().optional().describe('Permission ID to remove (required for "remove" action, get from "list")'),
        sendNotification: z.boolean().optional().default(true).describe('Send email notification (for "share" action)')
      }),
      func: async ({ action, fileId, email, role, permissionId, sendNotification }) => {
        try {
          switch (action) {
            case 'share': {
              if (!email) {
                return 'ERROR: "email" is required for share action. Please provide the email address of the person to share with.'
              }
              // Validate email format
              if (!email.includes('@') || !email.includes('.')) {
                return `ERROR: "${email}" does not appear to be a valid email address. Please provide a valid email.`
              }
              const result = await googleWorkspaceService.shareFile(userId, fileId, email, role || 'reader', sendNotification ?? true)
              const roleDesc = role === 'writer' ? 'edit' : role === 'commenter' ? 'comment on' : 'view'
              return `File shared successfully!\nShared with: ${result.email}\nRole: ${result.role} (can ${roleDesc})\nPermission ID: ${result.permissionId}`
            }
            case 'make_public': {
              const result = await googleWorkspaceService.shareFilePublic(userId, fileId, role || 'reader')
              const roleDesc = role === 'writer' ? 'edit' : role === 'commenter' ? 'comment on' : 'view'
              return `File is now publicly accessible!\nAnyone with the link can ${roleDesc} this file.\nTo undo this, use action "remove" with permissionId: ${result.permissionId}`
            }
            case 'list': {
              const permissions = await googleWorkspaceService.getFilePermissions(userId, fileId)
              if (permissions.length === 0) {
                return 'This file is private (no sharing permissions). Only the owner can access it.'
              }
              const results = permissions.map((p, i) => {
                const who = p.type === 'anyone' ? 'Anyone with link' : (p.email || `${p.type} (domain)`)
                return `${i + 1}. ${who}\n   Role: ${p.role}\n   Permission ID: ${p.id}`
              })
              return `Current sharing permissions:\n\n${results.join('\n\n')}\n\nTo remove a permission, use action "remove" with the permission ID.`
            }
            case 'remove': {
              if (!permissionId) {
                return 'ERROR: "permissionId" is required for remove action. Use action "list" first to get the permission ID you want to remove.'
              }
              await googleWorkspaceService.removeSharing(userId, fileId, permissionId)
              return `Sharing permission removed successfully!\nRemoved permission ID: ${permissionId}`
            }
            default:
              return `ERROR: Unknown action "${action}". Valid actions are: share, make_public, list, remove.`
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          // Provide helpful error messages
          if (errMsg.includes('404') || errMsg.includes('not found')) {
            if (action === 'remove') {
              return `ERROR: Permission not found. The permissionId "${permissionId}" may be invalid or already removed. Use action "list" to see current permissions.`
            }
            return `ERROR: File not found. The fileId "${fileId}" may be invalid. Use drive_list_files to find valid file IDs.`
          }
          if (errMsg.includes('403') || errMsg.includes('permission')) {
            return `ERROR: Permission denied. You may not have permission to change sharing settings for this file. Only the owner or users with "writer" access can manage sharing.`
          }
          if (errMsg.includes('invalid') && email) {
            return `ERROR: Invalid email address "${email}". Please check the email and try again.`
          }
          return `Failed to ${action}: ${errMsg}`
        }
      }
    })
  )

  // ============= DOCS TOOLS =============

  // Tool 9: Read Google Doc
  tools.push(
    new DynamicStructuredTool({
      name: 'docs_read_document',
      description: `Read the content of a Google Document.
Use the document ID from drive_list_files or from the document URL.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        documentId: z.string().describe('The Google Doc ID (from URL or drive_list_files)')
      }),
      func: async ({ documentId }) => {
        try {
          const doc = await googleWorkspaceService.readDocument(userId, documentId)
          return `Document: ${doc.title}\n\nContent:\n${doc.body}`
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
      description: `Read data from a Google Spreadsheet.
Use the spreadsheet ID from drive_list_files or from the spreadsheet URL.
Optionally specify a range (e.g., "Sheet1!A1:D10").
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        spreadsheetId: z.string().describe('The Google Sheet ID (from URL or drive_list_files)'),
        range: z.string().optional().describe('Optional range to read (e.g., "Sheet1!A1:D10")')
      }),
      func: async ({ spreadsheetId, range }) => {
        try {
          const spreadsheet = await googleWorkspaceService.readSpreadsheet(userId, spreadsheetId, range)

          const results = spreadsheet.sheets.map(sheet => {
            const dataStr = sheet.data.map(row => row.join('\t')).join('\n')
            return `Sheet: ${sheet.title}\n${dataStr}`
          })

          return `Spreadsheet: ${spreadsheet.title}\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to read spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool: Edit Google Document
  tools.push(
    new DynamicStructuredTool({
      name: 'docs_edit_document',
      description: `Create or edit Google Documents.

Actions:
- "create": Create a new document. Requires: title. Optional: content.
- "append": Add text to the end of an existing document. Requires: documentId, content.
- "replace": Replace all content in a document. Requires: documentId, content. WARNING: Overwrites existing content!

The content parameter supports markdown formatting that is automatically converted to native Google Docs formatting:
- Headings: # H1 through ###### H6
- Bold: **text**, Italic: *text*, Bold+Italic: ***text***
- Inline code: \`code\`, Code blocks: \`\`\`lang ... \`\`\`
- Bullet lists: - item or * item
- Numbered lists: 1. item
- Tables: pipe-delimited markdown tables with | Header | and |---| separator
- Images: ![alt text](path/to/image.png) — inserts image from the sandbox filesystem
- Links: [text](url) — creates clickable hyperlinks
- Horizontal rules: ---

IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        action: z.enum(['create', 'append', 'replace']).describe('The action to perform'),
        documentId: z.string().optional().describe('Document ID (required for append and replace, get from drive_list_files or URL)'),
        title: z.string().optional().describe('Title for new document (required for create)'),
        content: z.string().optional().describe('Content in markdown format. Supports headings (#), bold (**), italic (*), lists (- or 1.), tables (| col | col |), code (`), images (![alt](path)), and links ([text](url)).')
      }),
      func: async ({ action, documentId, title, content }) => {
        try {
          switch (action) {
            case 'create': {
              if (!title) {
                return 'ERROR: "title" is required for create action. Please provide a title for the new document.'
              }
              const result = await googleWorkspaceService.createDocument(userId, title, content, fileAccess)
              return `Document created successfully!\nTitle: ${result.title}\nDocument ID: ${result.documentId}\n\nYou can now use this documentId to read or edit the document.`
            }
            case 'append': {
              if (!documentId) {
                return 'ERROR: "documentId" is required for append action. Use drive_list_files to find the document ID, or extract it from the document URL.'
              }
              if (!content) {
                return 'ERROR: "content" is required for append action. Please provide the text to append to the document.'
              }
              const result = await googleWorkspaceService.appendToDocument(userId, documentId, content, fileAccess)
              return `Content appended successfully!\nDocument: ${result.title}\nDocument ID: ${result.documentId}`
            }
            case 'replace': {
              if (!documentId) {
                return 'ERROR: "documentId" is required for replace action. Use drive_list_files to find the document ID, or extract it from the document URL.'
              }
              if (!content) {
                return 'ERROR: "content" is required for replace action. Please provide the new content for the document.'
              }
              const result = await googleWorkspaceService.replaceDocumentContent(userId, documentId, content, fileAccess)
              return `Document content replaced successfully!\nDocument: ${result.title}\nDocument ID: ${result.documentId}\n\nAll previous content has been replaced with the new content.`
            }
            default:
              return `ERROR: Unknown action "${action}". Valid actions are: create, append, replace.`
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          if (errMsg.includes('404') || errMsg.includes('not found')) {
            return `ERROR: Document not found. The documentId "${documentId}" may be invalid. Use drive_list_files to find valid document IDs, or check the URL of the document.`
          }
          if (errMsg.includes('403') || errMsg.includes('permission')) {
            return `ERROR: Permission denied. You may not have edit access to this document. The document owner needs to share it with you as an editor.`
          }
          return `Failed to ${action} document: ${errMsg}`
        }
      }
    })
  )

  // Tool: Edit Google Spreadsheet
  tools.push(
    new DynamicStructuredTool({
      name: 'sheets_edit_spreadsheet',
      description: `Create or edit Google Spreadsheets.

Actions:
- "create": Create a new spreadsheet. Requires: title. Optional: values (initial data as 2D array).
- "update": Update cells at a specific range. Requires: spreadsheetId, range, values.
- "append": Add rows to the end of existing data. Requires: spreadsheetId, values. Optional: range (defaults to Sheet1).

Range format: Use A1 notation like "Sheet1!A1:C3" or "Sheet1!A:Z" or just "Sheet1".
Values format: 2D array of strings, e.g., [["Name", "Age"], ["Alice", "30"], ["Bob", "25"]]

IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Google Workspace is connected in Settings > Apps.`,
      schema: z.object({
        action: z.enum(['create', 'update', 'append']).describe('The action to perform'),
        spreadsheetId: z.string().optional().describe('Spreadsheet ID (required for update and append)'),
        title: z.string().optional().describe('Title for new spreadsheet (required for create)'),
        range: z.string().optional().describe('Cell range in A1 notation (required for update, optional for append)'),
        values: z.array(z.array(z.string())).optional().describe('Data as 2D array: [[row1col1, row1col2], [row2col1, row2col2]]')
      }),
      func: async ({ action, spreadsheetId, title, range, values }) => {
        try {
          switch (action) {
            case 'create': {
              if (!title) {
                return 'ERROR: "title" is required for create action. Please provide a title for the new spreadsheet.'
              }
              const result = await googleWorkspaceService.createSpreadsheet(userId, title, values)
              const dataInfo = values ? `\nInitial data: ${values.length} rows` : ''
              return `Spreadsheet created successfully!\nTitle: ${result.title}\nSpreadsheet ID: ${result.spreadsheetId}${dataInfo}\n\nYou can now use this spreadsheetId to read or edit the spreadsheet.`
            }
            case 'update': {
              if (!spreadsheetId) {
                return 'ERROR: "spreadsheetId" is required for update action. Use drive_list_files to find the spreadsheet ID, or extract it from the spreadsheet URL.'
              }
              if (!range) {
                return 'ERROR: "range" is required for update action. Specify the cells to update using A1 notation (e.g., "Sheet1!A1:C3").'
              }
              if (!values || values.length === 0) {
                return 'ERROR: "values" is required for update action. Provide data as a 2D array (e.g., [["A1", "B1"], ["A2", "B2"]]).'
              }
              const result = await googleWorkspaceService.updateSpreadsheet(userId, spreadsheetId, range, values)
              return `Spreadsheet updated successfully!\nRange: ${result.updatedRange}\nUpdated: ${result.updatedRows} rows, ${result.updatedColumns} columns (${result.updatedCells} cells total)`
            }
            case 'append': {
              if (!spreadsheetId) {
                return 'ERROR: "spreadsheetId" is required for append action. Use drive_list_files to find the spreadsheet ID, or extract it from the spreadsheet URL.'
              }
              if (!values || values.length === 0) {
                return 'ERROR: "values" is required for append action. Provide the rows to add as a 2D array (e.g., [["Name", "Age"], ["Alice", "30"]]).'
              }
              const appendRange = range || 'Sheet1'
              const result = await googleWorkspaceService.appendToSpreadsheet(userId, spreadsheetId, appendRange, values)
              return `Rows appended successfully!\nRange: ${result.updatedRange}\nAdded: ${result.updatedRows} rows (${result.updatedCells} cells total)`
            }
            default:
              return `ERROR: Unknown action "${action}". Valid actions are: create, update, append.`
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error'
          if (errMsg.includes('404') || errMsg.includes('not found')) {
            return `ERROR: Spreadsheet not found. The spreadsheetId "${spreadsheetId}" may be invalid. Use drive_list_files to find valid spreadsheet IDs, or check the URL of the spreadsheet.`
          }
          if (errMsg.includes('403') || errMsg.includes('permission')) {
            return `ERROR: Permission denied. You may not have edit access to this spreadsheet. The spreadsheet owner needs to share it with you as an editor.`
          }
          if (errMsg.includes('range') || errMsg.includes('Unable to parse range')) {
            return `ERROR: Invalid range "${range}". Use A1 notation like "Sheet1!A1:C3" or "Sheet1!A:Z". Make sure the sheet name exists in the spreadsheet.`
          }
          return `Failed to ${action} spreadsheet: ${errMsg}`
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
  return [
    // Gmail
    'gmail_send_email',
    'gmail_modify_labels',
    // Calendar
    'calendar_create_event',
    'calendar_update_event',
    // Drive
    'drive_upload_file',
    'drive_manage_files',
    'drive_manage_sharing',
    // Docs & Sheets
    'docs_edit_document',
    'sheets_edit_spreadsheet'
  ]
}

/**
 * Tool info for UI display
 */
export interface GoogleToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
  service: 'gmail' | 'contacts' | 'calendar' | 'drive' | 'docs'
}

/**
 * Get Google Workspace tool info for the UI settings
 * Returns tool metadata that can be displayed in the Tools tab
 */
export function getGoogleWorkspaceToolInfo(): GoogleToolInfo[] {
  return [
    // Gmail Tools
    {
      id: 'gmail_search_emails',
      name: 'Search Emails',
      description: 'Search Gmail messages using Gmail query syntax',
      requireApproval: false,
      service: 'gmail'
    },
    {
      id: 'gmail_get_email',
      name: 'Get Email',
      description: 'Get full email content including body and attachments',
      requireApproval: false,
      service: 'gmail'
    },
    {
      id: 'gmail_send_email',
      name: 'Send Email',
      description: 'Send an email to specified recipients',
      requireApproval: true,
      service: 'gmail'
    },
    {
      id: 'gmail_modify_labels',
      name: 'Modify Email Labels',
      description: 'Mark emails as read/unread, star, archive, or modify labels',
      requireApproval: true,
      service: 'gmail'
    },
    {
      id: 'gmail_download_attachment',
      name: 'Download Email Attachment',
      description: 'Download email attachments (PDFs, docs, images, etc.)',
      requireApproval: false,
      service: 'gmail'
    },
    // Contacts Tools
    {
      id: 'contacts_search',
      name: 'Search Contacts',
      description: 'Search Google Contacts by name, email, or phone',
      requireApproval: false,
      service: 'contacts'
    },
    // Calendar Tools
    {
      id: 'calendar_get_events',
      name: 'Get Calendar Events',
      description: 'List calendar events within a date range',
      requireApproval: false,
      service: 'calendar'
    },
    {
      id: 'calendar_create_event',
      name: 'Create Calendar Event',
      description: 'Create a new calendar event',
      requireApproval: true,
      service: 'calendar'
    },
    {
      id: 'calendar_update_event',
      name: 'Update Calendar Event',
      description: 'Update an existing calendar event',
      requireApproval: true,
      service: 'calendar'
    },
    // Drive Tools
    {
      id: 'drive_list_files',
      name: 'List Drive Files',
      description: 'List or search files in Google Drive',
      requireApproval: false,
      service: 'drive'
    },
    {
      id: 'drive_get_file_content',
      name: 'Get File Content',
      description: 'Read file content from Google Drive',
      requireApproval: false,
      service: 'drive'
    },
    {
      id: 'drive_upload_file',
      name: 'Upload File',
      description: 'Upload a file from local filesystem to Google Drive',
      requireApproval: true,
      service: 'drive'
    },
    {
      id: 'drive_download_file',
      name: 'Download File',
      description: 'Download a file from Google Drive',
      requireApproval: false,
      service: 'drive'
    },
    {
      id: 'drive_manage_files',
      name: 'Manage Files',
      description: 'Create folders, delete files, or move files in Google Drive',
      requireApproval: true,
      service: 'drive'
    },
    {
      id: 'drive_manage_sharing',
      name: 'Manage Sharing',
      description: 'Share files, make public, view or remove permissions',
      requireApproval: true,
      service: 'drive'
    },
    // Docs Tools
    {
      id: 'docs_read_document',
      name: 'Read Google Doc',
      description: 'Read content from a Google Document',
      requireApproval: false,
      service: 'docs'
    },
    {
      id: 'docs_edit_document',
      name: 'Edit Google Doc',
      description: 'Create, append to, or replace content in Google Documents',
      requireApproval: true,
      service: 'docs'
    },
    {
      id: 'sheets_read_spreadsheet',
      name: 'Read Google Sheet',
      description: 'Read data from a Google Spreadsheet',
      requireApproval: false,
      service: 'docs'
    },
    {
      id: 'sheets_edit_spreadsheet',
      name: 'Edit Google Sheet',
      description: 'Create, update cells, or append rows in Google Spreadsheets',
      requireApproval: true,
      service: 'docs'
    }
  ]
}
