import { useState, useEffect, useRef } from 'react'
import { Check, AlertCircle, Loader2, Plus, Trash2, Power, PowerOff, Wrench, Plug, RefreshCw, ShieldCheck, ShieldOff, XCircle, FileText, Sparkles, RotateCcw, Bot, AppWindow, Package, Clock, Container, Shield, ChevronDown, ChevronRight, Globe, Terminal, Key, LogOut } from 'lucide-react'
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
import { SkillsTab } from './SkillsTab'
import { CronjobsTab } from './CronjobsTab'
import { SandboxSettings, type SandboxConfig } from './SandboxSettings'
import { AdminTab } from './admin/AdminTab'
import { useIsAdmin } from '@/lib/auth-store'
import type { AgentIcon } from '@/types'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** If provided, edit this agent. If null, create new agent. If undefined, edit active agent. */
  agentId?: string | null
}

interface MCPServer {
  id: string
  name: string
  enabled: boolean
  transport?: 'stdio' | 'http'
  // stdio fields
  command?: string
  args?: string[]
  env?: Record<string, string>
  // http fields
  url?: string
  headers?: Record<string, string>
  auth?: {
    type: 'oauth' | 'bearer' | 'none'
    bearerToken?: string
    oauthServerId?: string
  }
}

interface MCPServerStatus {
  status: 'unknown' | 'testing' | 'connected' | 'error'
  error?: string
  tools: Array<{ name: string; description: string }>
  oauthAuthorized?: boolean
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
  const userTier = useAppStore((s) => s.userTier)

  // null = creating new agent, string = editing existing agent
  const isCreatingNew = propAgentId === null

