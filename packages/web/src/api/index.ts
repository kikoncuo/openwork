/**
 * API client that replaces window.api from Electron preload
 * Provides the same interface for frontend components
 */

import { api } from './client'
import { ws } from './websocket'
import type {
  Thread, Agent, ModelConfig, Provider, UserTier,
  AdminStats, AdminUser, AdminTier, AdminThread, AdminAgent, AdminSkill,
  AdminCronjob, AdminWebhook, AdminAppConnection, AdminWhatsAppContact,
  AdminWhatsAppChat, AdminRun, SQLResult
} from '@/types'

// Re-export for convenience
export { api, ws }

// Cleanup function type
type CleanupFn = () => void

// Event callback type
type StreamEventCallback = (event: unknown) => void

// Main API interface matching window.api from Electron
export const windowApi = {
  threads: {
    list: (): Promise<Thread[]> => api.get('/threads'),
    get: (threadId: string): Promise<Thread | null> => api.get(`/threads/${threadId}`),
    create: (metadata?: Record<string, unknown>, agentId?: string): Promise<Thread> =>
      api.post('/threads', { metadata, agentId }),
    update: (threadId: string, updates: Partial<Thread>): Promise<Thread> =>
      api.patch(`/threads/${threadId}`, updates),
    delete: (threadId: string): Promise<void> => api.delete(`/threads/${threadId}`),
    getHistory: (threadId: string): Promise<unknown[]> => api.get(`/threads/${threadId}/history`),
    getState: (threadId: string): Promise<{ messages: unknown[]; todos: unknown[] }> =>
      api.get(`/threads/${threadId}/state`),
    generateTitle: (message: string): Promise<string> =>
      api.post<{ title: string }>('/threads/generate-title', { message }).then((r) => r.title),
    /**
     * Search threads by title and content.
     * Searches are limited to the most recent threads for efficiency.
     *
     * @param query - Search query (minimum 2 characters)
     * @param source - Optional source filter ('chat', 'whatsapp', 'cronjob')
     * @returns Search results with metadata about limits applied
     */
    search: (query: string, source?: string): Promise<{
      threads: Thread[]
      totalThreads: number
      limitApplied: boolean
      searchLimit: number
    }> => {
      const params = new URLSearchParams({ q: query })
      if (source && source !== 'all') params.set('source', source)
      return api.get(`/threads/search?${params}`)
    },
  },

  agents: {
    list: (): Promise<Agent[]> => api.get('/agents'),
    get: (agentId: string): Promise<Agent | null> => api.get(`/agents/${agentId}`),
    getDefault: (): Promise<Agent | null> => api.get('/agents/default'),
    create: (input: {
      name: string
      color?: string
      icon?: string
      model_default?: string
    }): Promise<Agent> => api.post('/agents', input),
    update: (
      agentId: string,
      updates: {
        name?: string
        color?: string
        icon?: string
        model_default?: string
      }
    ): Promise<Agent | null> => api.patch(`/agents/${agentId}`, updates),
    delete: (agentId: string): Promise<{ success: boolean; error?: string; reassignedThreads?: number }> =>
      api.delete(`/agents/${agentId}`),
    getThreadCount: (agentId: string): Promise<{ count: number }> =>
      api.get(`/agents/${agentId}/thread-count`),
    getConfig: (agentId: string): Promise<unknown> => api.get(`/agents/${agentId}/config`),
    updateConfig: (agentId: string, updates: unknown): Promise<unknown> =>
      api.patch(`/agents/${agentId}/config`, updates),
    getIcons: (): Promise<string[]> => api.get('/agents/icons'),
    getColors: (): Promise<string[]> => api.get('/agents/colors'),
    // Per-agent tool configurations
    getToolConfigs: (agentId: string): Promise<Array<{ id: string; enabled: boolean; requireApproval: boolean }>> =>
      api.get(`/agents/${agentId}/tools`),
    saveToolConfigs: (agentId: string, configs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }>): Promise<Array<{ id: string; enabled: boolean; requireApproval: boolean }>> =>
      api.put(`/agents/${agentId}/tools`, configs),
  },

  models: {
    list: (): Promise<ModelConfig[]> => api.get('/models'),
    listProviders: (): Promise<Provider[]> => api.get('/models/providers'),
    getDefault: (): Promise<string> =>
      api.get<{ modelId: string }>('/models/default').then((r) => r.modelId),
    setDefault: (modelId: string): Promise<void> => api.put('/models/default', { modelId }),
    // API key management removed - keys are now managed server-side
  },

  workspace: {
    // E2B Sandbox methods
    sandboxStatus: (threadId: string): Promise<{
      success: boolean
      enabled: boolean
      sandboxId: string | null
      workspacePath?: string
    }> => api.get(`/workspace/sandbox/status?threadId=${threadId}`),

    sandboxFiles: (options: { threadId?: string; agentId?: string; path?: string }): Promise<{
      success: boolean
      files: Array<{ name: string; path: string; is_dir: boolean }>
      currentPath: string
      workspacePath: string
      error?: string
    }> => {
      const params = new URLSearchParams()
      if (options.threadId) params.set('threadId', options.threadId)
      if (options.agentId) params.set('agentId', options.agentId)
      if (options.path) params.set('path', options.path)
      return api.get(`/workspace/sandbox/files?${params}`)
    },

    sandboxReadFile: (threadId: string, filePath: string): Promise<{
      success: boolean
      content?: string
      path?: string
      error?: string
    }> => api.get(`/workspace/sandbox/file?threadId=${threadId}&path=${encodeURIComponent(filePath)}`),

    sandboxWriteFile: (threadId: string, filePath: string, content: string): Promise<{
      success: boolean
      path?: string
      error?: string
    }> => api.post('/workspace/sandbox/file', { threadId, path: filePath, content }),

    // Sandbox Backup methods
    sandboxBackupStatus: (options: { threadId?: string; agentId?: string }): Promise<{
      success: boolean
      schedulerActive: boolean
      backup: {
        fileCount: number
        totalSize: number
        updatedAt: number
      } | null
    }> => {
      const params = new URLSearchParams()
      if (options.threadId) params.set('threadId', options.threadId)
      if (options.agentId) params.set('agentId', options.agentId)
      return api.get(`/workspace/sandbox/backup/status?${params}`)
    },

    sandboxBackup: (threadId: string): Promise<{
      success: boolean
      backup: {
        fileCount: number
        totalSize: number
        updatedAt: number
      } | null
      error?: string
    }> => api.post('/workspace/sandbox/backup', { threadId }),

    sandboxRestore: (threadId: string): Promise<{
      success: boolean
      sandboxId?: string
      filesRestored?: number
      error?: string
    }> => api.post('/workspace/sandbox/backup/restore', { threadId }),

    sandboxClearBackup: (threadId: string): Promise<{
      success: boolean
      error?: string
    }> => api.delete(`/workspace/sandbox/backup?threadId=${threadId}`),

    // Backup-first file operations (Phase 3)
    backupReadFile: (agentId: string, filePath: string): Promise<{
      success: boolean
      content?: string
      path?: string
      encoding?: 'utf8' | 'base64'
      error?: string
    }> => api.get(`/workspace/backup/file?agentId=${agentId}&path=${encodeURIComponent(filePath)}`),

    backupWriteFile: (agentId: string, filePath: string, content: string, encoding?: 'utf8' | 'base64'): Promise<{
      success: boolean
      path?: string
      error?: string
    }> => api.post('/workspace/backup/file', { agentId, path: filePath, content, encoding }),

    backupDeleteFile: (agentId: string, filePath: string): Promise<{
      success: boolean
      deleted?: boolean
      error?: string
    }> => api.delete(`/workspace/backup/file?agentId=${agentId}&path=${encodeURIComponent(filePath)}`),

    backupListFiles: (agentId: string): Promise<{
      success: boolean
      files: Array<{ path: string; size: number; is_dir: boolean }>
      error?: string
    }> => api.get(`/workspace/backup/files?agentId=${agentId}`),

    // Folder operations
    downloadFolder: (agentId: string, path: string): Promise<Blob> =>
      api.getBlob(`/workspace/${agentId}/folder/download?path=${encodeURIComponent(path)}`),

    emptyFolder: (agentId: string, path: string): Promise<{ success: boolean; error?: string }> =>
      api.delete(`/workspace/${agentId}/folder/empty?path=${encodeURIComponent(path)}`),

    // Terminal execution (E2B mode)
    executeTerminal: (agentId: string, command: string, cwd?: string): Promise<{
      success: boolean
      exitCode: number
      stdout: string
      stderr: string
      error?: string
    }> => api.post('/workspace/sandbox/execute-terminal', { agentId, command, cwd }),
  },

  agent: {
    invoke: (
      threadId: string,
      message: string,
      onEvent: StreamEventCallback,
      modelId?: string,
      planMode?: boolean
    ): CleanupFn => {
      ws.emit('agent:invoke', { threadId, message, modelId, planMode })
      return ws.on(`agent:stream:${threadId}`, onEvent)
    },
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: StreamEventCallback,
      modelId?: string,
      planMode?: boolean
    ): CleanupFn => {
      if (command) {
        ws.emit('agent:resume', { threadId, command, modelId })
      } else {
        ws.emit('agent:invoke', { threadId, message, modelId, planMode })
      }
      return ws.on(`agent:stream:${threadId}`, onEvent)
    },
    interrupt: (threadId: string, decision: unknown): void => {
      ws.emit('agent:interrupt', { threadId, decision })
    },
    cancel: (threadId: string): void => {
      ws.emit('agent:cancel', { threadId })
    },
  },

  mcp: {
    list: (): Promise<unknown[]> => api.get('/mcp/servers'),
    save: (servers: unknown[]): Promise<unknown[]> => api.put('/mcp/servers', servers),
    add: (server: unknown): Promise<unknown[]> => api.post('/mcp/servers', server),
    remove: (serverId: string): Promise<unknown[]> => api.delete(`/mcp/servers/${serverId}`),
    toggle: (serverId: string): Promise<unknown[]> => api.patch(`/mcp/servers/${serverId}/toggle`, {}),
    testConnection: (
      server: unknown
    ): Promise<{ success: boolean; tools: Array<{ name: string; description: string }>; error?: string }> =>
      api.post('/mcp/servers/test', server),
    initiateOAuth: (serverId: string): Promise<{ authUrl: string | null; authorized?: boolean }> =>
      api.post(`/mcp/servers/${serverId}/oauth/initiate`),
    getOAuthStatus: (serverId: string): Promise<{ authorized: boolean }> =>
      api.get(`/mcp/servers/${serverId}/oauth/status`),
    revokeOAuth: (serverId: string): Promise<{ success: boolean }> =>
      api.post(`/mcp/servers/${serverId}/oauth/revoke`),
  },

  tools: {
    getConfigs: (): Promise<Array<{ id: string; enabled: boolean; requireApproval?: boolean }>> =>
      api.get('/tools/configs'),
    saveConfigs: (configs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }>): Promise<void> =>
      api.put('/tools/configs', configs),
  },

  prompt: {
    getBase: (): Promise<string> => api.get<{ prompt: string }>('/prompt/base').then((r) => r.prompt),
    getCustom: (): Promise<string | null> =>
      api.get<{ prompt: string | null }>('/prompt/custom').then((r) => r.prompt),
    setCustom: (prompt: string | null): Promise<void> => api.put('/prompt/custom', { prompt }),
  },

  insights: {
    list: (): Promise<
      Array<{
        id: string
        content: string
        source: string
        createdAt: string
        enabled: boolean
      }>
    > => api.get('/insights'),
    add: (
      content: string,
      source: string
    ): Promise<{ id: string; content: string; source: string; createdAt: string; enabled: boolean }> =>
      api.post('/insights', { content, source }),
    remove: (id: string): Promise<void> => api.delete(`/insights/${id}`),
    toggle: (id: string): Promise<void> => api.patch(`/insights/${id}/toggle`, {}),
    save: (insights: unknown[]): Promise<void> => api.put('/insights', insights),
  },

  whatsapp: {
    connect: (): Promise<string | null> => api.post<{ qr: string | null }>('/whatsapp/connect').then((r) => r.qr),
    disconnect: (): Promise<void> => api.post('/whatsapp/disconnect'),
    getStatus: (): Promise<{ connected: boolean; phoneNumber?: string }> => api.get('/whatsapp/status'),
    isConnected: (): Promise<boolean> =>
      api.get<{ connected: boolean }>('/whatsapp/status').then((r) => r.connected),
    getContacts: (query?: string): Promise<unknown[]> =>
      api.get(`/whatsapp/contacts${query ? `?query=${query}` : ''}`),
    getChats: (limit?: number): Promise<unknown[]> =>
      api.get(`/whatsapp/chats${limit ? `?limit=${limit}` : ''}`),
    searchMessages: (query: string, chatJid?: string, limit?: number): Promise<unknown[]> => {
      const params = new URLSearchParams({ query })
      if (chatJid) params.set('chatJid', chatJid)
      if (limit) params.set('limit', String(limit))
      return api.get(`/whatsapp/messages/search?${params}`)
    },
    getHistory: (chatJid: string, limit?: number): Promise<unknown[]> =>
      api.get(`/whatsapp/chats/${encodeURIComponent(chatJid)}/messages${limit ? `?limit=${limit}` : ''}`),
    sendMessage: (to: string, text: string): Promise<unknown> => api.post('/whatsapp/messages', { to, text }),
    subscribeQR: (): void => ws.emit('whatsapp:subscribeQR', {}),
    unsubscribeQR: (): void => ws.emit('whatsapp:unsubscribeQR', {}),
    subscribeConnection: (): void => ws.emit('whatsapp:subscribeConnection', {}),
    unsubscribeConnection: (): void => ws.emit('whatsapp:unsubscribeConnection', {}),
    onQRCode: (callback: (qr: string) => void): CleanupFn => ws.on('whatsapp:qr', callback as (data: unknown) => void),
    onConnectionChange: (callback: (data: { connected: boolean; phoneNumber?: string }) => void): CleanupFn =>
      ws.on('whatsapp:connection', callback as (data: unknown) => void),
    getTools: (): Promise<
      Array<{ id: string; name: string; description: string; requireApproval?: boolean }>
    > => api.get('/whatsapp/tools'),
    // Agent configuration
    getAgentConfig: (): Promise<{
      enabled: boolean
      agent_id: string | null
      thread_timeout_minutes: number
    }> => api.get('/whatsapp/agent/config'),
    updateAgentConfig: (updates: {
      enabled?: boolean
      agent_id?: string | null
      thread_timeout_minutes?: number
    }): Promise<{
      enabled: boolean
      agent_id: string | null
      thread_timeout_minutes: number
    }> => api.patch('/whatsapp/agent/config', updates),
  },

  googleWorkspace: {
    // Connection management
    connect: (): Promise<string> => api.post<{ authUrl: string }>('/google-workspace/connect').then((r) => r.authUrl),
    disconnect: (): Promise<void> => api.post('/google-workspace/disconnect'),
    getStatus: (): Promise<{
      connected: boolean
      email: string | null
      connectedAt: number | null
      services: {
        gmail: boolean
        calendar: boolean
        drive: boolean
        docs: boolean
      }
    }> => api.get('/google-workspace/status'),
    isConnected: (): Promise<boolean> =>
      api.get<{ connected: boolean }>('/google-workspace/status').then((r) => r.connected),

    // Connection subscription
    subscribeConnection: (): void => ws.emit('google-workspace:subscribeConnection', {}),
    unsubscribeConnection: (): void => ws.emit('google-workspace:unsubscribeConnection', {}),
    onConnectionChange: (callback: (status: {
      connected: boolean
      email: string | null
      connectedAt: number | null
      services: {
        gmail: boolean
        calendar: boolean
        drive: boolean
        docs: boolean
      }
    }) => void): CleanupFn => ws.on('google-workspace:connection', callback as (data: unknown) => void),

    // Gmail methods
    searchEmails: (query: string, maxResults?: number): Promise<Array<{
      id: string
      threadId: string
      subject: string
      from: string
      date: number
      snippet: string
    }>> => {
      const params = new URLSearchParams({ query })
      if (maxResults) params.set('maxResults', String(maxResults))
      return api.get(`/google-workspace/gmail/search?${params}`)
    },
    getEmail: (messageId: string): Promise<{
      id: string
      threadId: string
      subject: string
      from: string
      to: string[]
      cc?: string[]
      date: number
      snippet: string
      body: string
      attachments?: Array<{
        filename: string
        mimeType: string
        size: number
        attachmentId: string
      }>
    }> => api.get(`/google-workspace/gmail/messages/${messageId}`),
    sendEmail: (to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<{
      messageId: string
      threadId: string
    }> => api.post('/google-workspace/gmail/send', { to, subject, body, cc, bcc }),

    // Calendar methods
    getEvents: (calendarId: string, startDate: string, endDate: string, maxResults?: number): Promise<Array<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }>> => {
      const params = new URLSearchParams({ calendarId, startDate, endDate })
      if (maxResults) params.set('maxResults', String(maxResults))
      return api.get(`/google-workspace/calendar/events?${params}`)
    },
    createEvent: (calendarId: string, event: {
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }): Promise<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }> => api.post('/google-workspace/calendar/events', { calendarId, ...event }),
    updateEvent: (calendarId: string, eventId: string, updates: {
      summary?: string
      description?: string
      start?: string
      end?: string
      attendees?: string[]
      location?: string
    }): Promise<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }> => api.patch(`/google-workspace/calendar/events/${eventId}`, { calendarId, ...updates }),

    // Drive methods
    listFiles: (query?: string, folderId?: string, maxResults?: number): Promise<Array<{
      id: string
      name: string
      mimeType: string
      size?: number
      modifiedTime: string
      webViewLink?: string
    }>> => {
      const params = new URLSearchParams()
      if (query) params.set('query', query)
      if (folderId) params.set('folderId', folderId)
      if (maxResults) params.set('maxResults', String(maxResults))
      return api.get(`/google-workspace/drive/files?${params}`)
    },
    getFileContent: (fileId: string): Promise<string> =>
      api.get<{ content: string }>(`/google-workspace/drive/files/${fileId}/content`).then((r) => r.content),

    // Docs methods
    readDocument: (documentId: string): Promise<{
      documentId: string
      title: string
      body: string
    }> => api.get(`/google-workspace/docs/documents/${documentId}`),
    readSpreadsheet: (spreadsheetId: string, range?: string): Promise<{
      spreadsheetId: string
      title: string
      sheets: Array<{
        sheetId: number
        title: string
        data: string[][]
      }>
    }> => {
      const params = range ? `?range=${encodeURIComponent(range)}` : ''
      return api.get(`/google-workspace/docs/spreadsheets/${spreadsheetId}${params}`)
    },

    // Tools
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
      service: 'gmail' | 'calendar' | 'drive' | 'docs'
    }>> => api.get('/google-workspace/tools'),
  },

  skills: {
    // List all skills for the current user
    list: (): Promise<Array<{
      skill_id: string
      name: string
      description: string | null
      source_url: string
      folder_path: string
      file_count: number
      user_id: string
      created_at: number
      updated_at: number
    }>> => api.get('/skills'),

    // Download a new skill from GitHub
    download: (url: string): Promise<{
      skill_id: string
      name: string
      description: string | null
      source_url: string
      folder_path: string
      file_count: number
      user_id: string
      created_at: number
      updated_at: number
    }> => api.post('/skills', { url }),

    // Get a skill by ID
    get: (skillId: string): Promise<{
      skill_id: string
      name: string
      description: string | null
      source_url: string
      folder_path: string
      file_count: number
      user_id: string
      created_at: number
      updated_at: number
    } | null> => api.get(`/skills/${skillId}`),

    // Delete a skill
    delete: (skillId: string): Promise<{ success: boolean }> => api.delete(`/skills/${skillId}`),

    // Get skill files (for preview)
    getFiles: (skillId: string): Promise<Array<{
      path: string
      content: string
    }>> => api.get(`/skills/${skillId}/files`),
  },

  cronjobs: {
    // List all cronjobs for the current user
    list: (): Promise<Array<{
      cronjob_id: string
      user_id: string
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode: 'new' | 'reuse'
      thread_timeout_minutes: number
      enabled: number
      last_run_at: number | null
      next_run_at: number | null
      created_at: number
      updated_at: number
    }>> => api.get('/cronjobs'),

    // Create a new cronjob
    create: (input: {
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode?: 'new' | 'reuse'
      thread_timeout_minutes?: number
    }): Promise<{
      cronjob_id: string
      user_id: string
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode: 'new' | 'reuse'
      thread_timeout_minutes: number
      enabled: number
      last_run_at: number | null
      next_run_at: number | null
      created_at: number
      updated_at: number
    }> => api.post('/cronjobs', input),

    // Get a cronjob by ID
    get: (cronjobId: string): Promise<{
      cronjob_id: string
      user_id: string
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode: 'new' | 'reuse'
      thread_timeout_minutes: number
      enabled: number
      last_run_at: number | null
      next_run_at: number | null
      created_at: number
      updated_at: number
    } | null> => api.get(`/cronjobs/${cronjobId}`),

    // Update a cronjob
    update: (cronjobId: string, updates: {
      name?: string
      cron_expression?: string
      message?: string
      agent_id?: string
      thread_mode?: 'new' | 'reuse'
      thread_timeout_minutes?: number
      enabled?: boolean
    }): Promise<{
      cronjob_id: string
      user_id: string
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode: 'new' | 'reuse'
      thread_timeout_minutes: number
      enabled: number
      last_run_at: number | null
      next_run_at: number | null
      created_at: number
      updated_at: number
    }> => api.patch(`/cronjobs/${cronjobId}`, updates),

    // Delete a cronjob
    delete: (cronjobId: string): Promise<{ success: boolean }> =>
      api.delete(`/cronjobs/${cronjobId}`),

    // Toggle a cronjob's enabled state
    toggle: (cronjobId: string): Promise<{
      cronjob_id: string
      user_id: string
      name: string
      cron_expression: string
      message: string
      agent_id: string
      thread_mode: 'new' | 'reuse'
      thread_timeout_minutes: number
      enabled: number
      last_run_at: number | null
      next_run_at: number | null
      created_at: number
      updated_at: number
    }> => api.post(`/cronjobs/${cronjobId}/toggle`),

    // Manually trigger a cronjob execution
    trigger: (cronjobId: string): Promise<{
      success: boolean
      thread_id?: string
      response?: string
      error?: string
    }> => api.post(`/cronjobs/${cronjobId}/trigger`),

    // Test a cronjob configuration without saving
    test: (input: {
      agent_id: string
      message: string
    }): Promise<{
      success: boolean
      thread_id?: string
      response?: string
      error?: string
    }> => api.post('/cronjobs/test', input),

    // Validate a cron expression
    validateCron: (expression: string): Promise<{
      valid: boolean
      error?: string
      nextRuns?: number[]
      humanReadable?: string
    }> => api.get(`/cronjobs/validate?expression=${encodeURIComponent(expression)}`),
  },

  exa: {
    // Connection management
    connect: (apiKey?: string): Promise<void> => api.post('/exa/connect', apiKey ? { apiKey } : {}),
    disconnect: (): Promise<void> => api.post('/exa/disconnect'),
    getStatus: (): Promise<{
      connected: boolean
      apiKeyConfigured: boolean
    }> => api.get('/exa/status'),
    isConnected: (): Promise<boolean> =>
      api.get<{ connected: boolean }>('/exa/status').then((r) => r.connected),

    // Connection subscription
    subscribeConnection: (): void => ws.emit('exa:subscribeConnection', {}),
    unsubscribeConnection: (): void => ws.emit('exa:unsubscribeConnection', {}),
    onConnectionChange: (callback: (status: {
      connected: boolean
      apiKeyConfigured: boolean
    }) => void): CleanupFn => ws.on('exa:connection', callback as (data: unknown) => void),

    // Search
    search: (options: {
      query: string
      category?: string
      numResults?: number
      includeDomains?: string[]
      excludeDomains?: string[]
      useHighlights?: boolean
    }): Promise<{
      results: Array<{
        url: string
        title?: string
        text?: string
        publishedDate?: string
        author?: string
        highlights?: string[]
      }>
    }> => api.post('/exa/search', options),

    // Datasets
    createDataset: (options: {
      query: string
      count?: number
      enrichments?: Array<{ description: string; format: string }>
    }): Promise<{
      id: string
      query: string
      status: string
      count: number
      createdAt: string
    }> => api.post('/exa/datasets', options),
    waitForDataset: (datasetId: string, timeout?: number): Promise<{
      id: string
      query: string
      status: string
      count: number
      createdAt: string
      completedAt?: string
    }> => api.post(`/exa/datasets/${datasetId}/wait`, { timeout }),
    getDatasetItems: (datasetId: string): Promise<{
      items: Array<Record<string, unknown>>
    }> => api.get(`/exa/datasets/${datasetId}/items`),
    enrichDataset: (datasetId: string, enrichments: Array<{ description: string; format: string }>): Promise<{
      id: string
      query: string
      status: string
      count: number
    }> => api.post(`/exa/datasets/${datasetId}/enrich`, { enrichments }),
    exportDataset: (datasetId: string, agentId: string): Promise<{ csvPath: string }> =>
      api.post(`/exa/datasets/${datasetId}/export`, { agentId }),

    // Tools
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
    }>> => api.get('/exa/tools'),
  },

  slack: {
    connect: (token: string, teamId: string): Promise<void> =>
      api.post('/slack/connect', { token, teamId }),
    disconnect: (): Promise<void> =>
      api.post('/slack/disconnect'),
    getStatus: (): Promise<{ connected: boolean; error?: string }> =>
      api.get('/slack/status'),
    isConnected: (): Promise<boolean> =>
      api.get<{ connected: boolean }>('/slack/status').then(r => r.connected),
    subscribeConnection: (): void =>
      ws.emit('slack:subscribeConnection', {}),
    unsubscribeConnection: (): void =>
      ws.emit('slack:unsubscribeConnection', {}),
    onConnectionChange: (callback: (status: { connected: boolean; error?: string }) => void): CleanupFn =>
      ws.on('slack:connection', callback as (data: unknown) => void),
    getTools: (): Promise<Array<{ id: string; name: string; description: string; requireApproval: boolean }>> =>
      api.get('/slack/tools'),
    // Agent configuration for message receiving
    getAgentConfig: (): Promise<{
      user_id: string
      enabled: number
      agent_id: string | null
      poll_interval_seconds: number
      thread_timeout_seconds: number
    }> => api.get('/slack/agent/config'),
    updateAgentConfig: (updates: {
      enabled?: boolean
      agent_id?: string | null
      poll_interval_seconds?: number
      thread_timeout_seconds?: number
    }): Promise<{
      user_id: string
      enabled: number
      agent_id: string | null
      poll_interval_seconds: number
      thread_timeout_seconds: number
    }> => api.patch('/slack/agent/config', updates),
    // Polling control
    startPolling: (): Promise<{ success: boolean; polling: boolean }> =>
      api.post('/slack/polling/start'),
    stopPolling: (): Promise<{ success: boolean; polling: boolean }> =>
      api.post('/slack/polling/stop'),
    getPollingStatus: (): Promise<{ polling: boolean }> =>
      api.get('/slack/polling/status'),
  },

  microsoftTeams: {
    // Connection management
    connect: (): Promise<string> => api.post<{ authUrl: string }>('/microsoft-teams/connect').then((r) => r.authUrl),
    disconnect: (): Promise<void> => api.post('/microsoft-teams/disconnect'),
    getStatus: (): Promise<{
      connected: boolean
      email: string | null
      displayName: string | null
      connectedAt: number | null
      services: {
        teams: boolean
        chats: boolean
        users: boolean
        search: boolean
      }
    }> => api.get('/microsoft-teams/status'),
    isConnected: (): Promise<boolean> =>
      api.get<{ connected: boolean }>('/microsoft-teams/status').then((r) => r.connected),

    // Connection subscription
    subscribeConnection: (): void => ws.emit('microsoft-teams:subscribeConnection', {}),
    unsubscribeConnection: (): void => ws.emit('microsoft-teams:unsubscribeConnection', {}),
    onConnectionChange: (callback: (status: {
      connected: boolean
      email: string | null
      displayName: string | null
      connectedAt: number | null
      services: {
        teams: boolean
        chats: boolean
        users: boolean
        search: boolean
      }
    }) => void): CleanupFn => ws.on('microsoft-teams:connection', callback as (data: unknown) => void),

    // Teams & Channels
    listTeams: (): Promise<Array<{
      id: string
      displayName: string
      description?: string
      isArchived?: boolean
    }>> => api.get('/microsoft-teams/teams'),
    listChannels: (teamId: string): Promise<Array<{
      id: string
      displayName: string
      description?: string
      membershipType?: string
    }>> => api.get(`/microsoft-teams/teams/${teamId}/channels`),
    getChannelMessages: (teamId: string, channelId: string, limit?: number): Promise<Array<{
      id: string
      createdDateTime: string
      body: string
      from: string
    }>> => {
      const params = limit ? `?limit=${limit}` : ''
      return api.get(`/microsoft-teams/teams/${teamId}/channels/${channelId}/messages${params}`)
    },

    // Chats
    listChats: (limit?: number): Promise<Array<{
      id: string
      chatType: string
      topic?: string
      members: Array<{ id: string; displayName: string; email?: string }>
    }>> => {
      const params = limit ? `?limit=${limit}` : ''
      return api.get(`/microsoft-teams/chats${params}`)
    },
    getChatMessages: (chatId: string, limit?: number): Promise<Array<{
      id: string
      createdDateTime: string
      body: string
      from: string
    }>> => {
      const params = limit ? `?limit=${limit}` : ''
      return api.get(`/microsoft-teams/chats/${chatId}/messages${params}`)
    },

    // Users
    getCurrentUser: (): Promise<{
      id: string
      displayName: string
      mail?: string
      jobTitle?: string
      department?: string
    }> => api.get('/microsoft-teams/users/me'),
    searchUsers: (query: string, limit?: number): Promise<Array<{
      id: string
      displayName: string
      mail?: string
      userPrincipalName?: string
    }>> => {
      const params = new URLSearchParams({ query })
      if (limit) params.set('limit', String(limit))
      return api.get(`/microsoft-teams/users/search?${params}`)
    },

    // Search
    searchMessages: (query: string, limit?: number): Promise<{
      messages: Array<{ id: string; createdDateTime: string; body: string; from: string }>
      totalCount: number
    }> => api.post('/microsoft-teams/search', { query, limit }),

    // Tools
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
      service: 'teams' | 'chats' | 'users' | 'search'
    }>> => api.get('/microsoft-teams/tools'),
  },

  sandbox: {
    // Get sandbox backend configuration
    getConfig: (): Promise<{
      type: 'buddy' | 'local'
      localHost: string
      localPort: number
    }> => api.get('/sandbox/config'),

    // Set sandbox backend configuration
    setConfig: (config: {
      type: 'buddy' | 'local'
      localHost: string
      localPort: number
    }): Promise<{
      type: 'buddy' | 'local'
      localHost: string
      localPort: number
    }> => api.put('/sandbox/config', config),
  },

  user: {
    // Get the current user's tier information
    getTier: (): Promise<UserTier> => api.get('/user/tier'),
  },

  admin: {
    getStats: (): Promise<AdminStats> => api.get('/admin/stats'),
    getUsers: (limit = 50, offset = 0): Promise<AdminUser[]> =>
      api.get(`/admin/users?limit=${limit}&offset=${offset}`),
    updateUser: (userId: string, updates: { name?: string; tier_id?: number; is_admin?: boolean }): Promise<AdminUser> =>
      api.patch(`/admin/users/${userId}`, updates),
    deleteUser: (userId: string): Promise<{ success: boolean }> => api.delete(`/admin/users/${userId}`),
    getTiers: (limit = 50, offset = 0): Promise<AdminTier[]> =>
      api.get(`/admin/tiers?limit=${limit}&offset=${offset}`),
    createTier: (input: {
      name: string; display_name: string; default_model: string;
      available_models?: string[]; features?: Record<string, boolean>
    }): Promise<AdminTier> => api.post('/admin/tiers', input),
    updateTier: (tierId: number, updates: Partial<AdminTier>): Promise<AdminTier> =>
      api.patch(`/admin/tiers/${tierId}`, updates),
    getThreads: (limit = 50, offset = 0): Promise<AdminThread[]> =>
      api.get(`/admin/threads?limit=${limit}&offset=${offset}`),
    deleteThread: (threadId: string): Promise<{ success: boolean }> => api.delete(`/admin/threads/${threadId}`),
    getAgents: (limit = 50, offset = 0): Promise<AdminAgent[]> =>
      api.get(`/admin/agents?limit=${limit}&offset=${offset}`),
    deleteAgent: (agentId: string): Promise<{ success: boolean }> => api.delete(`/admin/agents/${agentId}`),
    getSkills: (limit = 50, offset = 0): Promise<AdminSkill[]> =>
      api.get(`/admin/skills?limit=${limit}&offset=${offset}`),
    deleteSkill: (skillId: string): Promise<{ success: boolean }> => api.delete(`/admin/skills/${skillId}`),
    getCronjobs: (limit = 50, offset = 0): Promise<AdminCronjob[]> =>
      api.get(`/admin/cronjobs?limit=${limit}&offset=${offset}`),
    deleteCronjob: (cronjobId: string): Promise<{ success: boolean }> => api.delete(`/admin/cronjobs/${cronjobId}`),
    getWebhooks: (limit = 50, offset = 0): Promise<AdminWebhook[]> =>
      api.get(`/admin/webhooks?limit=${limit}&offset=${offset}`),
    deleteWebhook: (webhookId: string): Promise<{ success: boolean }> => api.delete(`/admin/webhooks/${webhookId}`),
    getConnections: (limit = 50, offset = 0): Promise<AdminAppConnection[]> =>
      api.get(`/admin/connections?limit=${limit}&offset=${offset}`),
    getWhatsAppContacts: (limit = 50, offset = 0): Promise<AdminWhatsAppContact[]> =>
      api.get(`/admin/whatsapp/contacts?limit=${limit}&offset=${offset}`),
    getWhatsAppChats: (limit = 50, offset = 0): Promise<AdminWhatsAppChat[]> =>
      api.get(`/admin/whatsapp/chats?limit=${limit}&offset=${offset}`),
    getRuns: (limit = 50, offset = 0): Promise<AdminRun[]> =>
      api.get(`/admin/runs?limit=${limit}&offset=${offset}`),
    updateRecord: (table: string, id: string | number, updates: Record<string, unknown>): Promise<Record<string, unknown>> =>
      api.patch(`/admin/records/${table}/${id}`, { updates }),
    runSQL: (query: string): Promise<SQLResult> =>
      api.post('/admin/sql', { query }),
    getSystemPrompt: (): Promise<{ prompt: string }> =>
      api.get('/admin/system-prompt'),
    setSystemPrompt: (prompt: string): Promise<{ prompt: string }> =>
      api.put('/admin/system-prompt', { prompt }),
    getOpenRouter: (): Promise<{
      enabled: boolean; tier_models: Record<string, string>;
      reasoning_tiers: number[]; provider_order: string[];
      allow_fallbacks: boolean; hasApiKey: boolean
    }> => api.get('/admin/openrouter'),
    setOpenRouter: (config: {
      enabled: boolean; tier_models: Record<string, string>;
      reasoning_tiers: number[]; provider_order: string[];
      allow_fallbacks: boolean
    }): Promise<{
      enabled: boolean; tier_models: Record<string, string>;
      reasoning_tiers: number[]; provider_order: string[];
      allow_fallbacks: boolean; hasApiKey: boolean
    }> => api.put('/admin/openrouter', config),
    testOpenRouter: (model?: string): Promise<{
      success: boolean; model?: string; response?: string; error?: string
    }> => api.post('/admin/openrouter/test', { model }),
  },
}

// Make it available globally for backward compatibility
declare global {
  interface Window {
    api: typeof windowApi
  }
}

// Initialize the global API object
if (typeof window !== 'undefined') {
  window.api = windowApi
}
