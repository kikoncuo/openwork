/**
 * Google Workspace Tools Tests
 * Run with: npx tsx src/services/apps/__tests__/google-workspace-tools.test.ts
 */

import assert from 'node:assert'

// Simple test framework with proper async handling
let testCount = 0
let passCount = 0
let failCount = 0

async function describe(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`)
  await fn()
}

async function it(name: string, fn: () => void | Promise<void>) {
  testCount++
  try {
    await fn()
    passCount++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failCount++
    console.log(`  ✗ ${name}`)
    console.log(`    Error: ${(error as Error).message}`)
  }
}

// Mock data for testing
const mockEmails = [
  {
    id: 'email-1',
    threadId: 'thread-1',
    subject: 'Meeting Tomorrow',
    from: 'john@example.com',
    date: Date.now() - 3600000,
    snippet: 'Reminder about our meeting...'
  },
  {
    id: 'email-2',
    threadId: 'thread-2',
    subject: 'Project Update',
    from: 'jane@example.com',
    date: Date.now() - 7200000,
    snippet: 'Here is the latest update...'
  }
]

const mockEmailDetail = {
  ...mockEmails[0],
  to: ['me@example.com'],
  cc: ['team@example.com'],
  body: 'This is the full email body content.',
  attachments: [
    { filename: 'document.pdf', mimeType: 'application/pdf', size: 1024, attachmentId: 'att-1' }
  ]
}

const mockContacts = [
  {
    resourceName: 'people/1',
    name: 'John Doe',
    emails: ['john@example.com'],
    phones: ['+1234567890'],
    organization: 'Acme Corp',
    title: 'Engineer'
  }
]

const mockEvents = [
  {
    id: 'event-1',
    summary: 'Team Meeting',
    description: 'Weekly sync',
    start: '2024-01-15T10:00:00Z',
    end: '2024-01-15T11:00:00Z',
    attendees: ['john@example.com', 'jane@example.com'],
    location: 'Conference Room A'
  }
]

const mockFiles = [
  {
    id: 'file-1',
    name: 'Project Plan.docx',
    mimeType: 'application/vnd.google-apps.document',
    size: 2048,
    modifiedTime: '2024-01-15T10:00:00Z',
    webViewLink: 'https://docs.google.com/document/d/file-1'
  },
  {
    id: 'file-2',
    name: 'Budget.xlsx',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    size: 4096,
    modifiedTime: '2024-01-14T15:00:00Z'
  }
]

// Mock Google Workspace Service
class MockGoogleWorkspaceService {
  private connected = false
  private shouldFail = false
  private failType: 'notFound' | 'permission' | 'generic' | null = null

  // Control methods for testing
  setConnected(value: boolean) {
    this.connected = value
  }

  setFailure(type: 'notFound' | 'permission' | 'generic' | null) {
    this.shouldFail = type !== null
    this.failType = type
  }

  private checkFailure() {
    if (this.shouldFail) {
      switch (this.failType) {
        case 'notFound':
          throw new Error('404 Not Found')
        case 'permission':
          throw new Error('403 Permission denied')
        case 'generic':
          throw new Error('Something went wrong')
      }
    }
  }

  // Service methods
  isConnected(_userId: string): boolean {
    return this.connected
  }

  async searchEmails(_userId: string, query: string, _maxResults?: number) {
    this.checkFailure()
    if (query === 'no-results') return []
    return mockEmails
  }

  async getEmail(_userId: string, _messageId: string) {
    this.checkFailure()
    return mockEmailDetail
  }

  async sendEmail(_userId: string, _to: string, _subject: string, _body: string, _cc?: string, _bcc?: string) {
    this.checkFailure()
    return { messageId: 'sent-msg-1', threadId: 'sent-thread-1' }
  }

  async modifyEmailLabels(_userId: string, _messageId: string, addLabels: string[], removeLabels: string[]) {
    this.checkFailure()
    return { messageId: 'email-1', labelsAdded: addLabels, labelsRemoved: removeLabels }
  }

  async searchContacts(_userId: string, _query?: string, _maxResults?: number) {
    this.checkFailure()
    return mockContacts
  }

  async getEvents(_userId: string, _calendarId: string, _startDate: string, _endDate: string, _maxResults?: number) {
    this.checkFailure()
    return mockEvents
  }

  async createEvent(_userId: string, _calendarId: string, event: { summary: string; start: string; end: string }) {
    this.checkFailure()
    return { id: 'new-event-1', ...event }
  }

  async updateEvent(_userId: string, _calendarId: string, _eventId: string, updates: { summary?: string; start?: string; end?: string }) {
    this.checkFailure()
    return { id: 'event-1', summary: updates.summary || 'Updated Event', start: updates.start || '2024-01-15T10:00:00Z', end: updates.end || '2024-01-15T11:00:00Z' }
  }

  async listFiles(_userId: string, query?: string, _folderId?: string, _maxResults?: number) {
    this.checkFailure()
    if (query === 'no-results') return []
    return mockFiles
  }

  async getFileContent(_userId: string, _fileId: string) {
    this.checkFailure()
    return 'File content here'
  }

  async uploadFile(_userId: string, name: string, _content: string, mimeType: string, _folderId?: string) {
    this.checkFailure()
    return { fileId: 'uploaded-1', name, mimeType, webViewLink: 'https://drive.google.com/file/uploaded-1' }
  }

  async downloadFile(_userId: string, _fileId: string) {
    this.checkFailure()
    return { name: 'downloaded.pdf', mimeType: 'application/pdf', content: 'base64content' }
  }

  async createFolder(_userId: string, name: string, _parentId?: string) {
    this.checkFailure()
    return { folderId: 'folder-1', name, webViewLink: 'https://drive.google.com/folder/folder-1' }
  }

  async deleteFile(_userId: string, _fileId: string) {
    this.checkFailure()
  }

  async moveFile(_userId: string, fileId: string, _destinationFolderId: string) {
    this.checkFailure()
    return { id: fileId, name: 'Moved File' }
  }

  async shareFile(_userId: string, _fileId: string, email: string, role: string, _sendNotification: boolean) {
    this.checkFailure()
    return { permissionId: 'perm-1', fileId: 'file-1', email, role, type: 'user' }
  }

  async shareFilePublic(_userId: string, _fileId: string, role: string) {
    this.checkFailure()
    return { permissionId: 'perm-public', fileId: 'file-1', role, type: 'anyone' }
  }

  async getFilePermissions(_userId: string, _fileId: string) {
    this.checkFailure()
    return [
      { id: 'perm-1', type: 'user', role: 'writer', email: 'john@example.com' },
      { id: 'perm-2', type: 'anyone', role: 'reader', email: undefined }
    ]
  }

  async removeSharing(_userId: string, _fileId: string, _permissionId: string) {
    this.checkFailure()
  }

  async readDocument(_userId: string, _documentId: string) {
    this.checkFailure()
    return { documentId: 'doc-1', title: 'My Document', body: 'Document content here' }
  }

  async readSpreadsheet(_userId: string, _spreadsheetId: string, _range?: string) {
    this.checkFailure()
    return {
      spreadsheetId: 'sheet-1',
      title: 'My Spreadsheet',
      sheets: [{ sheetId: 0, title: 'Sheet1', data: [['Name', 'Age'], ['Alice', '30']] }]
    }
  }

  async createDocument(_userId: string, title: string, _content?: string) {
    this.checkFailure()
    return { documentId: 'new-doc-1', title }
  }

  async appendToDocument(_userId: string, _documentId: string, _content: string) {
    this.checkFailure()
    return { documentId: 'doc-1', title: 'My Document' }
  }

  async replaceDocumentContent(_userId: string, _documentId: string, _content: string) {
    this.checkFailure()
    return { documentId: 'doc-1', title: 'My Document' }
  }

  async createSpreadsheet(_userId: string, title: string, _values?: string[][]) {
    this.checkFailure()
    return { spreadsheetId: 'new-sheet-1', title }
  }

  async updateSpreadsheet(_userId: string, _spreadsheetId: string, range: string, values: string[][]) {
    this.checkFailure()
    return { spreadsheetId: 'sheet-1', updatedRange: range, updatedRows: values.length, updatedColumns: values[0]?.length || 0, updatedCells: values.length * (values[0]?.length || 0) }
  }

  async appendToSpreadsheet(_userId: string, _spreadsheetId: string, range: string, values: string[][]) {
    this.checkFailure()
    return { spreadsheetId: 'sheet-1', updatedRange: range, updatedRows: values.length, updatedColumns: values[0]?.length || 0, updatedCells: values.length * (values[0]?.length || 0) }
  }
}

// Mock file database
const mockFileDb: Map<string, { content: string }> = new Map()

function mockGetAgentFileByPath(agentId: string, filePath: string) {
  const key = `${agentId}:${filePath}`
  return mockFileDb.get(key) || null
}

// Test harness that creates tools using the mock service
function createTestTools(mockService: MockGoogleWorkspaceService, userId: string, agentId?: string) {
  // This simulates what the real createGoogleWorkspaceTools does
  // but uses our mock service instead

  const tools: Array<{
    name: string
    description: string
    func: (input: Record<string, unknown>) => Promise<string>
  }> = []

  // Tool: Search Emails
  tools.push({
    name: 'gmail_search_emails',
    description: 'Search Gmail messages',
    func: async ({ query, maxResults }: { query?: string; maxResults?: number }) => {
      try {
        const emails = await mockService.searchEmails(userId, query || '', maxResults)
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

  // Tool: Get Email
  tools.push({
    name: 'gmail_get_email',
    description: 'Get email content',
    func: async ({ messageId }: { messageId?: string }) => {
      try {
        const email = await mockService.getEmail(userId, messageId || '')
        return `From: ${email.from}\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\n\nBody:\n${email.body}`
      } catch (error) {
        return `Failed to get email: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Tool: Send Email
  tools.push({
    name: 'gmail_send_email',
    description: 'Send email',
    func: async ({ to, subject, body }: { to?: string; subject?: string; body?: string }) => {
      try {
        const result = await mockService.sendEmail(userId, to || '', subject || '', body || '')
        return `Email sent successfully!\nMessage ID: ${result.messageId}\nThread ID: ${result.threadId}`
      } catch (error) {
        return `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Tool: Modify Email Labels
  tools.push({
    name: 'gmail_modify_labels',
    description: 'Modify email labels',
    func: async ({ messageId, addLabels, removeLabels }: { messageId?: string; addLabels?: string[]; removeLabels?: string[] }) => {
      try {
        const result = await mockService.modifyEmailLabels(userId, messageId || '', addLabels || [], removeLabels || [])
        const actions: string[] = []
        if (result.labelsRemoved.includes('UNREAD')) actions.push('marked as read')
        if (result.labelsAdded.includes('UNREAD')) actions.push('marked as unread')
        if (result.labelsAdded.includes('STARRED')) actions.push('starred')
        if (result.labelsRemoved.includes('STARRED')) actions.push('unstarred')
        const actionStr = actions.length > 0 ? actions.join(', ') : 'labels modified'
        return `Email ${actionStr} successfully!\nMessage ID: ${result.messageId}`
      } catch (error) {
        return `Failed to modify email: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Tool: Search Contacts
  tools.push({
    name: 'contacts_search',
    description: 'Search contacts',
    func: async ({ query }: { query?: string }) => {
      try {
        const contacts = await mockService.searchContacts(userId, query)
        if (contacts.length === 0) {
          return query ? `No contacts found matching "${query}".` : 'No contacts found.'
        }
        const results = contacts.map((contact, i) => {
          const parts: string[] = []
          if (contact.name) parts.push(`Name: ${contact.name}`)
          if (contact.emails.length > 0) parts.push(`Email: ${contact.emails.join(', ')}`)
          return `${i + 1}. ${parts.join('\n   ')}`
        })
        return `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        if (errMsg.includes('403') || errMsg.includes('permission')) {
          return 'ERROR: Permission denied. You may need to disconnect and reconnect Google Workspace to grant contacts access.'
        }
        return `Failed to search contacts: ${errMsg}`
      }
    }
  })

  // Tool: Get Calendar Events
  tools.push({
    name: 'calendar_get_events',
    description: 'Get calendar events',
    func: async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
      try {
        const events = await mockService.getEvents(userId, 'primary', startDate || '', endDate || '')
        if (events.length === 0) {
          return `No events found between ${startDate} and ${endDate}.`
        }
        const results = events.map((event, i) => {
          return `${i + 1}. ${event.summary}\n   ${event.start} - ${event.end}\n   ID: ${event.id}`
        })
        return `Found ${events.length} event${events.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
      } catch (error) {
        return `Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Tool: Drive Upload File (with sandbox file access)
  tools.push({
    name: 'drive_upload_file',
    description: 'Upload file to Drive from sandbox',
    func: async ({ filePath, targetName, folderId }: { filePath?: string; targetName?: string; folderId?: string }) => {
      try {
        // Read file from sandbox backup database
        if (!agentId) {
          return 'ERROR: Agent ID not available. Cannot access sandbox files. Please ensure the agent is properly configured.'
        }

        const file = mockGetAgentFileByPath(agentId, filePath || '')
        if (!file) {
          return `ERROR: File not found at path "${filePath}" in the sandbox. Please verify the file exists using ls or read_file first.`
        }

        // Determine filename
        const fileName = targetName || (filePath || '').split('/').pop() || 'file'
        const mimeType = 'application/octet-stream'

        // Upload the content
        const result = await mockService.uploadFile(userId, fileName, file.content, mimeType, folderId)
        return `File uploaded successfully!\nName: ${result.name}\nFile ID: ${result.fileId}\nType: ${result.mimeType}${result.webViewLink ? `\nLink: ${result.webViewLink}` : ''}`
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        return `Failed to upload file: ${errMsg}`
      }
    }
  })

  // Tool: Drive Manage Files (consolidated)
  tools.push({
    name: 'drive_manage_files',
    description: 'Manage files and folders',
    func: async ({ action, fileId, name, parentId, destinationFolderId }: { action?: string; fileId?: string; name?: string; parentId?: string; destinationFolderId?: string }) => {
      try {
        switch (action) {
          case 'create_folder': {
            if (!name) {
              return 'ERROR: "name" is required for create_folder action. Please provide a name for the new folder.'
            }
            const result = await mockService.createFolder(userId, name, parentId)
            return `Folder created successfully!\nName: ${result.name}\nFolder ID: ${result.folderId}${result.webViewLink ? `\nLink: ${result.webViewLink}` : ''}`
          }
          case 'delete': {
            if (!fileId) {
              return 'ERROR: "fileId" is required for delete action. Use drive_list_files to find the file ID.'
            }
            await mockService.deleteFile(userId, fileId)
            return `File/folder deleted successfully!\nDeleted ID: ${fileId}`
          }
          case 'move': {
            if (!fileId) {
              return 'ERROR: "fileId" is required for move action. Use drive_list_files to find the file ID.'
            }
            if (!destinationFolderId) {
              return 'ERROR: "destinationFolderId" is required for move action. Use drive_list_files to find the destination folder ID.'
            }
            const result = await mockService.moveFile(userId, fileId, destinationFolderId)
            return `File moved successfully!\nName: ${result.name}\nFile ID: ${result.id}\nNew location: ${destinationFolderId}`
          }
          default:
            return `ERROR: Unknown action "${action}". Valid actions are: create_folder, delete, move.`
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
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

  // Tool: Drive Manage Sharing (consolidated)
  tools.push({
    name: 'drive_manage_sharing',
    description: 'Manage sharing permissions',
    func: async ({ action, fileId, email, role, permissionId }: { action?: string; fileId?: string; email?: string; role?: string; permissionId?: string }) => {
      try {
        switch (action) {
          case 'share': {
            if (!email) {
              return 'ERROR: "email" is required for share action. Please provide the email address of the person to share with.'
            }
            if (!email.includes('@') || !email.includes('.')) {
              return `ERROR: "${email}" does not appear to be a valid email address. Please provide a valid email.`
            }
            const result = await mockService.shareFile(userId, fileId || '', email, role || 'reader', true)
            return `File shared successfully!\nShared with: ${result.email}\nRole: ${result.role}\nPermission ID: ${result.permissionId}`
          }
          case 'make_public': {
            const result = await mockService.shareFilePublic(userId, fileId || '', role || 'reader')
            return `File is now publicly accessible!\nAnyone with the link can view this file.\nTo undo this, use action "remove" with permissionId: ${result.permissionId}`
          }
          case 'list': {
            const permissions = await mockService.getFilePermissions(userId, fileId || '')
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
            await mockService.removeSharing(userId, fileId || '', permissionId)
            return `Sharing permission removed successfully!\nRemoved permission ID: ${permissionId}`
          }
          default:
            return `ERROR: Unknown action "${action}". Valid actions are: share, make_public, list, remove.`
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        if (errMsg.includes('404') || errMsg.includes('not found')) {
          if (action === 'remove') {
            return `ERROR: Permission not found. The permissionId "${permissionId}" may be invalid or already removed. Use action "list" to see current permissions.`
          }
          return `ERROR: File not found. The fileId "${fileId}" may be invalid. Use drive_list_files to find valid file IDs.`
        }
        if (errMsg.includes('403') || errMsg.includes('permission')) {
          return `ERROR: Permission denied. You may not have permission to change sharing settings for this file. Only the owner or users with "writer" access can manage sharing.`
        }
        return `Failed to ${action}: ${errMsg}`
      }
    }
  })

  // Tool: Edit Document (consolidated)
  tools.push({
    name: 'docs_edit_document',
    description: 'Create or edit documents',
    func: async ({ action, documentId, title, content }: { action?: string; documentId?: string; title?: string; content?: string }) => {
      try {
        switch (action) {
          case 'create': {
            if (!title) {
              return 'ERROR: "title" is required for create action. Please provide a title for the new document.'
            }
            const result = await mockService.createDocument(userId, title, content)
            return `Document created successfully!\nTitle: ${result.title}\nDocument ID: ${result.documentId}`
          }
          case 'append': {
            if (!documentId) {
              return 'ERROR: "documentId" is required for append action. Use drive_list_files to find the document ID, or extract it from the document URL.'
            }
            if (!content) {
              return 'ERROR: "content" is required for append action. Please provide the text to append to the document.'
            }
            const result = await mockService.appendToDocument(userId, documentId, content)
            return `Content appended successfully!\nDocument: ${result.title}\nDocument ID: ${result.documentId}`
          }
          case 'replace': {
            if (!documentId) {
              return 'ERROR: "documentId" is required for replace action. Use drive_list_files to find the document ID, or extract it from the document URL.'
            }
            if (!content) {
              return 'ERROR: "content" is required for replace action. Please provide the new content for the document.'
            }
            const result = await mockService.replaceDocumentContent(userId, documentId, content)
            return `Document content replaced successfully!\nDocument: ${result.title}\nDocument ID: ${result.documentId}`
          }
          default:
            return `ERROR: Unknown action "${action}". Valid actions are: create, append, replace.`
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        if (errMsg.includes('404') || errMsg.includes('not found')) {
          return `ERROR: Document not found. The documentId "${documentId}" may be invalid.`
        }
        if (errMsg.includes('403') || errMsg.includes('permission')) {
          return `ERROR: Permission denied. You may not have edit access to this document.`
        }
        return `Failed to ${action} document: ${errMsg}`
      }
    }
  })

  // Tool: Edit Spreadsheet (consolidated)
  tools.push({
    name: 'sheets_edit_spreadsheet',
    description: 'Create or edit spreadsheets',
    func: async ({ action, spreadsheetId, title, range, values }: { action?: string; spreadsheetId?: string; title?: string; range?: string; values?: string[][] }) => {
      try {
        switch (action) {
          case 'create': {
            if (!title) {
              return 'ERROR: "title" is required for create action. Please provide a title for the new spreadsheet.'
            }
            const result = await mockService.createSpreadsheet(userId, title, values)
            return `Spreadsheet created successfully!\nTitle: ${result.title}\nSpreadsheet ID: ${result.spreadsheetId}`
          }
          case 'update': {
            if (!spreadsheetId) {
              return 'ERROR: "spreadsheetId" is required for update action.'
            }
            if (!range) {
              return 'ERROR: "range" is required for update action. Specify the cells to update using A1 notation (e.g., "Sheet1!A1:C3").'
            }
            if (!values || values.length === 0) {
              return 'ERROR: "values" is required for update action. Provide data as a 2D array (e.g., [["A1", "B1"], ["A2", "B2"]]).'
            }
            const result = await mockService.updateSpreadsheet(userId, spreadsheetId, range, values)
            return `Spreadsheet updated successfully!\nRange: ${result.updatedRange}\nUpdated: ${result.updatedRows} rows, ${result.updatedColumns} columns (${result.updatedCells} cells total)`
          }
          case 'append': {
            if (!spreadsheetId) {
              return 'ERROR: "spreadsheetId" is required for append action.'
            }
            if (!values || values.length === 0) {
              return 'ERROR: "values" is required for append action.'
            }
            const result = await mockService.appendToSpreadsheet(userId, spreadsheetId, range || 'Sheet1', values)
            return `Rows appended successfully!\nRange: ${result.updatedRange}\nAdded: ${result.updatedRows} rows (${result.updatedCells} cells total)`
          }
          default:
            return `ERROR: Unknown action "${action}". Valid actions are: create, update, append.`
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error'
        if (errMsg.includes('404') || errMsg.includes('not found')) {
          return `ERROR: Spreadsheet not found. The spreadsheetId "${spreadsheetId}" may be invalid.`
        }
        if (errMsg.includes('403') || errMsg.includes('permission')) {
          return `ERROR: Permission denied. You may not have edit access to this spreadsheet.`
        }
        return `Failed to ${action} spreadsheet: ${errMsg}`
      }
    }
  })

  return tools
}

// Helper to get tool by name
function getTool(tools: Array<{ name: string; func: (input: Record<string, unknown>) => Promise<string> }>, name: string) {
  return tools.find(t => t.name === name)
}

// Tests
async function runTests() {
  const mockService = new MockGoogleWorkspaceService()
  const userId = 'test-user'
  const agentId = 'test-agent'

  await describe('Google Workspace Tools', async () => {

    await describe('Gmail - Search Emails', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'gmail_search_emails')!

      await it('returns formatted email results', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ query: 'from:john@example.com' })
        assert(result.includes('Found 2 emails'), 'Should show count')
        assert(result.includes('john@example.com'), 'Should include sender')
        assert(result.includes('Meeting Tomorrow'), 'Should include subject')
        assert(result.includes('email-1'), 'Should include ID')
      })

      await it('handles no results', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ query: 'no-results' })
        assert(result.includes('No emails found'), 'Should indicate no results')
      })

      await it('handles errors gracefully', async () => {
        mockService.setFailure('generic')
        const result = await tool.func({ query: 'test' })
        assert(result.includes('Failed to search emails'), 'Should show error message')
        mockService.setFailure(null)
      })
    })

    await describe('Gmail - Get Email', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'gmail_get_email')!

      await it('returns full email content', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ messageId: 'email-1' })
        assert(result.includes('john@example.com'), 'Should include from')
        assert(result.includes('me@example.com'), 'Should include to')
        assert(result.includes('Meeting Tomorrow'), 'Should include subject')
        assert(result.includes('full email body'), 'Should include body')
      })
    })

    await describe('Gmail - Modify Labels', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'gmail_modify_labels')!

      await it('marks email as read', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ messageId: 'email-1', removeLabels: ['UNREAD'] })
        assert(result.includes('marked as read'), 'Should indicate read')
        assert(result.includes('successfully'), 'Should indicate success')
      })

      await it('marks email as unread', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ messageId: 'email-1', addLabels: ['UNREAD'] })
        assert(result.includes('marked as unread'), 'Should indicate unread')
      })

      await it('stars email', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ messageId: 'email-1', addLabels: ['STARRED'] })
        assert(result.includes('starred'), 'Should indicate starred')
      })
    })

    await describe('Contacts - Search', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'contacts_search')!

      await it('returns contact information', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ query: 'John' })
        assert(result.includes('John Doe'), 'Should include name')
        assert(result.includes('john@example.com'), 'Should include email')
      })

      await it('handles permission error', async () => {
        mockService.setFailure('permission')
        const result = await tool.func({ query: 'John' })
        assert(result.includes('Permission denied'), 'Should indicate permission error')
        assert(result.includes('reconnect'), 'Should suggest reconnecting')
        mockService.setFailure(null)
      })
    })

    await describe('Drive - File Upload from Sandbox', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'drive_upload_file')!

      await it('requires agent ID', async () => {
        const toolsNoAgent = createTestTools(mockService, userId) // No agentId
        const toolNoAgent = getTool(toolsNoAgent, 'drive_upload_file')!
        const result = await toolNoAgent.func({ filePath: '/home/user/test.pdf' })
        assert(result.includes('Agent ID not available'), 'Should indicate agent ID required')
      })

      await it('returns error when file not found in sandbox', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ filePath: '/home/user/nonexistent.pdf' })
        assert(result.includes('File not found'), 'Should indicate file not found')
        assert(result.includes('/home/user/nonexistent.pdf'), 'Should show the path')
        assert(result.includes('ls or read_file'), 'Should suggest verification')
      })

      await it('uploads file successfully when found in sandbox', async () => {
        mockService.setFailure(null)
        // Add file to mock database
        mockFileDb.set(`${agentId}:/home/user/test.pdf`, { content: 'PDF content here' })

        const result = await tool.func({ filePath: '/home/user/test.pdf' })
        assert(result.includes('File uploaded successfully'), 'Should indicate success')
        assert(result.includes('test.pdf'), 'Should show filename')
        assert(result.includes('File ID:'), 'Should show file ID')

        // Clean up
        mockFileDb.delete(`${agentId}:/home/user/test.pdf`)
      })

      await it('uses custom target name when provided', async () => {
        mockService.setFailure(null)
        mockFileDb.set(`${agentId}:/home/user/original.pdf`, { content: 'PDF content' })

        const result = await tool.func({ filePath: '/home/user/original.pdf', targetName: 'renamed.pdf' })
        assert(result.includes('renamed.pdf'), 'Should use target name')

        mockFileDb.delete(`${agentId}:/home/user/original.pdf`)
      })
    })

    await describe('Drive - Manage Files (Consolidated)', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'drive_manage_files')!

      await it('creates folder successfully', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'create_folder', name: 'New Folder' })
        assert(result.includes('Folder created successfully'), 'Should indicate success')
        assert(result.includes('New Folder'), 'Should show folder name')
        assert(result.includes('Folder ID:'), 'Should show folder ID')
      })

      await it('requires name for create_folder', async () => {
        const result = await tool.func({ action: 'create_folder' })
        assert(result.includes('ERROR'), 'Should be an error')
        assert(result.includes('"name" is required'), 'Should indicate required field')
      })

      await it('deletes file successfully', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'delete', fileId: 'file-1' })
        assert(result.includes('deleted successfully'), 'Should indicate success')
        assert(result.includes('file-1'), 'Should show deleted ID')
      })

      await it('requires fileId for delete', async () => {
        const result = await tool.func({ action: 'delete' })
        assert(result.includes('ERROR'), 'Should be an error')
        assert(result.includes('"fileId" is required'), 'Should indicate required field')
      })

      await it('moves file successfully', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'move', fileId: 'file-1', destinationFolderId: 'folder-1' })
        assert(result.includes('File moved successfully'), 'Should indicate success')
        assert(result.includes('New location: folder-1'), 'Should show destination')
      })

      await it('requires both fileId and destinationFolderId for move', async () => {
        const result1 = await tool.func({ action: 'move' })
        assert(result1.includes('"fileId" is required'), 'Should require fileId')

        const result2 = await tool.func({ action: 'move', fileId: 'file-1' })
        assert(result2.includes('"destinationFolderId" is required'), 'Should require destination')
      })

      await it('handles 404 errors', async () => {
        mockService.setFailure('notFound')
        const result = await tool.func({ action: 'delete', fileId: 'nonexistent' })
        assert(result.includes('File or folder not found'), 'Should indicate not found')
        assert(result.includes('drive_list_files'), 'Should suggest how to find valid IDs')
        mockService.setFailure(null)
      })

      await it('handles permission errors', async () => {
        mockService.setFailure('permission')
        const result = await tool.func({ action: 'delete', fileId: 'file-1' })
        assert(result.includes('Permission denied'), 'Should indicate permission error')
        mockService.setFailure(null)
      })

      await it('rejects unknown actions', async () => {
        const result = await tool.func({ action: 'invalid_action' })
        assert(result.includes('Unknown action'), 'Should reject unknown action')
        assert(result.includes('create_folder, delete, move'), 'Should list valid actions')
      })
    })

    await describe('Drive - Manage Sharing (Consolidated)', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'drive_manage_sharing')!

      await it('shares file with user', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'share', fileId: 'file-1', email: 'user@example.com', role: 'writer' })
        assert(result.includes('File shared successfully'), 'Should indicate success')
        assert(result.includes('user@example.com'), 'Should show email')
        assert(result.includes('writer'), 'Should show role')
      })

      await it('requires valid email for share', async () => {
        const result1 = await tool.func({ action: 'share', fileId: 'file-1' })
        assert(result1.includes('"email" is required'), 'Should require email')

        const result2 = await tool.func({ action: 'share', fileId: 'file-1', email: 'invalid' })
        assert(result2.includes('does not appear to be a valid email'), 'Should validate email format')
      })

      await it('makes file public', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'make_public', fileId: 'file-1' })
        assert(result.includes('publicly accessible'), 'Should indicate public')
        assert(result.includes('Anyone with the link'), 'Should explain access')
      })

      await it('lists permissions', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'list', fileId: 'file-1' })
        assert(result.includes('Current sharing permissions'), 'Should show header')
        assert(result.includes('john@example.com'), 'Should show user permission')
        assert(result.includes('Anyone with link'), 'Should show public permission')
        assert(result.includes('Permission ID:'), 'Should show permission IDs')
      })

      await it('removes permission', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'remove', fileId: 'file-1', permissionId: 'perm-1' })
        assert(result.includes('Sharing permission removed'), 'Should indicate success')
        assert(result.includes('perm-1'), 'Should show removed ID')
      })

      await it('requires permissionId for remove', async () => {
        const result = await tool.func({ action: 'remove', fileId: 'file-1' })
        assert(result.includes('"permissionId" is required'), 'Should require permissionId')
        assert(result.includes('action "list"'), 'Should suggest using list')
      })
    })

    await describe('Docs - Edit Document (Consolidated)', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'docs_edit_document')!

      await it('creates document', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'create', title: 'New Document' })
        assert(result.includes('Document created successfully'), 'Should indicate success')
        assert(result.includes('New Document'), 'Should show title')
        assert(result.includes('Document ID:'), 'Should show document ID')
      })

      await it('requires title for create', async () => {
        const result = await tool.func({ action: 'create' })
        assert(result.includes('"title" is required'), 'Should require title')
      })

      await it('appends to document', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'append', documentId: 'doc-1', content: 'New content' })
        assert(result.includes('Content appended successfully'), 'Should indicate success')
      })

      await it('requires documentId and content for append', async () => {
        const result1 = await tool.func({ action: 'append' })
        assert(result1.includes('"documentId" is required'), 'Should require documentId')

        const result2 = await tool.func({ action: 'append', documentId: 'doc-1' })
        assert(result2.includes('"content" is required'), 'Should require content')
      })

      await it('replaces document content', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'replace', documentId: 'doc-1', content: 'Replaced content' })
        assert(result.includes('Document content replaced'), 'Should indicate success')
      })

      await it('handles document not found', async () => {
        mockService.setFailure('notFound')
        const result = await tool.func({ action: 'append', documentId: 'invalid-doc', content: 'test' })
        assert(result.includes('Document not found'), 'Should indicate not found')
        mockService.setFailure(null)
      })
    })

    await describe('Sheets - Edit Spreadsheet (Consolidated)', async () => {
      const tools = createTestTools(mockService, userId, agentId)
      const tool = getTool(tools, 'sheets_edit_spreadsheet')!

      await it('creates spreadsheet', async () => {
        mockService.setFailure(null)
        const result = await tool.func({ action: 'create', title: 'New Spreadsheet' })
        assert(result.includes('Spreadsheet created successfully'), 'Should indicate success')
        assert(result.includes('New Spreadsheet'), 'Should show title')
      })

      await it('updates spreadsheet cells', async () => {
        mockService.setFailure(null)
        const result = await tool.func({
          action: 'update',
          spreadsheetId: 'sheet-1',
          range: 'Sheet1!A1:B2',
          values: [['Name', 'Age'], ['Alice', '30']]
        })
        assert(result.includes('Spreadsheet updated successfully'), 'Should indicate success')
        assert(result.includes('2 rows'), 'Should show updated rows')
        assert(result.includes('2 columns'), 'Should show updated columns')
      })

      await it('requires all fields for update', async () => {
        const result1 = await tool.func({ action: 'update' })
        assert(result1.includes('"spreadsheetId" is required'), 'Should require spreadsheetId')

        const result2 = await tool.func({ action: 'update', spreadsheetId: 'sheet-1' })
        assert(result2.includes('"range" is required'), 'Should require range')

        const result3 = await tool.func({ action: 'update', spreadsheetId: 'sheet-1', range: 'A1:B2' })
        assert(result3.includes('"values" is required'), 'Should require values')
      })

      await it('appends rows to spreadsheet', async () => {
        mockService.setFailure(null)
        const result = await tool.func({
          action: 'append',
          spreadsheetId: 'sheet-1',
          values: [['Bob', '25'], ['Carol', '28']]
        })
        assert(result.includes('Rows appended successfully'), 'Should indicate success')
        assert(result.includes('2 rows'), 'Should show added rows')
      })
    })

    await describe('Error Handling Patterns', async () => {
      const tools = createTestTools(mockService, userId, agentId)

      await it('provides actionable 404 errors', async () => {
        mockService.setFailure('notFound')
        const manageTool = getTool(tools, 'drive_manage_files')!
        const result = await manageTool.func({ action: 'delete', fileId: 'nonexistent' })
        assert(result.includes('File or folder not found'), 'Should explain the error')
        assert(result.includes('drive_list_files'), 'Should suggest solution')
        mockService.setFailure(null)
      })

      await it('provides actionable permission errors', async () => {
        mockService.setFailure('permission')
        const docsTool = getTool(tools, 'docs_edit_document')!
        const result = await docsTool.func({ action: 'append', documentId: 'doc-1', content: 'test' })
        assert(result.includes('Permission denied'), 'Should explain the error')
        mockService.setFailure(null)
      })
    })

  })

  // Summary
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Tests: ${testCount} | Passed: ${passCount} | Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(console.error)
