import { useState, useEffect } from 'react'
import { Eye, EyeOff, Check, AlertCircle, Loader2, Plus, Trash2, Power, PowerOff, Wrench, Plug, RefreshCw, ShieldCheck, ShieldOff, XCircle, FileText, Sparkles, RotateCcw, Bot, AppWindow, FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/lib/store'
import { AgentIconComponent, AGENT_ICON_LABELS } from '@/lib/agent-icons'
import { AppsTab } from './apps/AppsTab'
import type { AgentIcon } from '@/types'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** If provided, edit this agent. If null, create new agent. If undefined, edit active agent. */
  agentId?: string | null
}

interface ProviderConfig {
  id: string
  name: string
  envVar: string
  placeholder: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-...'
  },
  {
    id: 'google',
    name: 'Google AI',
    envVar: 'GOOGLE_API_KEY',
    placeholder: 'AIza...'
  }
]

interface MCPServer {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
}

interface MCPServerStatus {
  status: 'unknown' | 'testing' | 'connected' | 'error'
  error?: string
  tools: Array<{ name: string; description: string }>
}

interface ToolConfig {
  id: string
  name: string
  description: string
  enabled: boolean
  requireApproval?: boolean
  source: 'builtin' | 'mcp' | 'app'
  mcpServerName?: string
  appName?: string
}

interface LearnedInsight {
  id: string
  content: string
  source: string // Can be 'tool_feedback' | 'user_feedback' | 'auto_learned' or other custom values
  createdAt: string
  enabled: boolean
}

const AGENT_ICONS: AgentIcon[] = ['bot', 'sparkles', 'code', 'pen', 'search', 'terminal', 'brain', 'shield']

const AGENT_COLORS = [
  '#8B5CF6', // Purple (default)
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#14B8A6', // Teal
]

// Default built-in tools - matches deepagents tools
const DEFAULT_TOOLS: ToolConfig[] = [
  // File System Tools
  { id: 'ls', name: 'List Directory', description: 'List files and directories', enabled: true, requireApproval: false, source: 'builtin' },
  { id: 'read_file', name: 'Read File', description: 'Read file contents with pagination support', enabled: true, requireApproval: false, source: 'builtin' },
  { id: 'write_file', name: 'Write File', description: 'Create new files', enabled: true, requireApproval: false, source: 'builtin' },
  { id: 'edit_file', name: 'Edit File', description: 'Replace strings in existing files', enabled: true, requireApproval: false, source: 'builtin' },
  { id: 'glob', name: 'Glob Search', description: 'Find files by pattern (e.g., "**/*.py")', enabled: true, requireApproval: false, source: 'builtin' },
  { id: 'grep', name: 'Grep Search', description: 'Search for text/regex within files', enabled: true, requireApproval: false, source: 'builtin' },
  // Execution
  { id: 'execute', name: 'Shell Execute', description: 'Run shell commands (requires user approval)', enabled: true, requireApproval: true, source: 'builtin' },
  // Task Management
  { id: 'write_todos', name: 'Task List', description: 'Create and manage structured task lists for complex multi-step work', enabled: true, requireApproval: false, source: 'builtin' },
  // Subagent Delegation
  { id: 'task', name: 'Spawn Subagent', description: 'Spawn isolated subagents for complex, independent tasks', enabled: true, requireApproval: false, source: 'builtin' },
  // Memory
  { id: 'learn_insight', name: 'Learn Insight', description: 'Save learned insights or preferences to remember for future conversations', enabled: true, requireApproval: false, source: 'builtin' },
]

// Simple label component
function Label({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={`text-sm font-medium leading-none ${className || ''}`}>
      {children}
    </label>
  )
}

