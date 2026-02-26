import type { Thread, ModelConfig, StreamEvent, HITLDecision } from '../main/types'

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  process: {
    platform: NodeJS.Platform
    versions: NodeJS.ProcessVersions
  }
}

interface CustomAPI {
  agent: {
    invoke: (threadId: string, message: string, onEvent: (event: StreamEvent) => void) => () => void
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: (event: StreamEvent) => void
    ) => () => void
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: StreamEvent) => void
    ) => () => void
    cancel: (threadId: string) => Promise<void>
  }
  threads: {
    list: () => Promise<Thread[]>
    get: (threadId: string) => Promise<Thread | null>
    create: (metadata?: Record<string, unknown>) => Promise<Thread>
    update: (threadId: string, updates: Partial<Thread>) => Promise<Thread>
    delete: (threadId: string) => Promise<void>
    getHistory: (threadId: string) => Promise<unknown[]>
    generateTitle: (message: string) => Promise<string>
  }
  models: {
    list: () => Promise<ModelConfig[]>
    listProviders: () => Promise<Provider[]>
    getDefault: () => Promise<string>
    deleteApiKey: (provider: string) => Promise<void>
    setDefault: (modelId: string) => Promise<void>
    setApiKey: (provider: string, apiKey: string) => Promise<void>
    getApiKey: (provider: string) => Promise<string | null>
  }
  workspace: {
    get: (threadId?: string) => Promise<string | null>
    set: (threadId: string | undefined, path: string | null) => Promise<string | null>
    select: (threadId?: string) => Promise<string | null>
    loadFromDisk: (threadId: string) => Promise<{
      success: boolean
      files: Array<{
        path: string
        is_dir: boolean
        size?: number
        modified_at?: string
      }>
      workspacePath?: string
      error?: string
    }>
    readFile: (threadId: string, filePath: string) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
    readBinaryFile: (threadId: string, filePath: string) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void
    ) => () => void
  }
  mcp: {
    list: () => Promise<Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>>
    save: (servers: Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>) => Promise<void>
    add: (server: {
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }) => Promise<void>
    remove: (serverId: string) => Promise<void>
    toggle: (serverId: string) => Promise<void>
    testConnection: (server: {
      name: string
      command: string
      args: string[]
      env?: Record<string, string>
    }) => Promise<{
      success: boolean
      error?: string
      tools: Array<{ name: string; description: string }>
    }>
  }
  tools: {
    getConfigs: () => Promise<Array<{ id: string; enabled: boolean }>>
    saveConfigs: (configs: Array<{ id: string; enabled: boolean }>) => Promise<void>
  }
  prompt: {
    getBase: () => Promise<string>
    getCustom: () => Promise<string | null>
    setCustom: (prompt: string | null) => Promise<void>
  }
  insights: {
    list: () => Promise<Array<{
      id: string
      content: string
      source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
      createdAt: string
      enabled: boolean
    }>>
    add: (content: string, source: 'tool_feedback' | 'user_feedback' | 'auto_learned') => Promise<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>
    remove: (id: string) => Promise<void>
    toggle: (id: string) => Promise<void>
    save: (insights: Array<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>) => Promise<void>
  }
  agents: {
    list: () => Promise<Array<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    }>>
    get: (agentId: string) => Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null>
    getDefault: () => Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null>
    create: (input: {
      name: string
      color?: string
      icon?: string
      model_default?: string
      default_workspace_path?: string | null
    }) => Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    }>
    update: (agentId: string, updates: {
      name?: string
      color?: string
      icon?: string
      model_default?: string
      default_workspace_path?: string | null
    }) => Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
      default_workspace_path: string | null
      is_default: number
      created_at: number
      updated_at: number
    } | null>
    delete: (agentId: string) => Promise<{
      success: boolean
      error?: string
      reassignedThreads?: number
    }>
    getThreadCount: (agentId: string) => Promise<number>
    getConfig: (agentId: string) => Promise<{
      agent_id: string
      tool_configs: string | null
      mcp_servers: string | null
      custom_prompt: string | null
      learned_insights: string | null
      updated_at: number
    } | null>
    updateConfig: (agentId: string, updates: {
      tool_configs?: unknown[]
      mcp_servers?: unknown[]
      custom_prompt?: string | null
      learned_insights?: unknown[]
    }) => Promise<{
      agent_id: string
      tool_configs: string | null
      mcp_servers: string | null
      custom_prompt: string | null
      learned_insights: string | null
      updated_at: number
    } | null>
    getIcons: () => Promise<string[]>
    getColors: () => Promise<string[]>
    // Agent-specific config APIs - return null if no agent-specific config exists
    getMcpServers: (agentId: string) => Promise<Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }> | null>
    saveMcpServers: (agentId: string, servers: Array<{
      id: string
      name: string
      command: string
      args: string[]
      enabled: boolean
      env?: Record<string, string>
    }>) => Promise<void>
    getToolConfigs: (agentId: string) => Promise<Array<{ id: string; enabled: boolean; requireApproval?: boolean }> | null>
    saveToolConfigs: (agentId: string, configs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }>) => Promise<void>
    getCustomPrompt: (agentId: string) => Promise<string | null | undefined>
    setCustomPrompt: (agentId: string, prompt: string | null) => Promise<void>
    getInsights: (agentId: string) => Promise<Array<{
      id: string
      content: string
      source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
      createdAt: string
      enabled: boolean
    }> | null>
    saveInsights: (agentId: string, insights: Array<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>) => Promise<void>
    addInsight: (agentId: string, content: string, source: 'tool_feedback' | 'user_feedback' | 'auto_learned') => Promise<{
      id: string
      content: string
      source: string
      createdAt: string
      enabled: boolean
    }>
    removeInsight: (agentId: string, id: string) => Promise<void>
    toggleInsight: (agentId: string, id: string) => Promise<void>
  }
  whatsapp: {
    connect: () => Promise<string | null>
    disconnect: () => Promise<void>
    getStatus: () => Promise<{
      connected: boolean
      phoneNumber: string | null
      connectedAt: number | null
    }>
    isConnected: () => Promise<boolean>
    getContacts: (query?: string) => Promise<Array<{
      jid: string
      name: string | null
      pushName: string | null
      phoneNumber: string | null
      isGroup: boolean
    }>>
    getChats: (limit?: number) => Promise<Array<{
      jid: string
      name: string | null
      isGroup: boolean
      lastMessageTime: number | null
      unreadCount: number
    }>>
    searchMessages: (query: string, chatJid?: string, limit?: number) => Promise<Array<{
      id: string
      from: string
      to: string
      fromMe: boolean
      timestamp: number
      type: string
      content: string | null
      isGroup: boolean
      senderName?: string
    }>>
    getHistory: (chatJid: string, limit?: number) => Promise<Array<{
      id: string
      from: string
      to: string
      fromMe: boolean
      timestamp: number
      type: string
      content: string | null
      isGroup: boolean
      senderName?: string
    }>>
    sendMessage: (to: string, text: string) => Promise<{
      messageId: string
      timestamp: number
    }>
    subscribeQR: () => Promise<void>
    unsubscribeQR: () => Promise<void>
    subscribeConnection: () => Promise<void>
    unsubscribeConnection: () => Promise<void>
    onQRCode: (callback: (qr: string) => void) => () => void
    onConnectionChange: (callback: (data: { connected: boolean; phoneNumber?: string }) => void) => () => void
    getTools: () => Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
    }>>
  }
  googleWorkspace: {
    connect: () => Promise<string>
    disconnect: () => Promise<void>
    getStatus: () => Promise<{
      connected: boolean
      email: string | null
      connectedAt: number | null
      services: {
        gmail: boolean
        calendar: boolean
        drive: boolean
        docs: boolean
      }
    }>
    isConnected: () => Promise<boolean>
    subscribeConnection: () => Promise<void>
    unsubscribeConnection: () => Promise<void>
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
    }) => void) => () => void
    searchEmails: (query: string, maxResults?: number) => Promise<Array<{
      id: string
      threadId: string
      subject: string
      from: string
      date: number
      snippet: string
    }>>
    getEmail: (messageId: string) => Promise<{
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
    }>
    sendEmail: (to: string, subject: string, body: string, cc?: string, bcc?: string) => Promise<{
      messageId: string
      threadId: string
    }>
    getEvents: (calendarId: string, startDate: string, endDate: string, maxResults?: number) => Promise<Array<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }>>
    createEvent: (calendarId: string, event: {
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }) => Promise<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }>
    updateEvent: (calendarId: string, eventId: string, updates: {
      summary?: string
      description?: string
      start?: string
      end?: string
      attendees?: string[]
      location?: string
    }) => Promise<{
      id: string
      summary: string
      description?: string
      start: string
      end: string
      attendees?: string[]
      location?: string
    }>
    listFiles: (query?: string, folderId?: string, maxResults?: number) => Promise<Array<{
      id: string
      name: string
      mimeType: string
      size?: number
      modifiedTime: string
      webViewLink?: string
    }>>
    getFileContent: (fileId: string) => Promise<string>
    readDocument: (documentId: string) => Promise<{
      documentId: string
      title: string
      body: string
    }>
    readSpreadsheet: (spreadsheetId: string, range?: string) => Promise<{
      spreadsheetId: string
      title: string
      sheets: Array<{
        sheetId: number
        title: string
        data: string[][]
      }>
    }>
    getTools: () => Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
      service: 'gmail' | 'calendar' | 'drive' | 'docs'
    }>>
  }
  exa: {
    connect: (apiKey?: string) => Promise<void>
    disconnect: () => Promise<void>
    getStatus: () => Promise<{
      connected: boolean
      apiKeyConfigured: boolean
      error?: string
    }>
    isConnected: () => Promise<boolean>
    subscribeConnection: () => Promise<void>
    unsubscribeConnection: () => Promise<void>
    onConnectionChange: (callback: (status: {
      connected: boolean
      apiKeyConfigured: boolean
      error?: string
    }) => void) => () => void
    getTools: () => Promise<Array<{
      id: string
      name: string
      description: string
      requireApproval: boolean
    }>>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