  // Capture the agent ID when dialog opens - don't track activeAgentId changes while open
  const [capturedAgentId, setCapturedAgentId] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (open) {
      // Only capture when dialog opens, not when activeAgentId changes
      setCapturedAgentId(propAgentId === undefined ? activeAgentId : propAgentId)
    }
  }, [open, propAgentId]) // Intentionally exclude activeAgentId

  const targetAgentId = open ? capturedAgentId : (propAgentId === undefined ? activeAgentId : propAgentId)
  const existingAgent = targetAgentId ? agents.find((a) => a.agent_id === targetAgentId) : null

  const isAdmin = useIsAdmin()
  const [activeTab, setActiveTab] = useState<'agent' | 'apps' | 'mcp' | 'tools' | 'prompt' | 'skills' | 'cronjobs' | 'sandbox' | 'admin'>('agent')
  const [loading, setLoading] = useState(true)
  const loadIdRef = useRef(0)

  // Agent properties state
  const [agentName, setAgentName] = useState('')
  const [agentColor, setAgentColor] = useState(AGENT_COLORS[0])
  const [agentIcon, setAgentIcon] = useState<AgentIcon>('bot')
  const [agentModel, setAgentModel] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpStatus, setMcpStatus] = useState<Record<string, MCPServerStatus>>({})
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')
  const [newMcpArgs, setNewMcpArgs] = useState('')
  const [newMcpTransport, setNewMcpTransport] = useState<'stdio' | 'http'>('stdio')
  const [newMcpUrl, setNewMcpUrl] = useState('')
  const [newMcpAuthType, setNewMcpAuthType] = useState<'none' | 'bearer' | 'oauth'>('none')
  const [newMcpBearerToken, setNewMcpBearerToken] = useState('')
  const [oauthPollingRef] = useState<Record<string, ReturnType<typeof setInterval>>>({})
  const [authorizingServerId, setAuthorizingServerId] = useState<string | null>(null)

  // Tools state - includes both builtin and MCP tools
  const [tools, setTools] = useState<ToolConfig[]>(DEFAULT_TOOLS)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // System prompt state
  const [basePrompt, setBasePrompt] = useState<string>('')
  const [customPrompt, setCustomPrompt] = useState<string>('')
  const [promptModified, setPromptModified] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [insights, setInsights] = useState<LearnedInsight[]>([])
  const [newInsight, setNewInsight] = useState('')

  // Sandbox settings state
  const [sandboxConfig, setSandboxConfig] = useState<SandboxConfig>({
    type: 'buddy',
    localHost: 'localhost',
    localPort: 8080
  })

  // Load settings when dialog opens
  useEffect(() => {
    if (open && capturedAgentId !== undefined) {
      loadAllSettings()
    }
  }, [open, capturedAgentId, isCreatingNew])

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

  // Listen for Google Workspace connection changes to reload tools
  useEffect(() => {
    if (!open) return

    const cleanup = window.api.googleWorkspace.onConnectionChange(async (data) => {
      console.log('[Settings] Google Workspace connection changed:', data)

      // Filter out existing Google Workspace tools first
      setTools(prevTools => {
        const nonGoogleTools = prevTools.filter(t => !(t.source === 'app' && t.appName === 'Google Workspace'))

        if (data.connected) {
          // Load saved configs and Google Workspace tools asynchronously
          Promise.all([
            window.api.tools.getConfigs(),
            window.api.googleWorkspace.getTools()
          ]).then(([savedConfigs, googleTools]) => {
            console.log('[Settings] Connection change - loading Google Workspace tools:', googleTools)
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
            setTools(current => {
              const filtered = current.filter(tool => !(tool.source === 'app' && tool.appName === 'Google Workspace'))
              return [...filtered, ...googleToolConfigs]
            })
          }).catch(e => console.error('Failed to load Google Workspace tools on connection change:', e))
        }

        return nonGoogleTools  // Immediately remove Google Workspace tools if disconnected
      })
    })

    // Subscribe to connection events
    window.api.googleWorkspace.subscribeConnection()

    return () => {
      cleanup()
      window.api.googleWorkspace.unsubscribeConnection()
    }
  }, [open])

  // Listen for Exa (Search and Datasets) connection changes to reload tools
  useEffect(() => {
    if (!open) return

    const cleanup = window.api.exa.onConnectionChange(async (data) => {
      console.log('[Settings] Exa connection changed:', data)

      // Filter out existing Exa tools first
      setTools(prevTools => {
        const nonExaTools = prevTools.filter(t => !(t.source === 'app' && t.appName === 'Search and Datasets'))

        if (data.connected) {
          // Load saved configs and Exa tools asynchronously
          Promise.all([
            window.api.tools.getConfigs(),
            window.api.exa.getTools()
          ]).then(([savedConfigs, exaTools]) => {
            console.log('[Settings] Connection change - loading Exa tools:', exaTools)
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
            setTools(current => {
              const filtered = current.filter(tool => !(tool.source === 'app' && tool.appName === 'Search and Datasets'))
              return [...filtered, ...exaToolConfigs]
            })
          }).catch(e => console.error('Failed to load Exa tools on connection change:', e))
        }

        return nonExaTools  // Immediately remove Exa tools if disconnected
      })
    })

    // Subscribe to connection events
    window.api.exa.subscribeConnection()

    return () => {
      cleanup()
      window.api.exa.unsubscribeConnection()
    }
  }, [open])

  // Listen for Slack connection changes to reload tools
  useEffect(() => {
    if (!open) return

    const cleanup = window.api.slack.onConnectionChange(async (data) => {
      console.log('[Settings] Slack connection changed:', data)

      // Filter out existing Slack tools first
      setTools(prevTools => {
        const nonSlackTools = prevTools.filter(t => !(t.source === 'app' && t.appName === 'Slack'))

        if (data.connected) {
          // Load saved configs and Slack tools asynchronously
          Promise.all([
            window.api.tools.getConfigs(),
            window.api.slack.getTools()
          ]).then(([savedConfigs, slackTools]) => {
            console.log('[Settings] Connection change - loading Slack tools:', slackTools)
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
            setTools(current => {
              const filtered = current.filter(tool => !(tool.source === 'app' && tool.appName === 'Slack'))
              return [...filtered, ...slackToolConfigs]
            })
          }).catch(e => console.error('Failed to load Slack tools on connection change:', e))
        }

        return nonSlackTools  // Immediately remove Slack tools if disconnected
      })
    })

    // Subscribe to connection events
    window.api.slack.subscribeConnection()

    return () => {
      cleanup()
      window.api.slack.unsubscribeConnection()
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

  // Reload Google Workspace tools when switching to Tools tab (ensures tools appear if loaded late)
  useEffect(() => {
    if (activeTab !== 'tools' || loading) return

    // Check if Google Workspace is connected but tools aren't loaded yet
    const checkAndLoadGoogleTools = async () => {
      try {
        const status = await window.api.googleWorkspace.getStatus()
        if (status.connected) {
          const hasGoogleTools = tools.some(t => t.source === 'app' && t.appName === 'Google Workspace')
          if (!hasGoogleTools) {
            console.log('[Settings] Tools tab: Google Workspace connected but no tools found, reloading...')
            // Load saved configs to restore user preferences
            const savedConfigs = await window.api.tools.getConfigs()
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
            setTools(prev => [...prev.filter(t => !(t.source === 'app' && t.appName === 'Google Workspace')), ...googleToolConfigs])
          }
        }
      } catch (e) {
        console.error('Failed to check/load Google Workspace tools on tab switch:', e)
      }
    }

    checkAndLoadGoogleTools()
  }, [activeTab, loading, tools])

  // Reload Exa (Search and Datasets) tools when switching to Tools tab (ensures tools appear if loaded late)
  useEffect(() => {
    if (activeTab !== 'tools' || loading) return

    // Check if Exa is connected but tools aren't loaded yet
    const checkAndLoadExaTools = async () => {
      try {
        const status = await window.api.exa.getStatus()
        if (status.connected) {
          const hasExaTools = tools.some(t => t.source === 'app' && t.appName === 'Search and Datasets')
          if (!hasExaTools) {
            console.log('[Settings] Tools tab: Exa connected but no tools found, reloading...')
            // Load saved configs to restore user preferences
            const savedConfigs = await window.api.tools.getConfigs()
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
            setTools(prev => [...prev.filter(t => !(t.source === 'app' && t.appName === 'Search and Datasets')), ...exaToolConfigs])
          }
        }
      } catch (e) {
        console.error('Failed to check/load Exa tools on tab switch:', e)
      }
    }

    checkAndLoadExaTools()
  }, [activeTab, loading, tools])

  // Reload Slack tools when switching to Tools tab (ensures tools appear if loaded late)
  useEffect(() => {
    if (activeTab !== 'tools' || loading) return

    const checkAndLoadSlackTools = async () => {
      try {
        const status = await window.api.slack.getStatus()
        if (status.connected) {
          const hasSlackTools = tools.some(t => t.source === 'app' && t.appName === 'Slack')
          if (!hasSlackTools) {
            console.log('[Settings] Tools tab: Slack connected but no tools found, reloading...')
            const savedConfigs = await window.api.tools.getConfigs()
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
            setTools(prev => [...prev.filter(t => !(t.source === 'app' && t.appName === 'Slack')), ...slackToolConfigs])
          }
        }
      } catch (e) {
        console.error('Failed to check/load Slack tools on tab switch:', e)
      }
    }

    checkAndLoadSlackTools()
  }, [activeTab, loading, tools])

  async function loadAllSettings() {
    // Guard against concurrent calls (React StrictMode double-mounting)
    const loadId = ++loadIdRef.current
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

    // Load tool configs (needed for both built-in and app tools)
    let savedConfigs: Array<{ id: string; enabled: boolean; requireApproval?: boolean }> = []
    try {
      savedConfigs = await window.api.tools.getConfigs()
    } catch (e) {
      console.error('Failed to load tool configs:', e)
    }

    // Abort if a newer loadAllSettings() call has started
    if (loadId !== loadIdRef.current) {
      return
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

    // Load Google Workspace tools if connected (with saved config applied)
    try {
      const googleStatus = await window.api.googleWorkspace.getStatus()
      console.log('[Settings] Google Workspace status:', googleStatus)
      if (googleStatus.connected) {
        const googleTools = await window.api.googleWorkspace.getTools()
        console.log('[Settings] Google Workspace tools loaded:', googleTools)
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
        console.log('[Settings] Merged tools with Google Workspace:', mergedTools.length)
      }
    } catch (e) {
      console.error('Failed to load Google Workspace tools:', e)
    }

    // Load Exa (Search and Datasets) tools if connected (with saved config applied)
    try {
      const exaStatus = await window.api.exa.getStatus()
      console.log('[Settings] Exa status:', exaStatus)
      if (exaStatus.connected) {
        const exaTools = await window.api.exa.getTools()
        console.log('[Settings] Exa tools loaded:', exaTools)
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
        console.log('[Settings] Merged tools with Exa:', mergedTools.length)
      }
    } catch (e) {
      console.error('Failed to load Exa tools:', e)
    }

    // Load Slack tools if connected (with saved config applied)
    try {
      const slackStatus = await window.api.slack.getStatus()
      console.log('[Settings] Slack status:', slackStatus)
      if (slackStatus.connected) {
        const slackTools = await window.api.slack.getTools()
        console.log('[Settings] Slack tools loaded:', slackTools)
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
        console.log('[Settings] Merged tools with Slack:', mergedTools.length)
      }
    } catch (e) {
      console.error('Failed to load Slack tools:', e)
    }

    // Abort if a newer loadAllSettings() call has started
    if (loadId !== loadIdRef.current) {
      return
    }
    setTools(mergedTools)

    // Load MCP servers and test connections
    try {
      const servers = await window.api.mcp.list() as MCPServer[]
      if (loadId !== loadIdRef.current) {
        return
      }
      setMcpServers(servers)

      const enabledServers = servers.filter(s => s.enabled)
      if (enabledServers.length > 0) {
        await Promise.all(enabledServers.map(server => testMcpConnection(server)))
      }
    } catch (e) {
      console.error('[SettingsDialog] Failed to load MCP servers:', e)
    }

    // Abort if a newer loadAllSettings() call has started
    if (loadId !== loadIdRef.current) return

    // Load system prompt data
    try {
      const [base, custom, loadedInsights] = await Promise.all([
        window.api.prompt.getBase(),
        window.api.prompt.getCustom(),
        window.api.insights.list()
      ])
      if (loadId !== loadIdRef.current) return
      setBasePrompt(base)
      setCustomPrompt(custom || '')
      setPromptModified(false)
      setInsights(loadedInsights)
    } catch (e) {
      console.error('Failed to load prompt data:', e)
    }

    // Load sandbox config
    try {
      const config = await window.api.sandbox.getConfig()
      if (loadId !== loadIdRef.current) return
      if (config) {
        setSandboxConfig(config)
      }
    } catch (e) {
      console.error('Failed to load sandbox config:', e)
    }

    setLoading(false)
  }

  async function testMcpConnection(server: MCPServer) {
    setMcpStatus(prev => ({
      ...prev,
      [server.id]: { status: 'testing', tools: [] }
    }))

    try {
      const result = await window.api.mcp.testConnection(server)

      if (result.success) {
        // Also check OAuth status for OAuth servers
        let oauthAuthorized: boolean | undefined
        if (server.transport === 'http' && server.auth?.type === 'oauth') {
          try {
            const oauthStatus = await window.api.mcp.getOAuthStatus(server.id)
            oauthAuthorized = oauthStatus.authorized
          } catch { /* ignore */ }
        }

        setMcpStatus(prev => ({
          ...prev,
          [server.id]: { status: 'connected', tools: result.tools, oauthAuthorized }
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
      console.error(`[SettingsDialog] MCP connection failed: ${server.name}`, e)
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

  async function initiateOAuth(serverId: string) {
    setAuthorizingServerId(serverId)
    try {
      const result = await window.api.mcp.initiateOAuth(serverId)

      if (result.authorized) {
        setMcpStatus(prev => ({
          ...prev,
          [serverId]: { ...prev[serverId], oauthAuthorized: true }
        }))
        setAuthorizingServerId(null)
        return
      }

      if (result.authUrl) {
        window.open(result.authUrl, '_blank', 'width=600,height=700')

        const pollInterval = setInterval(async () => {
          try {
            const status = await window.api.mcp.getOAuthStatus(serverId)
            if (status.authorized) {
              clearInterval(pollInterval)
              delete oauthPollingRef[serverId]
              setAuthorizingServerId(null)
              setMcpStatus(prev => ({
                ...prev,
                [serverId]: { ...prev[serverId], oauthAuthorized: true }
              }))
              const server = mcpServers.find(s => s.id === serverId)
              if (server) testMcpConnection(server)
            }
          } catch { /* ignore */ }
        }, 2000)

        oauthPollingRef[serverId] = pollInterval

        setTimeout(() => {
          if (oauthPollingRef[serverId]) {
            clearInterval(oauthPollingRef[serverId])
            delete oauthPollingRef[serverId]
            setAuthorizingServerId(null)
          }
        }, 5 * 60 * 1000)
      }
    } catch (e) {
      console.error('Failed to initiate OAuth:', e)
      setAuthorizingServerId(null)
    }
  }

  async function revokeOAuth(serverId: string) {
    try {
      await window.api.mcp.revokeOAuth(serverId)
      setMcpStatus(prev => ({
        ...prev,
        [serverId]: { ...prev[serverId], oauthAuthorized: false }
      }))
    } catch (e) {
      console.error('Failed to revoke OAuth:', e)
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

  // Sandbox config save handler
  async function handleSaveSandboxConfig() {
    try {
      await window.api.sandbox.setConfig(sandboxConfig)
    } catch (error) {
      console.error('Failed to save sandbox config:', error)
    }
  }

  // MCP handlers
  async function addMcpServer() {
    if (!newMcpName.trim()) return

    let newServer: MCPServer
    if (newMcpTransport === 'http') {
      if (!newMcpUrl.trim()) return
      newServer = {
        id: `mcp-${Date.now()}`,
        name: newMcpName.trim(),
        transport: 'http',
        url: newMcpUrl.trim(),
        enabled: true,
        auth: {
          type: newMcpAuthType,
          ...(newMcpAuthType === 'bearer' ? { bearerToken: newMcpBearerToken } : {})
        }
      }
    } else {
      if (!newMcpCommand.trim()) return
      newServer = {
        id: `mcp-${Date.now()}`,
        name: newMcpName.trim(),
        transport: 'stdio',
        command: newMcpCommand.trim(),
        args: newMcpArgs.split(' ').filter(Boolean),
        enabled: true
      }
    }

    const updated = [...mcpServers, newServer]
    setMcpServers(updated)
    setNewMcpName('')
    setNewMcpCommand('')
    setNewMcpArgs('')
    setNewMcpUrl('')
    setNewMcpAuthType('none')
    setNewMcpBearerToken('')

    try {
      await window.api.mcp.save(updated)
      if (newServer.transport !== 'http' || newServer.auth?.type !== 'oauth') {
        testMcpConnection(newServer)
      }
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

  // MCP servers that are enabled but failed to load or still loading
  const mcpServerNamesWithTools = new Set(mcpServerNames)
  const failedMcpServers = mcpServers.filter(s =>
    s.enabled && mcpStatus[s.id]?.status === 'error' && !mcpServerNamesWithTools.has(s.name)
  )
  const testingMcpServers = mcpServers.filter(s =>
    s.enabled && mcpStatus[s.id]?.status === 'testing'
  )

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
      await window.api.tools.saveConfigs(updated.map(t => ({
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
      <DialogContent className="sm:max-w-[950px] h-[80vh] flex flex-col overflow-hidden">
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
          <button
            onClick={() => setActiveTab('cronjobs')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'cronjobs'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock className="size-4" />
            Cronjobs
            {activeTab === 'cronjobs' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('sandbox')}
            className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'sandbox'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Container className="size-4" />
            Sandbox
            {activeTab === 'sandbox' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                activeTab === 'admin'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Shield className="size-4" />
              Admin
              {activeTab === 'admin' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          )}
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

                  {/* Default Model - hidden for Tier 1 users who can't select models */}
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
                      {isCreatingNew ? 'Create Agent' : 'Save Changes'}
                    </Button>
                  </div>
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

                {/* Transport type toggle */}
                <div className="flex gap-1 p-1 bg-muted rounded-sm w-fit">
                  <button
                    onClick={() => setNewMcpTransport('stdio')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
                      newMcpTransport === 'stdio'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Terminal className="size-3" />
                    Local (stdio)
                  </button>
                  <button
                    onClick={() => setNewMcpTransport('http')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
                      newMcpTransport === 'http'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Globe className="size-3" />
                    Remote (HTTP)
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    placeholder="e.g., filesystem"
                  />
                </div>

                {newMcpTransport === 'stdio' ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Command</label>
                        <Input
                          value={newMcpCommand}
                          onChange={(e) => setNewMcpCommand(e.target.value)}
                          placeholder="e.g., npx or uvx"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Arguments (space-separated)</label>
                        <Input
                          value={newMcpArgs}
                          onChange={(e) => setNewMcpArgs(e.target.value)}
                          placeholder="e.g., -y @modelcontextprotocol/server-filesystem /path"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Example: <code>uvx</code> with <code>mcp-server-fetch</code> or <code>npx</code> with <code>-y @modelcontextprotocol/server-filesystem /path</code>
                    </p>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Server URL</label>
                      <Input
                        value={newMcpUrl}
                        onChange={(e) => setNewMcpUrl(e.target.value)}
                        placeholder="e.g., https://mcp.atlassian.com/v1/mcp"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Authentication</label>
                      <select
                        value={newMcpAuthType}
                        onChange={(e) => setNewMcpAuthType(e.target.value as 'none' | 'bearer' | 'oauth')}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                      >
                        <option value="none">None</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="oauth">OAuth 2.1</option>
                      </select>
                    </div>
                    {newMcpAuthType === 'bearer' && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Bearer Token</label>
                        <Input
                          type="password"
                          value={newMcpBearerToken}
                          onChange={(e) => setNewMcpBearerToken(e.target.value)}
                          placeholder="Enter your API token"
                        />
                      </div>
                    )}
                    {newMcpAuthType === 'oauth' && (
                      <p className="text-xs text-muted-foreground">
                        OAuth authorization will be available after adding the server.
                      </p>
                    )}
                  </>
                )}

                <Button
                  size="sm"
                  onClick={addMcpServer}
                  disabled={
                    !newMcpName.trim() ||
                    (newMcpTransport === 'stdio' ? !newMcpCommand.trim() : !newMcpUrl.trim())
                  }
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
                    const isHttp = server.transport === 'http'
                    const isOAuth = isHttp && server.auth?.type === 'oauth'
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
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  isHttp ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground'
                                }`}>
                                  {isHttp ? <Globe className="size-2.5" /> : <Terminal className="size-2.5" />}
                                  {isHttp ? 'Remote' : 'Local'}
                                </span>
                                {server.enabled && getMcpStatusIcon(server.id)}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {isHttp ? server.url : `${server.command} ${(server.args || []).join(' ')}`}
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

                        {server.enabled && (
                          <div className="mt-2 pt-2 border-t border-border/50 space-y-2">
                            {/* OAuth authorization controls */}
                            {isOAuth && (
                              <div className="flex items-center gap-2">
                                {status?.oauthAuthorized ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 text-xs text-status-nominal">
                                      <Check className="size-3" />
                                      Authorized
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => revokeOAuth(server.id)}
                                      className="text-xs h-6 px-2 text-muted-foreground hover:text-destructive"
                                    >
                                      <LogOut className="size-3 mr-1" />
                                      Revoke
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => initiateOAuth(server.id)}
                                    disabled={authorizingServerId === server.id}
                                    className="text-xs h-7"
                                  >
                                    {authorizingServerId === server.id ? (
                                      <Loader2 className="size-3 animate-spin mr-1" />
                                    ) : (
                                      <Key className="size-3 mr-1" />
                                    )}
                                    {authorizingServerId === server.id ? 'Authorizing...' : 'Authorize'}
                                  </Button>
                                )}
                              </div>
                            )}

                            {/* Connection status */}
                            {status && (
                              <>
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
                              </>
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
            <div className="space-y-3 py-4">
              <div>
                <p className="text-xs text-muted-foreground mb-4">
                  Manage tools available to your AI assistant. Toggle groups or individual tools, and set approval requirements.
                </p>
              </div>

              {toolGroups.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Wrench className="size-8 mx-auto mb-2 opacity-50" />
                  <p>No tools available</p>
                  <p className="text-xs mt-1">Connect apps or MCP servers to add tools</p>
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

              {testingMcpServers.length > 0 && (
                <div className="border border-border rounded-sm p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Connecting to {testingMcpServers.map(s => s.name).join(', ')}...</span>
                  </div>
                </div>
              )}

              {failedMcpServers.length > 0 && (
                <div className="space-y-2">
                  {failedMcpServers.map(server => (
                    <div key={server.id} className="border border-destructive/30 rounded-sm p-3 bg-destructive/5">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="size-4 text-destructive shrink-0" />
                            <span className="font-medium text-sm">{server.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">MCP Server</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 ml-6">
                            Failed to load tools: {mcpStatus[server.id]?.error || 'Unknown error'}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => testMcpConnection(server)}
                          className="shrink-0"
                        >
                          <RefreshCw className="size-3 mr-1" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
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

          {/* Skills Tab */}
          {activeTab === 'skills' && <SkillsTab />}

          {/* Cronjobs Tab */}
          {activeTab === 'cronjobs' && <CronjobsTab />}

          {/* Sandbox Tab */}
          {activeTab === 'sandbox' && (
            <SandboxSettings
              config={sandboxConfig}
              onConfigChange={setSandboxConfig}
              onSave={handleSaveSandboxConfig}
            />
          )}

          {/* Admin Tab */}
          {activeTab === 'admin' && isAdmin && <AdminTab />}
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
