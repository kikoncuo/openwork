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
    }): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
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
    }): Promise<{
      agent_id: string
      name: string
      color: string
      icon: string
      model_default: string
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
