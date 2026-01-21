import { create } from 'zustand'
import type { Thread, ModelConfig, Provider, Agent } from '@/types'

interface AppState {
  // Agents
  agents: Agent[]
  activeAgentId: string | null

  // Threads
  threads: Thread[]
  currentThreadId: string | null

  // Models and Providers (global, not per-thread)
  models: ModelConfig[]
  providers: Provider[]

  // Right panel state (UI state, not thread data)
  rightPanelTab: 'todos' | 'files' | 'subagents'

  // Settings dialog state
  settingsOpen: boolean
  /** null = create new agent, string = edit specific agent, undefined = edit active agent */
  settingsAgentId: string | null | undefined

  // Sidebar state
  sidebarCollapsed: boolean

  // Agent actions
  loadAgents: () => Promise<void>
  setActiveAgent: (agentId: string) => void
  createAgent: (input: { name: string; color?: string; icon?: string; model_default?: string; default_workspace_path?: string | null }) => Promise<Agent>
  updateAgent: (agentId: string, updates: { name?: string; color?: string; icon?: string; model_default?: string; default_workspace_path?: string | null }) => Promise<Agent | null>
  deleteAgent: (agentId: string) => Promise<{ success: boolean; error?: string; reassignedThreads?: number }>
  /** Open settings. null = create new agent, string = edit specific agent, undefined = edit active agent */
  openSettings: (agentId?: string | null) => void
  closeSettings: () => void

