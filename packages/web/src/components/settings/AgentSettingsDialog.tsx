import { useState, useEffect } from 'react'
import { AlertCircle, Loader2, Plus, Trash2, Wrench, Plug, ShieldCheck, ShieldOff, FileText, Sparkles, RotateCcw, Bot, AppWindow, Package, ChevronDown, ChevronRight } from 'lucide-react'
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
import type { AgentIcon } from '@/types'

interface AgentSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
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
  source: string
  createdAt: string
  enabled: boolean
}

interface Skill {
  skill_id: string
  name: string
  description: string | null
  source_url: string
  folder_path: string
  file_count: number
  user_id: string
  created_at: number
  updated_at: number
}

interface AgentConfig {
  enabled_skills?: string[]
  tool_configs?: string | null
  custom_prompt?: string | null
  learned_insights?: string | null
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

export function AgentSettingsDialog({ open, onOpenChange, agentId }: AgentSettingsDialogProps) {
  const agents = useAppStore((s) => s.agents)
  const updateAgent = useAppStore((s) => s.updateAgent)
  const models = useAppStore((s) => s.models)
  const userTier = useAppStore((s) => s.userTier)

  const existingAgent = agents.find((a) => a.agent_id === agentId)

  const [activeTab, setActiveTab] = useState<'agent' | 'prompt' | 'insights' | 'tools' | 'skills'>('agent')
  const [loading, setLoading] = useState(true)

  // Agent properties state
  const [agentName, setAgentName] = useState('')
  const [agentColor, setAgentColor] = useState(AGENT_COLORS[0])
  const [agentIcon, setAgentIcon] = useState<AgentIcon>('bot')
  const [agentModel, setAgentModel] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)

