import { contextBridge, ipcRenderer } from 'electron'
import type { Thread, ModelConfig, Provider, StreamEvent, HITLDecision } from '../main/types'

// Simple electron API - replaces @electron-toolkit/preload
const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args))
      return () => ipcRenderer.removeListener(channel, listener)
    },
    once: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event, ...args) => listener(...args))
    },
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

// Custom APIs for renderer
const api = {
  agent: {
    // Send message and receive events via callback
    invoke: (
      threadId: string,
      message: string,
      onEvent: (event: StreamEvent) => void,
      modelId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent(data)
        if (data.type === 'done' || data.type === 'error') {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send('agent:invoke', { threadId, message, modelId })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    // Stream agent events for useStream transport
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: (event: StreamEvent) => void,
      modelId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent(data)
        if (data.type === 'done' || data.type === 'error') {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)

      // If we have a command, it might be a resume/retry
      if (command) {
        ipcRenderer.send('agent:resume', { threadId, command, modelId })
      } else {
        ipcRenderer.send('agent:invoke', { threadId, message, modelId })
      }

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: StreamEvent) => void
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent?.(data)
        if (data.type === 'done' || data.type === 'error') {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send('agent:interrupt', { threadId, decision })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    cancel: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke('agent:cancel', { threadId })
    }
  },
  threads: {
    list: (): Promise<Thread[]> => {
      return ipcRenderer.invoke('threads:list')
    },
    get: (threadId: string): Promise<Thread | null> => {
      return ipcRenderer.invoke('threads:get', threadId)
    },
    create: (metadata?: Record<string, unknown>, agentId?: string): Promise<Thread> => {
      return ipcRenderer.invoke('threads:create', metadata, agentId)
    },
    update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
      return ipcRenderer.invoke('threads:update', { threadId, updates })
    },
    delete: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke('threads:delete', threadId)
    },
    getHistory: (threadId: string): Promise<unknown[]> => {
      return ipcRenderer.invoke('threads:history', threadId)
    },
    generateTitle: (message: string): Promise<string> => {
      return ipcRenderer.invoke('threads:generateTitle', message)
    }
  },
  models: {
    list: (): Promise<ModelConfig[]> => {
      return ipcRenderer.invoke('models:list')
    },
    listProviders: (): Promise<Provider[]> => {
      return ipcRenderer.invoke('models:listProviders')
    },
    getDefault: (): Promise<string> => {
      return ipcRenderer.invoke('models:getDefault')
    },
    setDefault: (modelId: string): Promise<void> => {
      return ipcRenderer.invoke('models:setDefault', modelId)
    },
    setApiKey: (provider: string, apiKey: string): Promise<void> => {
      return ipcRenderer.invoke('models:setApiKey', { provider, apiKey })
    },
    getApiKey: (provider: string): Promise<string | null> => {
      return ipcRenderer.invoke('models:getApiKey', provider)
    },
    deleteApiKey: (provider: string): Promise<void> => {
      return ipcRenderer.invoke('models:deleteApiKey', provider)
    }
  },
  workspace: {
    get: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke('workspace:get', threadId)
    },
    set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
      return ipcRenderer.invoke('workspace:set', { threadId, path })
    },
    select: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke('workspace:select', threadId)
    },
    loadFromDisk: (threadId: string): Promise<{
      success: boolean
      files: Array<{
        path: string
        is_dir: boolean
        size?: number
        modified_at?: string
      }>
      workspacePath?: string
      error?: string
    }> => {
      return ipcRenderer.invoke('workspace:loadFromDisk', { threadId })
    },
    readFile: (threadId: string, filePath: string): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke('workspace:readFile', { threadId, filePath })
    },
    readBinaryFile: (threadId: string, filePath: string): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke('workspace:readBinaryFile', { threadId, filePath })
    },
    // Listen for file changes in the workspace
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void
    ): (() => void) => {
      const handler = (_: unknown, data: { threadId: string; workspacePath: string }): void => {
        callback(data)
      }
      ipcRenderer.on('workspace:files-changed', handler)
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('workspace:files-changed', handler)
      }
    }
  },
  mcp: {
    list: (): Promise<Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>> => {
      return ipcRenderer.invoke('mcp:list')
    },
    save: (servers: Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>): Promise<void> => {
      return ipcRenderer.invoke('mcp:save', servers)
    },
    add: (server: {
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }): Promise<void> => {
      return ipcRenderer.invoke('mcp:add', server)
    },
    remove: (serverId: string): Promise<void> => {
      return ipcRenderer.invoke('mcp:remove', serverId)
    },
    toggle: (serverId: string): Promise<void> => {
      return ipcRenderer.invoke('mcp:toggle', serverId)
    },
    testConnection: (server: {
      name: string
      command: string
      args: string[]
      env?: Record<string, string>
    }): Promise<{
      success: boolean
      error?: string
      tools: Array<{ name: string; description: string }>
    }> => {
      return ipcRenderer.invoke('mcp:testConnection', server)
    }
  },
  tools: {
    getConfigs: (): Promise<Array<{ id: string; enabled: boolean }>> => {
      return ipcRenderer.invoke('tools:getConfigs')
    },
    saveConfigs: (configs: Array<{ id: string; enabled: boolean }>): Promise<void> => {
      return ipcRenderer.invoke('tools:saveConfigs', configs)
    }
  },
  prompt: {
    getBase: (): Promise<string> => {
      return ipcRenderer.invoke('prompt:getBase')
    },
    getCustom: (): Promise<string | null> => {
      return ipcRenderer.invoke('prompt:getCustom')
    },
    setCustom: (prompt: string | null): Promise<void> => {
      return ipcRenderer.invoke('prompt:setCustom', prompt)
    }
  },
  insights: {
    list: (): Promise<Array<{
      id: string
      content: string
      source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
      createdAt: string
      enabled: boolean
    }>> => {
      return ipcRenderer.invoke('insights:list')
    },
    add: (content: string, source: 'tool_feedback' | 'user_feedback' | 'auto_learned'): Promise<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }> => {
      return ipcRenderer.invoke('insights:add', { content, source })
    },
    remove: (id: string): Promise<void> => {
      return ipcRenderer.invoke('insights:remove', id)
    },
    toggle: (id: string): Promise<void> => {
      return ipcRenderer.invoke('insights:toggle', id)
    },
    save: (insights: Array<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>): Promise<void> => {
      return ipcRenderer.invoke('insights:save', insights)
    }
  },
  agents: {
    list: (): Promise<Array<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    }>> => {
      return ipcRenderer.invoke('agents:list')
    },
    get: (agentId: string): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null> => {
      return ipcRenderer.invoke('agents:get', agentId)
    },
    getDefault: (): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null> => {
      return ipcRenderer.invoke('agents:getDefault')
    },
    create: (input: {
      name: string
      color?: string
      icon?: string
      model_default?: string
      default_workspace_path?: string | null
    }): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    }> => {
      return ipcRenderer.invoke('agents:create', input)
    },
    update: (agentId: string, updates: {
      name?: string
      color?: string
      icon?: string
      model_default?: string
      default_workspace_path?: string | null
    }): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null> => {
      return ipcRenderer.invoke('agents:update', agentId, updates)
    },
    delete: (agentId: string): Promise<{
      success: boolean
      error?: string
      reassignedThreads?: number
    }> => {
      return ipcRenderer.invoke('agents:delete', agentId)
    },
    getThreadCount: (agentId: string): Promise<number> => {
      return ipcRenderer.invoke('agents:getThreadCount', agentId)
    },
    getConfig: (agentId: string): Promise<{
      agent_id: string
      tool_configs: string | null
      mcp_servers: string | null
      custom_prompt: string | null
      learned_insights: string | null
      updated_at: number
    } | null> => {
      return ipcRenderer.invoke('agents:getConfig', agentId)
    },
    updateConfig: (agentId: string, updates: {
      tool_configs?: unknown[]
      mcp_servers?: unknown[]
      custom_prompt?: string | null
      learned_insights?: unknown[]
    }): Promise<{
      agent_id: string
      tool_configs: string | null
      mcp_servers: string | null
      custom_prompt: string | null
      learned_insights: string | null
      updated_at: number
    } | null> => {
      return ipcRenderer.invoke('agents:updateConfig', agentId, updates)
    },
    getIcons: (): Promise<string[]> => {
      return ipcRenderer.invoke('agents:getIcons')
    },
    getColors: (): Promise<string[]> => {
      return ipcRenderer.invoke('agents:getColors')
    },
    // Agent-specific config APIs - return null if no agent-specific config exists
    getMcpServers: (agentId: string): Promise<Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }> | null> => {
      return ipcRenderer.invoke('agent:mcp:list', agentId)
    },
    saveMcpServers: (agentId: string, servers: Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>): Promise<void> => {
      return ipcRenderer.invoke('agent:mcp:save', { agentId, servers })
    },
    getToolConfigs: (agentId: string): Promise<Array<{ id: string; enabled: boolean; requireApproval?: boolean }> | null> => {
      return ipcRenderer.invoke('agent:tools:getConfigs', agentId)
    },
    saveToolConfigs: (agentId: string, configs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }>): Promise<void> => {
      return ipcRenderer.invoke('agent:tools:saveConfigs', { agentId, configs })
    },
    getCustomPrompt: (agentId: string): Promise<string | null | undefined> => {
      return ipcRenderer.invoke('agent:prompt:getCustom', agentId)
    },
    setCustomPrompt: (agentId: string, prompt: string | null): Promise<void> => {
      return ipcRenderer.invoke('agent:prompt:setCustom', { agentId, prompt })
    },
    getInsights: (agentId: string): Promise<Array<{
      id: string
      content: string
      source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
      createdAt: string
      enabled: boolean
    }> | null> => {
      return ipcRenderer.invoke('agent:insights:list', agentId)
    },
    saveInsights: (agentId: string, insights: Array<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>): Promise<void> => {
      return ipcRenderer.invoke('agent:insights:save', { agentId, insights })
    },
    addInsight: (agentId: string, content: string, source: 'tool_feedback' | 'user_feedback' | 'auto_learned'): Promise<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }> => {
      return ipcRenderer.invoke('agent:insights:add', { agentId, content, source })
    },
    removeInsight: (agentId: string, id: string): Promise<void> => {
      return ipcRenderer.invoke('agent:insights:remove', { agentId, id })
    },
    toggleInsight: (agentId: string, id: string): Promise<void> => {
      return ipcRenderer.invoke('agent:insights:toggle', { agentId, id })
    }
  },
  whatsapp: {
    // Connection management
    connect: (): Promise<string | null> => {
      return ipcRenderer.invoke('whatsapp:connect')
    },
    disconnect: (): Promise<void> => {
      return ipcRenderer.invoke('whatsapp:disconnect')
    },
    getStatus: (): Promise<{
      connected: boolean
      phoneNumber: string | null
      connectedAt: number | null
    }> => {
      return ipcRenderer.invoke('whatsapp:getStatus')
    },
    isConnected: (): Promise<boolean> => {
      return ipcRenderer.invoke('whatsapp:isConnected')
    },
    // Data access
    getContacts: (query?: string): Promise<Array<{
      jid: string
      name: string | null
      pushName: string | null
      phoneNumber: string | null
      isGroup: boolean
    }>> => {
      return ipcRenderer.invoke('whatsapp:getContacts', query)
    },
    getChats: (limit?: number): Promise<Array<{
      jid: string
      name: string | null
      isGroup: boolean
      lastMessageTime: number | null
      unreadCount: number
    }>> => {
      return ipcRenderer.invoke('whatsapp:getChats', limit)
    },
    searchMessages: (query: string, chatJid?: string, limit?: number): Promise<Array<{
      id: string
      from: string
      to: string
      fromMe: boolean
      timestamp: number
      type: string
      content: string | null
      isGroup: boolean
      senderName?: string
    }>> => {
      return ipcRenderer.invoke('whatsapp:searchMessages', query, chatJid, limit)
    },
    getHistory: (chatJid: string, limit?: number): Promise<Array<{
      id: string
      from: string
      to: string
      fromMe: boolean
      timestamp: number
      type: string
      content: string | null
      isGroup: boolean
      senderName?: string
    }>> => {
      return ipcRenderer.invoke('whatsapp:getHistory', chatJid, limit)
    },
    // Actions
    sendMessage: (to: string, text: string): Promise<{
      messageId: string
      timestamp: number
    }> => {
      return ipcRenderer.invoke('whatsapp:sendMessage', to, text)
    },
    // Event subscriptions
    subscribeQR: (): Promise<void> => {
      return ipcRenderer.invoke('whatsapp:subscribeQR')
    },
    unsubscribeQR: (): Promise<void> => {
      return ipcRenderer.invoke('whatsapp:unsubscribeQR')
    },
    subscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('whatsapp:subscribeConnection')
    },
    unsubscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('whatsapp:unsubscribeConnection')
    },
    // Event listeners
    onQRCode: (callback: (qr: string) => void): (() => void) => {
      const handler = (_: unknown, qr: string): void => {
        callback(qr)
      }
      ipcRenderer.on('whatsapp:qrCode', handler)
      return () => {
        ipcRenderer.removeListener('whatsapp:qrCode', handler)
      }
    },
    onConnectionChange: (callback: (data: { connected: boolean; phoneNumber?: string }) => void): (() => void) => {
      const handler = (_: unknown, data: { connected: boolean; phoneNumber?: string }): void => {
        callback(data)
      }
      ipcRenderer.on('whatsapp:connectionChange', handler)
      return () => {
        ipcRenderer.removeListener('whatsapp:connectionChange', handler)
      }
    },
    // Tools info for UI
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
    }>> => {
      return ipcRenderer.invoke('whatsapp:getTools')
    }
  },
  googleWorkspace: {
    // Connection management
    connect: (): Promise<string> => {
      return ipcRenderer.invoke('google-workspace:connect')
    },
    disconnect: (): Promise<void> => {
      return ipcRenderer.invoke('google-workspace:disconnect')
    },
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
    }> => {
      return ipcRenderer.invoke('google-workspace:getStatus')
    },
    isConnected: (): Promise<boolean> => {
      return ipcRenderer.invoke('google-workspace:isConnected')
    },
    // Event subscriptions
    subscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('google-workspace:subscribeConnection')
    },
    unsubscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('google-workspace:unsubscribeConnection')
    },
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
    }) => void): (() => void) => {
      const handler = (_: unknown, status: {
        connected: boolean
        email: string | null
        connectedAt: number | null
        services: {
          gmail: boolean
          calendar: boolean
          drive: boolean
          docs: boolean
        }
      }): void => {
        callback(status)
      }
      ipcRenderer.on('google-workspace:connectionChange', handler)
      return () => {
        ipcRenderer.removeListener('google-workspace:connectionChange', handler)
      }
    },
    // Gmail operations
    searchEmails: (query: string, maxResults?: number): Promise<Array<{
      id: string
      threadId: string
      subject: string
      from: string
      date: number
      snippet: string
    }>> => {
      return ipcRenderer.invoke('google-workspace:gmail:search', query, maxResults)
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
    }> => {
      return ipcRenderer.invoke('google-workspace:gmail:get', messageId)
    },
    sendEmail: (to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<{
      messageId: string
      threadId: string
    }> => {
      return ipcRenderer.invoke('google-workspace:gmail:send', to, subject, body, cc, bcc)
    },
    // Calendar operations
    getEvents: (calendarId: string, startDate: string, endDate: string, maxResults?: number): Promise<Array<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }>> => {
      return ipcRenderer.invoke('google-workspace:calendar:getEvents', calendarId, startDate, endDate, maxResults)
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
    }> => {
      return ipcRenderer.invoke('google-workspace:calendar:createEvent', calendarId, event)
    },
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
    }> => {
      return ipcRenderer.invoke('google-workspace:calendar:updateEvent', calendarId, eventId, updates)
    },
    // Drive operations
    listFiles: (query?: string, folderId?: string, maxResults?: number): Promise<Array<{
      id: string
      name: string
      mimeType: string
      size?: number
      modifiedTime: string
      webViewLink?: string
    }>> => {
      return ipcRenderer.invoke('google-workspace:drive:listFiles', query, folderId, maxResults)
    },
    getFileContent: (fileId: string): Promise<string> => {
      return ipcRenderer.invoke('google-workspace:drive:getFile', fileId)
    },
    // Docs operations
    readDocument: (documentId: string): Promise<{
      documentId: string
      title: string
      body: string
    }> => {
      return ipcRenderer.invoke('google-workspace:docs:readDocument', documentId)
    },
    readSpreadsheet: (spreadsheetId: string, range?: string): Promise<{
      spreadsheetId: string
      title: string
      sheets: Array<{
        sheetId: number
        title: string
        data: string[][]
      }>
    }> => {
      return ipcRenderer.invoke('google-workspace:sheets:readSpreadsheet', spreadsheetId, range)
    },
    // Tools info for UI
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
      service: 'gmail' | 'calendar' | 'drive' | 'docs'
    }>> => {
      return ipcRenderer.invoke('google-workspace:getTools')
    }
  },
  exa: {
    // Connection management
    connect: (apiKey?: string): Promise<void> => {
      return ipcRenderer.invoke('exa:connect', apiKey)
    },
    disconnect: (): Promise<void> => {
      return ipcRenderer.invoke('exa:disconnect')
    },
    getStatus: (): Promise<{
      connected: boolean
      apiKeyConfigured: boolean
      error?: string
    }> => {
      return ipcRenderer.invoke('exa:getStatus')
    },
    isConnected: (): Promise<boolean> => {
      return ipcRenderer.invoke('exa:isConnected')
    },
    // Event subscriptions
    subscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('exa:subscribeConnection')
    },
    unsubscribeConnection: (): Promise<void> => {
      return ipcRenderer.invoke('exa:unsubscribeConnection')
    },
    onConnectionChange: (callback: (status: {
      connected: boolean
      apiKeyConfigured: boolean
      error?: string
    }) => void): (() => void) => {
      const handler = (_: unknown, status: {
        connected: boolean
        apiKeyConfigured: boolean
        error?: string
      }): void => {
        callback(status)
      }
      ipcRenderer.on('exa:connectionChange', handler)
      return () => {
        ipcRenderer.removeListener('exa:connectionChange', handler)
      }
    },
    // Tools info for UI
    getTools: (): Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
    }>> => {
      return ipcRenderer.invoke('exa:getTools')
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