export function SettingsDialog({ open, onOpenChange, agentId: propAgentId }: SettingsDialogProps) {
  // Determine which agent to edit
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const createAgent = useAppStore((s) => s.createAgent)
  const updateAgent = useAppStore((s) => s.updateAgent)
  const models = useAppStore((s) => s.models)

  // null = creating new agent, string = editing existing agent
  const isCreatingNew = propAgentId === null
  const targetAgentId = propAgentId === undefined ? activeAgentId : propAgentId
  const existingAgent = targetAgentId ? agents.find((a) => a.agent_id === targetAgentId) : null

  const [activeTab, setActiveTab] = useState<'agent' | 'api-keys' | 'apps' | 'mcp' | 'tools' | 'prompt'>('agent')
  const [loading, setLoading] = useState(true)

  // Agent properties state
  const [agentName, setAgentName] = useState('')
  const [agentColor, setAgentColor] = useState(AGENT_COLORS[0])
  const [agentIcon, setAgentIcon] = useState<AgentIcon>('bot')
  const [agentModel, setAgentModel] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)

  // API keys state (global, shared across agents)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpStatus, setMcpStatus] = useState<Record<string, MCPServerStatus>>({})
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')
  const [newMcpArgs, setNewMcpArgs] = useState('')

  // Tools state - includes both builtin and MCP tools
  const [tools, setTools] = useState<ToolConfig[]>(DEFAULT_TOOLS)

  // System prompt state
  const [basePrompt, setBasePrompt] = useState<string>('')
  const [customPrompt, setCustomPrompt] = useState<string>('')
  const [promptModified, setPromptModified] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [insights, setInsights] = useState<LearnedInsight[]>([])
  const [newInsight, setNewInsight] = useState('')

  // Load settings when dialog opens
  useEffect(() => {
    if (open) {
      loadAllSettings()
    }
  }, [open, targetAgentId, isCreatingNew])

  // Listen for WhatsApp connection changes to reload tools
  useEffect(() => {
    if (!open) return

    const cleanup = window.api.whatsapp.onConnectionChange(async (data) => {
      console.log('[Settings] WhatsApp connection changed:', data)

      // Filter out existing WhatsApp tools first
      setTools(prevTools => {
        const nonWhatsAppTools = prevTools.filter(t => !(t.source === 'app' && t.appName === 'WhatsApp'))

        if (data.connected) {
          // Load saved configs and WhatsApp tools asynchronously
          Promise.all([
            window.api.tools.getConfigs(),
            window.api.whatsapp.getTools()
          ]).then(([savedConfigs, whatsappTools]) => {
            console.log('[Settings] Connection change - loading WhatsApp tools:', whatsappTools)
            const whatsappToolConfigs: ToolConfig[] = whatsappTools.map(t => {
              const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
              return {
                id: t.id,
                name: t.name,
                description: t.description,
                enabled: savedConfig?.enabled ?? true,
                requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
                source: 'app' as const,
                appName: 'WhatsApp'
              }
            })
            setTools(current => {
              const filtered = current.filter(tool => !(tool.source === 'app' && tool.appName === 'WhatsApp'))
              return [...filtered, ...whatsappToolConfigs]
            })
          }).catch(e => console.error('Failed to load WhatsApp tools on connection change:', e))
        }

        return nonWhatsAppTools  // Immediately remove WhatsApp tools if disconnected
      })
    })

    // Subscribe to connection events
    window.api.whatsapp.subscribeConnection()

    return () => {
      cleanup()
      window.api.whatsapp.unsubscribeConnection()
    }
  }, [open])

  // Reload WhatsApp tools when switching to Tools tab (ensures tools appear if loaded late)
  useEffect(() => {
    if (activeTab !== 'tools' || loading) return

    // Check if WhatsApp is connected but tools aren't loaded yet
    const checkAndLoadWhatsAppTools = async () => {
      try {
        const status = await window.api.whatsapp.getStatus()
        if (status.connected) {
          const hasWhatsAppTools = tools.some(t => t.source === 'app' && t.appName === 'WhatsApp')
          if (!hasWhatsAppTools) {
            console.log('[Settings] Tools tab: WhatsApp connected but no tools found, reloading...')
            // Load saved configs to restore user preferences
            const savedConfigs = await window.api.tools.getConfigs()
            const whatsappTools = await window.api.whatsapp.getTools()
            const whatsappToolConfigs: ToolConfig[] = whatsappTools.map(t => {
              const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
              return {
                id: t.id,
                name: t.name,
                description: t.description,
                enabled: savedConfig?.enabled ?? true,
                requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
                source: 'app' as const,
                appName: 'WhatsApp'
              }
            })
            setTools(prev => [...prev.filter(t => !(t.source === 'app' && t.appName === 'WhatsApp')), ...whatsappToolConfigs])
          }
        }
      } catch (e) {
        console.error('Failed to check/load WhatsApp tools on tab switch:', e)
      }
    }

    checkAndLoadWhatsAppTools()
  }, [activeTab, loading, tools])

  async function loadAllSettings() {
    setLoading(true)

    // Load agent properties
    if (existingAgent) {
      setAgentName(existingAgent.name)
      setAgentColor(existingAgent.color)
      setAgentIcon(existingAgent.icon)
      setAgentModel(existingAgent.model_default)
    } else {
      // New agent defaults
      setAgentName('')
      setAgentColor(AGENT_COLORS[0])
      setAgentIcon('bot')
      setAgentModel(models[0]?.id || '')
    }

    // Load API keys (global)
    const keys: Record<string, string> = {}
    const saved: Record<string, boolean> = {}

    for (const provider of PROVIDERS) {
      try {
        const key = await window.api.models.getApiKey(provider.id)
        if (key) {
          keys[provider.id] = '••••••••••••••••'
          saved[provider.id] = true
        } else {
          keys[provider.id] = ''
          saved[provider.id] = false
        }
      } catch {
        keys[provider.id] = ''
        saved[provider.id] = false
      }
    }

    setApiKeys(keys)
    setSavedKeys(saved)

    // Load tool configs (needed for both built-in and app tools)
    let savedConfigs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }> = []
    try {
      savedConfigs = await window.api.tools.getConfigs()
    } catch (e) {
      console.error('Failed to load tool configs:', e)
    }

    // Apply saved configs to built-in tools
    let mergedTools: ToolConfig[] = DEFAULT_TOOLS.map((t) => {
      const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
      return savedConfig ? { ...t, enabled: savedConfig.enabled, requireApproval: savedConfig.requireApproval ?? t.requireApproval } : t
    })

    // Load WhatsApp tools if connected (with saved config applied)
    try {
      const whatsappStatus = await window.api.whatsapp.getStatus()
      console.log('[Settings] WhatsApp status:', whatsappStatus)
      if (whatsappStatus.connected) {
        const whatsappTools = await window.api.whatsapp.getTools()
        console.log('[Settings] WhatsApp tools loaded:', whatsappTools)
        const whatsappToolConfigs: ToolConfig[] = whatsappTools.map(t => {
          const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            enabled: savedConfig?.enabled ?? true,
            requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
            source: 'app' as const,
            appName: 'WhatsApp'
          }
        })
        mergedTools = [...mergedTools, ...whatsappToolConfigs]
        console.log('[Settings] Merged tools with WhatsApp:', mergedTools.length)
      }
    } catch (e) {
      console.error('Failed to load WhatsApp tools:', e)
    }

    setTools(mergedTools)

    // Load MCP servers and test connections
    try {
      const servers = await window.api.mcp.list() as MCPServer[]
      setMcpServers(servers)

      const enabledServers = servers.filter(s => s.enabled)
      if (enabledServers.length > 0) {
        await Promise.all(enabledServers.map(server => testMcpConnection(server)))
      }
    } catch (e) {
      console.error('Failed to load MCP servers:', e)
    }

    // Load system prompt data
    try {
      const [base, custom, loadedInsights] = await Promise.all([
        window.api.prompt.getBase(),
        window.api.prompt.getCustom(),
        window.api.insights.list()
      ])
      setBasePrompt(base)
      setCustomPrompt(custom || '')
      setPromptModified(false)
      setInsights(loadedInsights)
    } catch (e) {
      console.error('Failed to load prompt data:', e)
    }

    setLoading(false)
  }

  async function testMcpConnection(server: MCPServer) {
    setMcpStatus(prev => ({
      ...prev,
      [server.id]: { status: 'testing', tools: [] }
    }))

    try {
      const result = await window.api.mcp.testConnection({
        name: server.name,
        command: server.command,
        args: server.args
      })

      if (result.success) {
        setMcpStatus(prev => ({
          ...prev,
          [server.id]: { status: 'connected', tools: result.tools }
        }))

        // Load saved configs to restore user preferences for MCP tools
        const savedConfigs = await window.api.tools.getConfigs()

        const mcpTools: ToolConfig[] = result.tools.map(t => {
          const toolId = `mcp:${server.name}:${t.name}`
          const savedConfig = savedConfigs.find((c: { id: string }) => c.id === toolId)
          return {
            id: toolId,
            name: t.name,
            description: t.description || `Tool from ${server.name}`,
            enabled: savedConfig?.enabled ?? true,
            requireApproval: savedConfig?.requireApproval ?? false,
            source: 'mcp' as const,
            mcpServerName: server.name
          }
        })

        setTools(prev => {
          const filtered = prev.filter(t => t.mcpServerName !== server.name)
          return [...filtered, ...mcpTools]
        })
      } else {
        setMcpStatus(prev => ({
          ...prev,
          [server.id]: { status: 'error', error: result.error, tools: [] }
        }))
      }
    } catch (e) {
      setMcpStatus(prev => ({
        ...prev,
        [server.id]: {
          status: 'error',
          error: e instanceof Error ? e.message : 'Connection failed',
          tools: []
        }
      }))
    }
  }

  // Agent save handler
  async function handleSaveAgent() {
    if (!agentName.trim()) return

    setSavingAgent(true)
    try {
      if (isCreatingNew) {
        await createAgent({
          name: agentName.trim(),
          color: agentColor,
          icon: agentIcon,
          model_default: agentModel,
        })
        onOpenChange(false)
      } else if (targetAgentId) {
        await updateAgent(targetAgentId, {
          name: agentName.trim(),
          color: agentColor,
          icon: agentIcon,
          model_default: agentModel,
        })
      }
    } catch (error) {
      console.error('Failed to save agent:', error)
    } finally {
      setSavingAgent(false)
    }
  }

  // API key handlers
  async function saveApiKey(providerId: string) {
    const key = apiKeys[providerId]
    if (!key || key === '••••••••••••••••') return

    setSaving((prev) => ({ ...prev, [providerId]: true }))

    try {
      await window.api.models.setApiKey(providerId, key)
      setSavedKeys((prev) => ({ ...prev, [providerId]: true }))
      setApiKeys((prev) => ({ ...prev, [providerId]: '••••••••••••••••' }))
      setShowKeys((prev) => ({ ...prev, [providerId]: false }))
    } catch (e) {
      console.error('Failed to save API key:', e)
    } finally {
      setSaving((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  function handleKeyChange(providerId: string, value: string) {
    if (apiKeys[providerId] === '••••••••••••••••' && value.length > 16) {
      value = value.slice(16)
    }
    setApiKeys((prev) => ({ ...prev, [providerId]: value }))
    setSavedKeys((prev) => ({ ...prev, [providerId]: false }))
  }

  function toggleShowKey(providerId: string) {
    setShowKeys((prev) => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  // MCP handlers
  async function addMcpServer() {
    if (!newMcpName.trim() || !newMcpCommand.trim()) return
    const newServer: MCPServer = {
      id: `mcp-${Date.now()}`,
      name: newMcpName.trim(),
      command: newMcpCommand.trim(),
      args: newMcpArgs.split(' ').filter(Boolean),
      enabled: true
    }
    const updated = [...mcpServers, newServer]
    setMcpServers(updated)
    setNewMcpName('')
    setNewMcpCommand('')
    setNewMcpArgs('')

    try {
      await window.api.mcp.save(updated)
      testMcpConnection(newServer)
    } catch (e) {
      console.error('Failed to save MCP server:', e)
    }
  }

  async function removeMcpServer(id: string) {
    const server = mcpServers.find(s => s.id === id)
    const updated = mcpServers.filter((s) => s.id !== id)
    setMcpServers(updated)

    if (server) {
      setTools(prev => prev.filter(t => t.mcpServerName !== server.name))
    }

    setMcpStatus(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })

    try {
      await window.api.mcp.save(updated)
    } catch (e) {
      console.error('Failed to remove MCP server:', e)
    }
  }

  async function toggleMcpServer(id: string) {
    const server = mcpServers.find(s => s.id === id)
    const updated = mcpServers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    )
    setMcpServers(updated)

    try {
      await window.api.mcp.save(updated)

      if (server && !server.enabled) {
        testMcpConnection({ ...server, enabled: true })
      } else if (server) {
        setTools(prev => prev.filter(t => t.mcpServerName !== server.name))
        setMcpStatus(prev => {
          const { [id]: _, ...rest } = prev
          return rest
        })
      }
    } catch (e) {
      console.error('Failed to toggle MCP server:', e)
    }
  }

  // Tool handlers
  async function toggleTool(id: string) {
    const updated = tools.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t
    )
    setTools(updated)

    try {
      await window.api.tools.saveConfigs(updated.map((t) => ({
        id: t.id,
        enabled: t.enabled,
        requireApproval: t.requireApproval
      })))
    } catch (e) {
      console.error('Failed to save tool config:', e)
    }
  }

  async function toggleToolApproval(id: string) {
    const updated = tools.map((t) =>
      t.id === id ? { ...t, requireApproval: !t.requireApproval } : t
    )
    setTools(updated)

    try {
      await window.api.tools.saveConfigs(updated.map((t) => ({
        id: t.id,
        enabled: t.enabled,
        requireApproval: t.requireApproval
      })))
    } catch (e) {
      console.error('Failed to save tool config:', e)
    }
  }

  const builtinTools = tools.filter(t => t.source === 'builtin')
  const mcpTools = tools.filter(t => t.source === 'mcp')
  const appTools = tools.filter(t => t.source === 'app')

  // Prompt handlers
  async function saveCustomPrompt() {
    setSavingPrompt(true)
    try {
      const promptToSave = customPrompt.trim() || null
      await window.api.prompt.setCustom(promptToSave)
      setPromptModified(false)
    } catch (e) {
      console.error('Failed to save custom prompt:', e)
    } finally {
      setSavingPrompt(false)
    }
  }

  async function resetToBasePrompt() {
    setCustomPrompt('')
    setPromptModified(true)
  }

  async function addInsight() {
    if (!newInsight.trim()) return
    try {
      const insight = await window.api.insights.add(newInsight.trim(), 'user_feedback')
      setInsights(prev => [...prev, insight])
      setNewInsight('')
    } catch (e) {
      console.error('Failed to add insight:', e)
    }
  }

  async function removeInsight(id: string) {
    try {
      await window.api.insights.remove(id)
      setInsights(prev => prev.filter(i => i.id !== id))
    } catch (e) {
      console.error('Failed to remove insight:', e)
    }
  }

  async function toggleInsight(id: string) {
    try {
      await window.api.insights.toggle(id)
      setInsights(prev => prev.map(i =>
        i.id === id ? { ...i, enabled: !i.enabled } : i
      ))
    } catch (e) {
      console.error('Failed to toggle insight:', e)
    }
  }

  const enabledInsightsCount = insights.filter(i => i.enabled).length

  function getMcpStatusIcon(serverId: string) {
    const status = mcpStatus[serverId]
    if (!status || status.status === 'unknown') {
      return <div className="size-2 rounded-full bg-muted-foreground" />
    }
    if (status.status === 'testing') {
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />
    }
    if (status.status === 'connected') {
      return <Check className="size-4 text-status-nominal" />
    }
    return <XCircle className="size-4 text-status-critical" />
  }

  const dialogTitle = isCreatingNew
    ? 'Create New Agent'
    : existingAgent
      ? `Settings - ${existingAgent.name}`
      : 'Settings'

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {isCreatingNew
              ? 'Create a new agent with custom settings.'
              : 'Configure your agent\'s capabilities and connections.'}
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'agent'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Bot className="size-4" />
            Agent
            {activeTab === 'agent' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('api-keys')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === 'api-keys'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            API Keys
            {activeTab === 'api-keys' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('apps')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'apps'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <AppWindow className="size-4" />
            Apps
            {activeTab === 'apps' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('mcp')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'mcp'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Plug className="size-4" />
            MCP
            {activeTab === 'mcp' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'tools'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Wrench className="size-4" />
            Tools
            {mcpTools.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">
                {mcpTools.length}
              </span>
            )}
            {activeTab === 'tools' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'prompt'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="size-4" />
            Prompt
            {enabledInsightsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-accent/20 text-accent rounded">
                {enabledInsightsCount}
              </span>
            )}
            {activeTab === 'prompt' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          {/* Agent Tab */}
          {activeTab === 'agent' && (
            <div className="space-y-6 py-4">
              <div className="text-section-header">AGENT PROPERTIES</div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Name */}
                  <div className="grid gap-2">
                    <Label htmlFor="agent-name">Name</Label>
                    <Input
                      id="agent-name"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="Enter agent name..."
                    />
                  </div>

                  {/* Icon */}
                  <div className="grid gap-2">
                    <Label>Icon</Label>
                    <div className="flex flex-wrap gap-2">
                      {AGENT_ICONS.map((iconOption) => (
                        <button
                          key={iconOption}
                          type="button"
                          onClick={() => setAgentIcon(iconOption)}
                          className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-colors ${
                            agentIcon === iconOption
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                          title={AGENT_ICON_LABELS[iconOption]}
                        >
                          <AgentIconComponent icon={iconOption} size={20} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color */}
                  <div className="grid gap-2">
                    <Label>Color</Label>
                    <div className="flex flex-wrap gap-2">
                      {AGENT_COLORS.map((colorOption) => (
                        <button
                          key={colorOption}
                          type="button"
                          onClick={() => setAgentColor(colorOption)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${
                            agentColor === colorOption
                              ? 'border-white scale-110'
                              : 'border-transparent hover:scale-105'
                          }`}
                          style={{ backgroundColor: colorOption }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="grid gap-2">
                    <Label>Preview</Label>
                    <div className="flex items-center justify-center p-4 rounded-lg bg-background border">
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md"
                        style={{
                          backgroundColor: `${agentColor}15`,
                          border: `1px solid ${agentColor}50`,
                          color: agentColor,
                        }}
                      >
                        <AgentIconComponent icon={agentIcon} size={16} />
                        <span className="font-bold uppercase tracking-wider text-sm">
                          {agentName || 'Agent Name'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Default Model */}
                  <div className="grid gap-2">
                    <Label htmlFor="agent-model">Default Model</Label>
                    <select
                      id="agent-model"
                      value={agentModel}
                      onChange={(e) => setAgentModel(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {models.map((model) => (
                        <option key={model.id} value={model.id} disabled={!model.available}>
                          {model.name} {!model.available && '(No API Key)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Save Agent Button */}
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleSaveAgent}
                      disabled={!agentName.trim() || savingAgent}
                    >
                      {savingAgent ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : null}
                      {isCreatingNew ? 'Create Agent' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === 'api-keys' && (
            <div className="space-y-6 py-4">
              <div className="text-section-header">API KEYS</div>
              <p className="text-xs text-muted-foreground">
                API keys are shared across all agents.
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {PROVIDERS.map((provider) => (
                    <div key={provider.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">{provider.name}</label>
                        {savedKeys[provider.id] ? (
                          <span className="flex items-center gap-1 text-xs text-status-nominal">
                            <Check className="size-3" />
                            Configured
                          </span>
                        ) : apiKeys[provider.id] ? (
                          <span className="flex items-center gap-1 text-xs text-status-warning">
                            <AlertCircle className="size-3" />
                            Unsaved
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not set</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showKeys[provider.id] ? 'text' : 'password'}
                            value={apiKeys[provider.id] || ''}
                            onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                            placeholder={provider.placeholder}
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => toggleShowKey(provider.id)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showKeys[provider.id] ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </button>
                        </div>
                        <Button
                          variant={savedKeys[provider.id] ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => saveApiKey(provider.id)}
                          disabled={
                            saving[provider.id] ||
                            !apiKeys[provider.id] ||
                            apiKeys[provider.id] === '••••••••••••••••'
                          }
                        >
                          {saving[provider.id] ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            'Save'
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Environment variable: <code className="text-foreground">{provider.envVar}</code>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Apps Tab */}
          {activeTab === 'apps' && <AppsTab />}

          {/* MCP Servers Tab */}
          {activeTab === 'mcp' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">MCP SERVERS</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Connect Model Context Protocol servers to extend your assistant's capabilities.
                </p>
              </div>

              {/* Add new MCP server form */}
              <div className="space-y-3 p-4 border border-border rounded-sm bg-background">
                <div className="text-sm font-medium">Add MCP Server</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Name</label>
                    <Input
                      value={newMcpName}
                      onChange={(e) => setNewMcpName(e.target.value)}
                      placeholder="e.g., filesystem"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Command</label>
                    <Input
                      value={newMcpCommand}
                      onChange={(e) => setNewMcpCommand(e.target.value)}
                      placeholder="e.g., npx or uvx"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Arguments (space-separated)</label>
                  <Input
                    value={newMcpArgs}
                    onChange={(e) => setNewMcpArgs(e.target.value)}
                    placeholder="e.g., -y @modelcontextprotocol/server-filesystem /path"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Example: <code>uvx</code> with <code>mcp-server-fetch</code> or <code>npx</code> with <code>-y @modelcontextprotocol/server-filesystem /path</code>
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={addMcpServer}
                  disabled={!newMcpName.trim() || !newMcpCommand.trim()}
                >
                  <Plus className="size-4" />
                  Add Server
                </Button>
              </div>

              {/* MCP server list */}
              <div className="space-y-2">
                {mcpServers.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <Plug className="size-8 mx-auto mb-2 opacity-50" />
                    <p>No MCP servers configured</p>
                    <p className="text-xs mt-1">Add a server above to get started</p>
                  </div>
                ) : (
                  mcpServers.map((server) => {
                    const status = mcpStatus[server.id]
                    return (
                      <div
                        key={server.id}
                        className={`p-3 border rounded-sm transition-colors ${
                          server.enabled
                            ? 'border-border bg-background-elevated'
                            : 'border-border/50 bg-background opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`p-1.5 rounded ${server.enabled ? 'bg-status-nominal/20' : 'bg-muted'}`}>
                              {server.enabled ? (
                                <Power className="size-4 text-status-nominal" />
                              ) : (
                                <PowerOff className="size-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{server.name}</span>
                                {server.enabled && getMcpStatusIcon(server.id)}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {server.command} {server.args.join(' ')}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {server.enabled && status?.status !== 'testing' && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => testMcpConnection(server)}
                                title="Test connection"
                              >
                                <RefreshCw className="size-4" />
                              </Button>
                            )}
                            <Switch
                              checked={server.enabled}
                              onCheckedChange={() => toggleMcpServer(server.id)}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeMcpServer(server.id)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>

                        {server.enabled && status && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            {status.status === 'testing' && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3 animate-spin" />
                                Testing connection...
                              </div>
                            )}
                            {status.status === 'error' && (
                              <div className="flex items-start gap-2 text-xs text-status-critical">
                                <XCircle className="size-3 mt-0.5 shrink-0" />
                                <span className="break-all">{status.error}</span>
                              </div>
                            )}
                            {status.status === 'connected' && status.tools.length > 0 && (
                              <div className="text-xs">
                                <span className="text-status-nominal">Connected</span>
                                <span className="text-muted-foreground"> - {status.tools.length} tool{status.tools.length !== 1 ? 's' : ''} available</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">BUILT-IN TOOLS</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Core tools available to your AI assistant. Toggle approval to require confirmation before execution.
                </p>
              </div>

              <div className="space-y-2">
                {builtinTools.map((tool) => (
                  <div
                    key={tool.id}
                    className={`flex items-center justify-between p-3 border rounded-sm transition-colors ${
                      tool.enabled
                        ? 'border-border bg-background-elevated'
                        : 'border-border/50 bg-background opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-1.5 rounded ${tool.enabled ? 'bg-primary/20' : 'bg-muted'}`}>
                        <Wrench className={`size-4 ${tool.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{tool.name}</div>
                        <div className="text-xs text-muted-foreground">{tool.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {tool.enabled && (
                        <button
                          onClick={() => toggleToolApproval(tool.id)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                            tool.requireApproval
                              ? 'bg-status-warning/20 text-status-warning'
                              : 'bg-muted text-muted-foreground hover:text-foreground'
                          }`}
                          title={tool.requireApproval ? 'Approval required' : 'No approval needed'}
                        >
                          {tool.requireApproval ? (
                            <>
                              <ShieldCheck className="size-3" />
                              Approval
                            </>
                          ) : (
                            <>
                              <ShieldOff className="size-3" />
                              Auto
                            </>
                          )}
                        </button>
                      )}
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={() => toggleTool(tool.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* MCP-provided tools section */}
              {mcpTools.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="text-section-header mb-2">MCP TOOLS</div>
                    <p className="text-xs text-muted-foreground mb-4">
                      Tools provided by your connected MCP servers. Toggle approval to require confirmation before execution.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {mcpTools.map((tool) => (
                      <div
                        key={tool.id}
                        className={`flex items-center justify-between p-3 border rounded-sm transition-colors ${
                          tool.enabled
                            ? 'border-border bg-background-elevated'
                            : 'border-border/50 bg-background opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`p-1.5 rounded ${tool.enabled ? 'bg-accent/20' : 'bg-muted'}`}>
                            <Plug className={`size-4 ${tool.enabled ? 'text-accent' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{tool.name}</span>
                              <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                {tool.mcpServerName}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{tool.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {tool.enabled && (
                            <button
                              onClick={() => toggleToolApproval(tool.id)}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                                tool.requireApproval
                                  ? 'bg-status-warning/20 text-status-warning'
                                  : 'bg-muted text-muted-foreground hover:text-foreground'
                              }`}
                              title={tool.requireApproval ? 'Approval required' : 'No approval needed'}
                            >
                              {tool.requireApproval ? (
                                <>
                                  <ShieldCheck className="size-3" />
                                  Approval
                                </>
                              ) : (
                                <>
                                  <ShieldOff className="size-3" />
                                  Auto
                                </>
                              )}
                            </button>
                          )}
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => toggleTool(tool.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {mcpServers.some(s => s.enabled) && mcpTools.length === 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="text-section-header mb-2">MCP TOOLS</div>
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      <Loader2 className="size-5 mx-auto mb-2 animate-spin opacity-50" />
                      <p>Connecting to MCP servers...</p>
                    </div>
                  </div>
                </>
              )}

              {/* App-provided tools section */}
              {appTools.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="text-section-header mb-2">APP TOOLS</div>
                    <p className="text-xs text-muted-foreground mb-4">
                      Tools provided by your connected apps. Toggle approval to require confirmation before execution.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {appTools.map((tool) => (
                      <div
                        key={tool.id}
                        className={`flex items-center justify-between p-3 border rounded-sm transition-colors ${
                          tool.enabled
                            ? 'border-border bg-background-elevated'
                            : 'border-border/50 bg-background opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`p-1.5 rounded ${tool.enabled ? 'bg-status-nominal/20' : 'bg-muted'}`}>
                            <AppWindow className={`size-4 ${tool.enabled ? 'text-status-nominal' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{tool.name}</span>
                              <span className="text-xs px-1.5 py-0.5 bg-status-nominal/10 rounded text-status-nominal">
                                {tool.appName}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{tool.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {tool.enabled && (
                            <button
                              onClick={() => toggleToolApproval(tool.id)}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                                tool.requireApproval
                                  ? 'bg-status-warning/20 text-status-warning'
                                  : 'bg-muted text-muted-foreground hover:text-foreground'
                              }`}
                              title={tool.requireApproval ? 'Approval required' : 'No approval needed'}
                            >
                              {tool.requireApproval ? (
                                <>
                                  <ShieldCheck className="size-3" />
                                  Approval
                                </>
                              ) : (
                                <>
                                  <ShieldOff className="size-3" />
                                  Auto
                                </>
                              )}
                            </button>
                          )}
                          <Switch
                            checked={tool.enabled}
                            onCheckedChange={() => toggleTool(tool.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* System Prompt Tab */}
          {activeTab === 'prompt' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">SYSTEM PROMPT</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Customize the base instructions for your AI assistant. Leave empty to use the default prompt.
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Custom Prompt</label>
                      <div className="flex items-center gap-2">
                        {promptModified && (
                          <span className="flex items-center gap-1 text-xs text-status-warning">
                            <AlertCircle className="size-3" />
                            Unsaved
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={resetToBasePrompt}
                          className="text-xs"
                          title="Reset to default prompt"
                        >
                          <RotateCcw className="size-3 mr-1" />
                          Reset
                        </Button>
                      </div>
                    </div>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => {
                        setCustomPrompt(e.target.value)
                        setPromptModified(true)
                      }}
                      placeholder={basePrompt.slice(0, 500) + '...'}
                      className="w-full h-48 px-3 py-2 text-sm bg-background border border-border rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      {customPrompt ? `${customPrompt.length} characters` : 'Using default prompt'}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={saveCustomPrompt}
                      disabled={!promptModified || savingPrompt}
                    >
                      {savingPrompt ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        'Save Prompt'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <Separator />

              {/* Learned Insights Section */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-4 text-accent" />
                  <div className="text-section-header">LEARNED INSIGHTS</div>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Add custom instructions that the assistant will remember. These are appended to the system prompt.
                  The agent can also learn and add insights based on your feedback.
                </p>
              </div>

              {/* Add new insight */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={newInsight}
                    onChange={(e) => setNewInsight(e.target.value)}
                    placeholder="e.g., Always use TypeScript strict mode, Prefer functional components..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newInsight.trim()) {
                        addInsight()
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={addInsight}
                    disabled={!newInsight.trim()}
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
              </div>

              {/* Insights list */}
              <div className="space-y-2">
                {insights.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    <Sparkles className="size-8 mx-auto mb-2 opacity-50" />
                    <p>No learned insights yet</p>
                    <p className="text-xs mt-1">Add instructions above or let the agent learn from your feedback</p>
                  </div>
                ) : (
                  insights.map((insight) => (
                    <div
                      key={insight.id}
                      className={`p-3 border rounded-sm transition-colors ${
                        insight.enabled
                          ? 'border-border bg-background-elevated'
                          : 'border-border/50 bg-background opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{insight.content}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              insight.source === 'user_feedback' ? 'bg-primary/20 text-primary' :
                              insight.source === 'tool_feedback' ? 'bg-accent/20 text-accent' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {insight.source === 'user_feedback' ? 'User' :
                               insight.source === 'tool_feedback' ? 'Tool' : 'Auto'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(insight.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={insight.enabled}
                            onCheckedChange={() => toggleInsight(insight.id)}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeInsight(insight.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