  // Thread actions
  loadThreads: () => Promise<void>
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>
  selectThread: (threadId: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  generateTitleForFirstMessage: (threadId: string, content: string) => Promise<void>
  reassignThreadToAgent: (threadId: string, agentId: string) => Promise<void>
  /** Add a thread received from WebSocket (e.g., thread:created event) */
  addThreadFromWebSocket: (threadData: unknown) => void

  // Model actions
  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>
  setApiKey: (providerId: string, apiKey: string) => Promise<void>
  deleteApiKey: (providerId: string) => Promise<void>

  // Panel actions
  setRightPanelTab: (tab: 'todos' | 'files' | 'subagents') => void

  // Deprecated - use openSettings/closeSettings instead
  setSettingsOpen: (open: boolean) => void

  // Sidebar actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  agents: [],
  activeAgentId: null,
  threads: [],
  currentThreadId: null,
  models: [],
  providers: [],
  rightPanelTab: 'todos',
  settingsOpen: false,
  settingsAgentId: undefined,
  sidebarCollapsed: false,

  // Agent actions
  loadAgents: async () => {
    const agentsData = await window.api.agents.list()
    // Convert timestamps to Date objects
    const agents: Agent[] = agentsData.map((a) => ({
      ...a,
      is_default: Boolean(a.is_default),
      created_at: new Date(a.created_at),
      updated_at: new Date(a.updated_at),
    }))
    set({ agents })

    // Set active agent to default if none selected
    if (!get().activeAgentId && agents.length > 0) {
      const defaultAgent = agents.find((a) => a.is_default) || agents[0]
      set({ activeAgentId: defaultAgent.agent_id })
    }
  },

  setActiveAgent: (agentId: string) => {
    set({ activeAgentId: agentId })
  },

  createAgent: async (input) => {
    const agentData = await window.api.agents.create(input)
    const agent: Agent = {
      ...agentData,
      is_default: Boolean(agentData.is_default),
      created_at: new Date(agentData.created_at),
      updated_at: new Date(agentData.updated_at),
    }
    set((state) => ({
      agents: [...state.agents, agent],
      activeAgentId: agent.agent_id, // Switch to newly created agent
    }))
    return agent
  },

  updateAgent: async (agentId, updates) => {
    const agentData = await window.api.agents.update(agentId, updates)
    if (!agentData) return null
    const agent: Agent = {
      ...agentData,
      is_default: Boolean(agentData.is_default),
      created_at: new Date(agentData.created_at),
      updated_at: new Date(agentData.updated_at),
    }
    set((state) => ({
      agents: state.agents.map((a) => (a.agent_id === agentId ? agent : a)),
    }))
    return agent
  },

  deleteAgent: async (agentId) => {
    const result = await window.api.agents.delete(agentId)
    if (result.success) {
      set((state) => {
        const agents = state.agents.filter((a) => a.agent_id !== agentId)
        // If deleted agent was active, switch to default
        const newActiveId =
          state.activeAgentId === agentId
            ? agents.find((a) => a.is_default)?.agent_id || agents[0]?.agent_id || null
            : state.activeAgentId
        return { agents, activeAgentId: newActiveId }
      })
      // Reload threads to update agent assignments
      await get().loadThreads()
    }
    return result
  },

  openSettings: (agentId?: string | null) => {
    set({ settingsOpen: true, settingsAgentId: agentId })
  },

  closeSettings: () => {
    set({ settingsOpen: false, settingsAgentId: undefined })
  },

  // Thread actions
  loadThreads: async () => {
    const threads = await window.api.threads.list()
    set({ threads })

    // Select first thread if none selected
    if (!get().currentThreadId && threads.length > 0) {
      await get().selectThread(threads[0].thread_id)
    }
  },

  createThread: async (metadata?: Record<string, unknown>) => {
    // Create thread with active agent
    const activeAgentId = get().activeAgentId
    const thread = await window.api.threads.create(metadata, activeAgentId || undefined)
    set((state) => ({
      threads: [thread, ...state.threads],
      currentThreadId: thread.thread_id
    }))
    return thread
  },

  selectThread: async (threadId: string) => {
    // Just update currentThreadId - ThreadContext handles per-thread state
    set({ currentThreadId: threadId })
  },

  deleteThread: async (threadId: string) => {
    console.log('[Store] Deleting thread:', threadId)
    try {
      await window.api.threads.delete(threadId)
      console.log('[Store] Thread deleted from backend')

      set((state) => {
        const threads = state.threads.filter((t) => t.thread_id !== threadId)
        const wasCurrentThread = state.currentThreadId === threadId
        const newCurrentId = wasCurrentThread
          ? threads[0]?.thread_id || null
          : state.currentThreadId

        return {
          threads,
          currentThreadId: newCurrentId
        }
      })
    } catch (error) {
      console.error('[Store] Failed to delete thread:', error)
    }
  },

  updateThread: async (threadId: string, updates: Partial<Thread>) => {
    const updated = await window.api.threads.update(threadId, updates)
    set((state) => ({
      threads: state.threads.map((t) => (t.thread_id === threadId ? updated : t))
    }))
  },

  generateTitleForFirstMessage: async (threadId: string, content: string) => {
    try {
      const generatedTitle = await window.api.threads.generateTitle(content)
      await get().updateThread(threadId, { title: generatedTitle })
    } catch (error) {
      console.error('[Store] Failed to generate title:', error)
    }
  },

  reassignThreadToAgent: async (threadId: string, agentId: string) => {
    const updated = await window.api.threads.update(threadId, { agent_id: agentId } as Partial<Thread>)
    set((state) => ({
      threads: state.threads.map((t) => (t.thread_id === threadId ? updated : t))
    }))
  },

  addThreadFromWebSocket: (threadData: unknown) => {
    // Parse the thread data from WebSocket event
    const data = threadData as Record<string, unknown>
    const thread: Thread = {
      thread_id: data.thread_id as string,
      created_at: new Date(data.created_at as string),
      updated_at: new Date(data.updated_at as string),
      metadata: data.metadata as Record<string, unknown> | undefined,
      status: (data.status as Thread['status']) || 'idle',
      thread_values: data.thread_values as Record<string, unknown> | undefined,
      title: data.title as string | undefined,
      agent_id: data.agent_id as string | null | undefined,
      source: (data.source as Thread['source']) || 'chat',
      whatsapp_jid: data.whatsapp_jid as string | null | undefined,
      whatsapp_contact_name: data.whatsapp_contact_name as string | null | undefined
    }

    // Add to the beginning of threads list if not already present
    set((state) => {
      const exists = state.threads.some((t) => t.thread_id === thread.thread_id)
      if (exists) {
        return state // Thread already exists, don't duplicate
      }
      return {
        threads: [thread, ...state.threads]
      }
    })

    console.log('[Store] Thread added from WebSocket:', thread.thread_id, thread.title)
  },

  // Model actions
  loadModels: async () => {
    const models = await window.api.models.list()
    set({ models })
  },

  loadProviders: async () => {
    const providers = await window.api.models.listProviders()
    set({ providers })
  },

  setApiKey: async (providerId: string, apiKey: string) => {
    console.log('[Store] setApiKey called:', { providerId, keyLength: apiKey.length })
    try {
      await window.api.models.setApiKey(providerId, apiKey)
      console.log('[Store] API key saved via IPC')
      // Reload providers and models to update availability
      await get().loadProviders()
      await get().loadModels()
      console.log('[Store] Providers and models reloaded')
    } catch (e) {
      console.error('[Store] Failed to set API key:', e)
      throw e
    }
  },

  deleteApiKey: async (providerId: string) => {
    await window.api.models.deleteApiKey(providerId)
    // Reload providers and models to update availability
    await get().loadProviders()
    await get().loadModels()
  },

  // Panel actions
  setRightPanelTab: (tab: 'todos' | 'files' | 'subagents') => {
    set({ rightPanelTab: tab })
  },

  // Settings actions (deprecated - use openSettings/closeSettings)
  setSettingsOpen: (open: boolean) => {
    if (open) {
      set({ settingsOpen: true, settingsAgentId: undefined })
    } else {
      set({ settingsOpen: false, settingsAgentId: undefined })
    }
  },

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  }
}))
