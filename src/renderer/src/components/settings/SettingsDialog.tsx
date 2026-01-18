import { useState, useEffect } from 'react'
import { Eye, EyeOff, Check, AlertCircle, Loader2, Plus, Trash2, Power, PowerOff, Wrench, Plug, RefreshCw, ShieldCheck, ShieldOff, XCircle, FileText, Sparkles, RotateCcw, Bot, Pencil } from 'lucide-react'
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
import { AgentIconComponent } from '@/lib/agent-icons'
import type { Agent } from '@/types'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  requireApproval: boolean
  source: 'builtin' | 'mcp'
  mcpServerName?: string
}

interface LearnedInsight {
  id: string
  content: string
  source: 'tool_feedback' | 'user_feedback' | 'auto_learned'
  createdAt: string
  enabled: boolean
}

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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'api-keys' | 'mcp' | 'tools' | 'prompt'>('api-keys')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

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

  // Load existing settings on mount
  useEffect(() => {
    if (open) {
      loadAllSettings()
    }
  }, [open])

  async function loadAllSettings() {
    setLoading(true)

    // Load API keys
    const keys: Record<string, string> = {}
    const saved: Record<string, boolean> = {}

    for (const provider of PROVIDERS) {
      try {
        const key = await window.api.models.getApiKey(provider.id)
        if (key) {
          // Show masked version
          keys[provider.id] = '••••••••••••••••'
          saved[provider.id] = true
        } else {
          keys[provider.id] = ''
          saved[provider.id] = false
        }
      } catch (e) {
        keys[provider.id] = ''
        saved[provider.id] = false
      }
    }

    setApiKeys(keys)
    setSavedKeys(saved)

    // Load tool configs first, then MCP servers (to avoid race condition)
    let mergedTools = [...DEFAULT_TOOLS]
    try {
      const configs = await window.api.tools.getConfigs()
      if (configs.length > 0) {
        // Merge saved configs with defaults
        mergedTools = DEFAULT_TOOLS.map((t) => {
          const saved = configs.find((c: { id: string }) => c.id === t.id)
          return saved ? { ...t, enabled: saved.enabled, requireApproval: saved.requireApproval ?? t.requireApproval } : t
        })
      }
    } catch (e) {
      console.error('Failed to load tool configs:', e)
    }
    setTools(mergedTools)

    // Load MCP servers and test connections
    try {
      const servers = await window.api.mcp.list()
      setMcpServers(servers)

      // Test connections for enabled servers (run in parallel)
      const enabledServers = servers.filter(s => s.enabled)
      if (enabledServers.length > 0) {
        // Test connections - this will add MCP tools to state
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

        // Add MCP tools to tools list
        const mcpTools: ToolConfig[] = result.tools.map(t => ({
          id: `mcp:${server.name}:${t.name}`,
          name: t.name,
          description: t.description || `Tool from ${server.name}`,
          enabled: true,
          requireApproval: false,
          source: 'mcp' as const,
          mcpServerName: server.name
        }))

        setTools(prev => {
          // Remove old tools from this server and add new ones
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
    // If user starts typing on a masked field, clear it
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

    // Persist to backend
    try {
      await window.api.mcp.save(updated)
      // Test the new connection
      testMcpConnection(newServer)
    } catch (e) {
      console.error('Failed to save MCP server:', e)
    }
  }

  async function removeMcpServer(id: string) {
    const server = mcpServers.find(s => s.id === id)
    const updated = mcpServers.filter((s) => s.id !== id)
    setMcpServers(updated)

    // Remove tools from this server
    if (server) {
      setTools(prev => prev.filter(t => t.mcpServerName !== server.name))
    }

    // Remove status
    setMcpStatus(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })

    // Persist to backend
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

    // Persist to backend
    try {
      await window.api.mcp.save(updated)

      // If enabling, test connection
      if (server && !server.enabled) {
        testMcpConnection({ ...server, enabled: true })
      } else if (server) {
        // If disabling, remove tools and status
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

    // Persist to backend
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

    // Persist to backend
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your AI assistant's capabilities and connections.
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-border">
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
            onClick={() => setActiveTab('mcp')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'mcp'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Plug className="size-4" />
            MCP Servers
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
          {/* API Keys Tab */}
          {activeTab === 'api-keys' && (
            <div className="space-y-6 py-4">
              <div className="text-section-header">API KEYS</div>

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

                        {/* Status/Error display */}
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
  )
}
