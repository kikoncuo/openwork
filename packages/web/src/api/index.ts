/**
 * API client that replaces window.api from Electron preload
 * Provides the same interface for frontend components
 */

import { api } from './client'
import { ws } from './websocket'
import type { Thread, Agent, ModelConfig, Provider } from '@/types'

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
  },

  models: {
    list: (): Promise<ModelConfig[]> => api.get('/models'),
    listProviders: (): Promise<Provider[]> => api.get('/models/providers'),
    getDefault: (): Promise<string> =>
      api.get<{ modelId: string }>('/models/default').then((r) => r.modelId),
    setDefault: (modelId: string): Promise<void> => api.put('/models/default', { modelId }),
    setApiKey: (provider: string, apiKey: string): Promise<void> =>
      api.put(`/models/providers/${provider}/key`, { apiKey }),
    getApiKey: (provider: string): Promise<string | null> =>
      api.get<{ apiKey: string | null }>(`/models/providers/${provider}/key`).then((r) => r.apiKey),
    deleteApiKey: (provider: string): Promise<void> => api.delete(`/models/providers/${provider}/key`),
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
      error?: string
    }> => api.get(`/workspace/backup/file?agentId=${agentId}&path=${encodeURIComponent(filePath)}`),

    backupWriteFile: (agentId: string, filePath: string, content: string): Promise<{
      success: boolean
      path?: string
      error?: string
    }> => api.post('/workspace/backup/file', { agentId, path: filePath, content }),

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
  },

  agent: {
    invoke: (
      threadId: string,
      message: string,
      onEvent: StreamEventCallback,
      modelId?: string
    ): CleanupFn => {
      ws.emit('agent:invoke', { threadId, message, modelId })
      return ws.on(`agent:stream:${threadId}`, onEvent)
    },
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: StreamEventCallback,
      modelId?: string
    ): CleanupFn => {
      if (command) {
        ws.emit('agent:resume', { threadId, command, modelId })
      } else {
        ws.emit('agent:invoke', { threadId, message, modelId })
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
