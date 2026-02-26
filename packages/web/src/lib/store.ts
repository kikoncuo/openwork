import { create } from 'zustand'
import type { Thread, ModelConfig, Provider, Agent, UserTier } from '@/types'

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

  // User tier (for tier-based model management)
  userTier: UserTier | null

  // Right panel state (UI state, not thread data)
  rightPanelTab: 'todos' | 'files' | 'subagents'

  // Settings dialog state
  settingsOpen: boolean
  /** null = create new agent, string = edit specific agent, undefined = edit active agent */
  settingsAgentId: string | null | undefined
  /** Global settings dialog state */
  globalSettingsOpen: boolean
  /** Agent settings dialog state */
  agentSettingsOpen: boolean
  /** Agent ID for agent settings dialog */
  agentSettingsAgentId: string | null

  // Files panel mode (files view or terminal view)
  filesPanelMode: 'files' | 'terminal'

  // Sidebar state
  sidebarCollapsed: boolean

  // Agent actions
  loadAgents: () => Promise<void>
  setActiveAgent: (agentId: string) => void
  createAgent: (input: { name: string; color?: string; icon?: string; model_default?: string }) => Promise<Agent>
  updateAgent: (agentId: string, updates: { name?: string; color?: string; icon?: string; model_default?: string }) => Promise<Agent | null>
  deleteAgent: (agentId: string) => Promise<{ success: boolean; error?: string; reassignedThreads?: number }>
  /** Open settings. null = create new agent, string = edit specific agent, undefined = edit active agent */
  openSettings: (agentId?: string | null) => void
  closeSettings: () => void
  /** Open global settings dialog */
  openGlobalSettings: () => void
  closeGlobalSettings: () => void
  /** Open agent settings dialog for a specific agent */
  openAgentSettings: (agentId: string) => void
  closeAgentSettings: () => void

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
  /** Update a thread from WebSocket (e.g., thread:updated event) */
  updateThreadFromWebSocket: (threadData: unknown) => void

  // Model actions
  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>

  // Tier actions
  loadUserTier: () => Promise<void>

  // Panel actions
  setRightPanelTab: (tab: 'todos' | 'files' | 'subagents') => void

  // Files panel mode actions
  setFilesPanelMode: (mode: 'files' | 'terminal') => void

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
  userTier: null,
  rightPanelTab: 'todos',
  settingsOpen: false,
  settingsAgentId: undefined,
  globalSettingsOpen: false,
  agentSettingsOpen: false,
  agentSettingsAgentId: null,
  filesPanelMode: 'files',
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

    // Set active agent: restore from localStorage, then fallback to default
    if (!get().activeAgentId && agents.length > 0) {
      const savedAgentId = localStorage.getItem('activeAgentId')
      const savedAgent = savedAgentId ? agents.find((a) => a.agent_id === savedAgentId) : null
      const defaultAgent = savedAgent || agents.find((a) => a.is_default) || agents[0]
      set({ activeAgentId: defaultAgent.agent_id })
    }
  },

  setActiveAgent: (agentId: string) => {
    set({ activeAgentId: agentId })
    localStorage.setItem('activeAgentId', agentId)
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
    localStorage.setItem('activeAgentId', agent.agent_id)
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
      const wasActive = get().activeAgentId === agentId
      set((state) => {
        const agents = state.agents.filter((a) => a.agent_id !== agentId)
        // If deleted agent was active, switch to default
        const newActiveId =
          state.activeAgentId === agentId
            ? agents.find((a) => a.is_default)?.agent_id || agents[0]?.agent_id || null
            : state.activeAgentId
        return { agents, activeAgentId: newActiveId }
      })
      // Persist new active agent if it changed
      if (wasActive) {
        const newActiveId = get().activeAgentId
        if (newActiveId) {
          localStorage.setItem('activeAgentId', newActiveId)
        } else {
          localStorage.removeItem('activeAgentId')
        }
      }
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

  openGlobalSettings: () => {
    set({ globalSettingsOpen: true })
  },

  closeGlobalSettings: () => {
    set({ globalSettingsOpen: false })
  },

  openAgentSettings: (agentId: string) => {
    set({ agentSettingsOpen: true, agentSettingsAgentId: agentId })
  },

  closeAgentSettings: () => {
    set({ agentSettingsOpen: false, agentSettingsAgentId: null })
  },

  // Thread actions
  loadThreads: async () => {
    const threads = await window.api.threads.list()
    set({ threads })

    // Select first thread if none selected
    // Note: Don't call selectThread here - we want to keep the localStorage-restored agent
    // selectThread syncs agent with thread, which would override the persisted selection
    if (!get().currentThreadId && threads.length > 0) {
      set({ currentThreadId: threads[0].thread_id })
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
    // Update currentThreadId - ThreadContext handles per-thread state
    set({ currentThreadId: threadId })

    // Sync activeAgentId with thread's agent
    const thread = get().threads.find((t) => t.thread_id === threadId)
    if (thread?.agent_id) {
      set({ activeAgentId: thread.agent_id })
      localStorage.setItem('activeAgentId', thread.agent_id)
    }

    // Mark thread as read (clear needs_attention) via API
    try {
      if (thread?.needs_attention) {
        await window.api.threads.update(threadId, { needs_attention: false })
        // Update local state
        set((state) => ({
          threads: state.threads.map(t =>
            t.thread_id === threadId ? { ...t, needs_attention: false } : t
          )
        }))
      }
    } catch (error) {
      console.error('[Store] Failed to mark thread as read:', error)
    }
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

  updateThreadFromWebSocket: (threadData: unknown) => {
    const data = threadData as Record<string, unknown>
    const threadId = data.thread_id as string

    if (!threadId) {
      console.warn('[Store] updateThreadFromWebSocket received data without thread_id')
      return
    }

    // Update the thread in place with the new data
    set((state) => {
      const existingIndex = state.threads.findIndex(t => t.thread_id === threadId)
      if (existingIndex === -1) {
        // Thread not found, ignore (might not be loaded yet)
        return state
      }

      // Don't set needs_attention if this is the currently selected thread
      const isCurrentThread = state.currentThreadId === threadId
      const needsAttention = isCurrentThread ? false : (data.needs_attention as boolean | undefined)

      const updatedThreads = [...state.threads]
      const existingThread = updatedThreads[existingIndex]

      // Merge plan_mode into metadata if present in WebSocket data
      let updatedMetadata = existingThread.metadata
      if (data.plan_mode !== undefined) {
        const currentMetadata = (existingThread.metadata as Record<string, unknown>) || {}
        updatedMetadata = { ...currentMetadata, plan_mode: data.plan_mode }
      }

      updatedThreads[existingIndex] = {
        ...existingThread,
        ...(data.title !== undefined && { title: data.title as string }),
        ...(data.status !== undefined && { status: data.status as Thread['status'] }),
        ...(needsAttention !== undefined && { needs_attention: needsAttention }),
        ...(updatedMetadata !== existingThread.metadata && { metadata: updatedMetadata }),
        updated_at: data.updated_at ? new Date(data.updated_at as string) : existingThread.updated_at
      }

      return { threads: updatedThreads }
    })

    console.log('[Store] Thread updated from WebSocket:', threadId, data.needs_attention)
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

  // Tier actions
  loadUserTier: async () => {
    try {
      const tier = await window.api.user.getTier()
      set({ userTier: tier })
      console.log('[Store] User tier loaded:', tier.name)
    } catch (e) {
      console.error('[Store] Failed to load user tier:', e)
    }
  },

  // Panel actions
  setRightPanelTab: (tab: 'todos' | 'files' | 'subagents') => {
    set({ rightPanelTab: tab })
  },

  // Files panel mode actions
  setFilesPanelMode: (mode: 'files' | 'terminal') => {
    set({ filesPanelMode: mode })
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