  // Tools state
  const [tools, setTools] = useState<ToolConfig[]>(DEFAULT_TOOLS)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // System prompt state
  const [basePrompt, setBasePrompt] = useState<string>('')
  const [customPrompt, setCustomPrompt] = useState<string>('')
  const [promptModified, setPromptModified] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)

  // Insights state
  const [insights, setInsights] = useState<LearnedInsight[]>([])
  const [newInsight, setNewInsight] = useState('')

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([])
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [loadingAgentConfig, setLoadingAgentConfig] = useState(false)
  const [savingSkillToggle, setSavingSkillToggle] = useState<string | null>(null)

  // Load settings when dialog opens
  useEffect(() => {
    if (open && agentId) {
      loadAllSettings()
    }
  }, [open, agentId])

  async function loadAllSettings() {
    setLoading(true)

    // Load agent properties
    if (existingAgent) {
      setAgentName(existingAgent.name)
      setAgentColor(existingAgent.color)
      setAgentIcon(existingAgent.icon)
      setAgentModel(existingAgent.model_default)
    }

    // Load per-agent tool configs
    let savedConfigs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }> = []
    try {
      savedConfigs = await window.api.agents.getToolConfigs(agentId)
    } catch (e) {
      console.error('Failed to load agent tool configs:', e)
    }

    // Apply saved configs to built-in tools
    let mergedTools: ToolConfig[] = DEFAULT_TOOLS.map((t) => {
      const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
      return savedConfig ? { ...t, enabled: savedConfig.enabled, requireApproval: savedConfig.requireApproval ?? t.requireApproval } : t
    })

    // Load WhatsApp tools if connected
    try {
      const whatsappStatus = await window.api.whatsapp.getStatus()
      if (whatsappStatus.connected) {
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
        mergedTools = [...mergedTools, ...whatsappToolConfigs]
      }
    } catch (e) {
      console.error('Failed to load WhatsApp tools:', e)
    }

    // Load Google Workspace tools if connected
    try {
      const googleStatus = await window.api.googleWorkspace.getStatus()
      if (googleStatus.connected) {
        const googleTools = await window.api.googleWorkspace.getTools()
        const googleToolConfigs: ToolConfig[] = googleTools.map(t => {
          const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            enabled: savedConfig?.enabled ?? true,
            requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
            source: 'app' as const,
            appName: 'Google Workspace'
          }
        })
        mergedTools = [...mergedTools, ...googleToolConfigs]
      }
    } catch (e) {
      console.error('Failed to load Google Workspace tools:', e)
    }

    // Load Exa tools if connected
    try {
      const exaStatus = await window.api.exa.getStatus()
      if (exaStatus.connected) {
        const exaTools = await window.api.exa.getTools()
        const exaToolConfigs: ToolConfig[] = exaTools.map(t => {
          const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            enabled: savedConfig?.enabled ?? true,
            requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
            source: 'app' as const,
            appName: 'Search and Datasets'
          }
        })
        mergedTools = [...mergedTools, ...exaToolConfigs]
      }
    } catch (e) {
      console.error('Failed to load Exa tools:', e)
    }

    // Load Slack tools if connected
    try {
      const slackStatus = await window.api.slack.getStatus()
      if (slackStatus.connected) {
        const slackTools = await window.api.slack.getTools()
        const slackToolConfigs: ToolConfig[] = slackTools.map(t => {
          const savedConfig = savedConfigs.find((c: { id: string }) => c.id === t.id)
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            enabled: savedConfig?.enabled ?? true,
            requireApproval: savedConfig?.requireApproval ?? t.requireApproval,
            source: 'app' as const,
            appName: 'Slack'
          }
        })
        mergedTools = [...mergedTools, ...slackToolConfigs]
      }
    } catch (e) {
      console.error('Failed to load Slack tools:', e)
    }

    // Load MCP tools
    try {
      const mcpServers = await window.api.mcp.list() as Array<Record<string, unknown>>
      for (const server of mcpServers.filter((s: any) => s.enabled)) {
        const result = await window.api.mcp.testConnection(server)
        if (result.success) {
          const mcpTools: ToolConfig[] = result.tools.map(t => {
            const toolId = `mcp:${(server as any).name}:${t.name}`
            const savedConfig = savedConfigs.find((c: { id: string }) => c.id === toolId)
            return {
              id: toolId,
              name: t.name,
              description: t.description || `Tool from ${(server as any).name}`,
              enabled: savedConfig?.enabled ?? true,
              requireApproval: savedConfig?.requireApproval ?? false,
              source: 'mcp' as const,
              mcpServerName: (server as any).name as string
            }
          })
          mergedTools = [...mergedTools, ...mcpTools]
        }
      }
    } catch (e) {
      console.error('Failed to load MCP tools:', e)
    }

    setTools(mergedTools)

    // Load base prompt (custom prompt will be loaded from agent config below)
    try {
      const base = await window.api.prompt.getBase()
      setBasePrompt(base)
      setPromptModified(false)
    } catch (e) {
      console.error('Failed to load base prompt:', e)
    }

    // Load skills
    try {
      const loadedSkills = await window.api.skills.list()
      setSkills(loadedSkills)
    } catch (error) {
      console.error('[AgentSettings] Failed to load skills:', error)
    }

    // Load agent config for skills and insights
    setLoadingAgentConfig(true)
    try {
      const config = await window.api.agents.getConfig(agentId) as Record<string, unknown> | null
      if (config) {
        let enabledSkills: string[] = []
        if (typeof config.enabled_skills === 'string') {
          try {
            enabledSkills = JSON.parse(config.enabled_skills)
          } catch {
            enabledSkills = []
          }
        } else if (Array.isArray(config.enabled_skills)) {
          enabledSkills = config.enabled_skills
        }
        setAgentConfig({ ...config, enabled_skills: enabledSkills })

        // Load custom prompt from agent config
        if (config.custom_prompt) {
          setCustomPrompt(config.custom_prompt as string)
        } else {
          setCustomPrompt('')
        }

        // Load insights from agent config
        let loadedInsights: LearnedInsight[] = []
        if (config.learned_insights) {
          if (typeof config.learned_insights === 'string') {
            try {
              loadedInsights = JSON.parse(config.learned_insights)
            } catch {
              loadedInsights = []
            }
          } else if (Array.isArray(config.learned_insights)) {
            loadedInsights = config.learned_insights as LearnedInsight[]
          }
        }
        setInsights(loadedInsights)
      } else {
        setAgentConfig(null)
        setInsights([])
      }
    } catch (error) {
      console.error('[AgentSettings] Failed to load agent config:', error)
      setAgentConfig(null)
      setInsights([])
    } finally {
      setLoadingAgentConfig(false)
    }

    setLoading(false)
  }

  // Agent save handler
  async function handleSaveAgent() {
    if (!agentName.trim()) return

    setSavingAgent(true)
    try {
      await updateAgent(agentId, {
        name: agentName.trim(),
        color: agentColor,
        icon: agentIcon,
        model_default: agentModel,
      })
    } catch (error) {
      console.error('Failed to save agent:', error)
    } finally {
      setSavingAgent(false)
    }
  }

  // Tool handlers - save per-agent
  async function toggleTool(id: string) {
    const updated = tools.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t
    )
    setTools(updated)

    try {
      await window.api.agents.saveToolConfigs(agentId, updated.map((t) => ({
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
      await window.api.agents.saveToolConfigs(agentId, updated.map((t) => ({
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

  // Build tool groups for the collapsible UI
  interface ToolGroup {
    key: string
    label: string
    icon: 'builtin' | 'mcp' | 'app'
    tools: ToolConfig[]
    subtitle?: string
  }

  const toolGroups: ToolGroup[] = []

  // Built-in tools group
  if (builtinTools.length > 0) {
    toolGroups.push({ key: 'builtin', label: 'Built-in Tools', icon: 'builtin', tools: builtinTools })
  }

  // MCP tools grouped by server name
  const mcpServerNames = [...new Set(mcpTools.map(t => t.mcpServerName).filter(Boolean))]
  for (const serverName of mcpServerNames) {
    const serverTools = mcpTools.filter(t => t.mcpServerName === serverName)
    toolGroups.push({ key: `mcp:${serverName}`, label: serverName!, icon: 'mcp', tools: serverTools, subtitle: 'MCP Server' })
  }

  // App tools grouped by app name
  const appNames = [...new Set(appTools.map(t => t.appName).filter(Boolean))]
  for (const appName of appNames) {
    const appGroupTools = appTools.filter(t => t.appName === appName)
    toolGroups.push({ key: `app:${appName}`, label: appName!, icon: 'app', tools: appGroupTools, subtitle: 'App' })
  }

  function toggleGroupExpanded(groupKey: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  async function toggleGroupEnabled(group: ToolGroup) {
    const allEnabled = group.tools.every(t => t.enabled)
    const newEnabled = !allEnabled
    const groupToolIds = new Set(group.tools.map(t => t.id))

    const updated = tools.map(t =>
      groupToolIds.has(t.id) ? { ...t, enabled: newEnabled } : t
    )
    setTools(updated)

    try {
      await window.api.agents.saveToolConfigs(agentId, updated.map(t => ({
        id: t.id,
        enabled: t.enabled,
        requireApproval: t.requireApproval
      })))
    } catch (e) {
      console.error('Failed to save tool config:', e)
    }
  }

  function getGroupIcon(type: 'builtin' | 'mcp' | 'app', enabled: boolean) {
    const colorClass = enabled ? {
      builtin: 'bg-primary/20 text-primary',
      mcp: 'bg-accent/20 text-accent',
      app: 'bg-status-nominal/20 text-status-nominal',
    }[type] : 'bg-muted text-muted-foreground'

    const Icon = { builtin: Wrench, mcp: Plug, app: AppWindow }[type]

    return (
      <div className={`p-1.5 rounded ${colorClass}`}>
        <Icon className="size-4" />
      </div>
    )
  }

  // Prompt handlers
  async function saveCustomPrompt() {
    setSavingPrompt(true)
    try {
      const promptToSave = customPrompt.trim() || null
      await window.api.agents.updateConfig(agentId, { custom_prompt: promptToSave })
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
      const newInsightObj: LearnedInsight = {
        id: `insight_${Date.now()}`,
        content: newInsight.trim(),
        source: 'user_feedback',
        createdAt: new Date().toISOString(),
        enabled: true
      }
      const updatedInsights = [...insights, newInsightObj]
      await window.api.agents.updateConfig(agentId, { learned_insights: updatedInsights })
      setInsights(updatedInsights)
      setNewInsight('')
    } catch (e) {
      console.error('Failed to add insight:', e)
    }
  }

  async function removeInsight(id: string) {
    try {
      const updatedInsights = insights.filter(i => i.id !== id)
      await window.api.agents.updateConfig(agentId, { learned_insights: updatedInsights })
      setInsights(updatedInsights)
    } catch (e) {
      console.error('Failed to remove insight:', e)
    }
  }

  async function toggleInsight(id: string) {
    try {
      const updatedInsights = insights.map(i =>
        i.id === id ? { ...i, enabled: !i.enabled } : i
      )
      await window.api.agents.updateConfig(agentId, { learned_insights: updatedInsights })
      setInsights(updatedInsights)
    } catch (e) {
      console.error('Failed to toggle insight:', e)
    }
  }

  // Skills handlers
  async function handleToggleSkill(skillId: string) {
    setSavingSkillToggle(skillId)
    try {
      const currentEnabled = agentConfig?.enabled_skills || []
      const isEnabled = currentEnabled.includes(skillId)
      const newEnabled = isEnabled
        ? currentEnabled.filter(id => id !== skillId)
        : [...currentEnabled, skillId]

      await window.api.agents.updateConfig(agentId, {
        enabled_skills: newEnabled
      })

      setAgentConfig(prev => ({
        ...prev,
        enabled_skills: newEnabled
      }))
    } catch (error) {
      console.error('[AgentSettings] Toggle skill error:', error)
    } finally {
      setSavingSkillToggle(null)
    }
  }

  function isSkillEnabled(skillId: string): boolean {
    return agentConfig?.enabled_skills?.includes(skillId) || false
  }

  const enabledInsightsCount = insights.filter(i => i.enabled).length

  if (!existingAgent) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[950px] h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Agent Settings: {existingAgent.name}</DialogTitle>
          <DialogDescription>
            Configure this agent's properties, tools, and behavior.
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
            onClick={() => setActiveTab('prompt')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'prompt'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="size-4" />
            Prompt
            {activeTab === 'prompt' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'insights'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="size-4" />
            Insights
            {enabledInsightsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-accent/20 text-accent rounded">
                {enabledInsightsCount}
              </span>
            )}
            {activeTab === 'insights' && (
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
            {activeTab === 'tools' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'skills'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Package className="size-4" />
            Skills
            {activeTab === 'skills' && (
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
                  {userTier?.features.model_selection && (
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
                  )}

                  {/* Save Agent Button */}
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleSaveAgent}
                      disabled={!agentName.trim() || savingAgent}
                    >
                      {savingAgent ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : null}
                      Save Changes
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prompt Tab */}
          {activeTab === 'prompt' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">SYSTEM PROMPT</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Customize the base instructions for this agent. Leave empty to use the default prompt.
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
            </div>
          )}

          {/* Insights Tab */}
          {activeTab === 'insights' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-4 text-accent" />
                  <div className="text-section-header">LEARNED INSIGHTS</div>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Add custom instructions that this agent will remember. These are appended to the system prompt.
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

          {/* Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-3 py-4">
              <div>
                <div className="text-section-header mb-2">AGENT TOOLS</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Manage which tools this agent can use. Toggle groups or individual tools, and set approval requirements.
                </p>
              </div>

              {toolGroups.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Wrench className="size-8 mx-auto mb-2 opacity-50" />
                  <p>No tools available</p>
                  <p className="text-xs mt-1">Connect apps or MCP servers in Global Settings to add tools</p>
                </div>
              )}

              {toolGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.key)
                const allEnabled = group.tools.every(t => t.enabled)
                const someEnabled = group.tools.some(t => t.enabled)
                const enabledCount = group.tools.filter(t => t.enabled).length
                const approvalCount = group.tools.filter(t => t.enabled && t.requireApproval).length

                return (
                  <div key={group.key} className="border border-border rounded-sm overflow-hidden">
                    {/* Group header */}
                    <div
                      className={`flex items-center justify-between px-3 py-2.5 transition-colors ${
                        someEnabled ? 'bg-background-elevated' : 'bg-background opacity-75'
                      }`}
                    >
                      <button
                        onClick={() => toggleGroupExpanded(group.key)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                        )}
                        {getGroupIcon(group.icon, someEnabled)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{group.label}</span>
                            {group.subtitle && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                group.icon === 'mcp' ? 'bg-accent/10 text-accent' :
                                group.icon === 'app' ? 'bg-status-nominal/10 text-status-nominal' :
                                'bg-muted text-muted-foreground'
                              }`}>
                                {group.subtitle}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {enabledCount}/{group.tools.length} tool{group.tools.length !== 1 ? 's' : ''} enabled
                            {approvalCount > 0 && ` \u00B7 ${approvalCount} require approval`}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={allEnabled}
                          onCheckedChange={() => toggleGroupEnabled(group)}
                        />
                      </div>
                    </div>

                    {/* Expanded tools list */}
                    {isExpanded && (
                      <div className="border-t border-border/50">
                        {group.tools.map((tool) => (
                          <div
                            key={tool.id}
                            className={`flex items-center justify-between px-3 py-2 border-b last:border-b-0 border-border/30 transition-colors ${
                              tool.enabled ? '' : 'opacity-50'
                            }`}
                          >
                            <div className="flex-1 min-w-0 pl-7">
                              <div className="font-medium text-sm">{tool.name}</div>
                              <div className="text-xs text-muted-foreground">{tool.description}</div>
                            </div>
                            <div className="flex items-center gap-3 ml-2">
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
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Skills Tab */}
          {activeTab === 'skills' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">AGENT SKILLS</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Enable skills for this agent. Download new skills in Global Settings.
                </p>
              </div>

              {/* Skills for this agent */}
              <div className="space-y-2">
                {loadingAgentConfig ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : skills.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    <Package className="size-8 mx-auto mb-2 opacity-50" />
                    <p>No skills available</p>
                    <p className="text-xs mt-1">Download skills in Global Settings to enable them for this agent</p>
                  </div>
                ) : (
                  skills.map((skill) => (
                    <div
                      key={skill.skill_id}
                      className={`flex items-center justify-between p-3 border rounded-sm transition-colors ${
                        isSkillEnabled(skill.skill_id)
                          ? 'border-border bg-background-elevated'
                          : 'border-border/50 bg-background opacity-60'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{skill.name}</div>
                        {skill.description && (
                          <div className="text-xs text-muted-foreground">
                            {skill.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {savingSkillToggle === skill.skill_id && (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        )}
                        <Switch
                          checked={isSkillEnabled(skill.skill_id)}
                          onCheckedChange={() => handleToggleSkill(skill.skill_id)}
                          disabled={savingSkillToggle === skill.skill_id}
                        />
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
