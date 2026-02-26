/**
 * Slack Settings Component
 * Allows users to connect/disconnect Slack using their xoxp token and team ID
 */

import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, Loader2, Power, PowerOff, RefreshCw, Eye, EyeOff, Hash, Users, Search, ExternalLink, ChevronDown, ChevronUp, Bot, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConnectionHealthBadge, type HealthStatus } from './ConnectionHealthBadge'
import { windowApi } from '@/api'

interface ConnectionStatus {
  connected: boolean
  error?: string
  healthStatus?: HealthStatus
}

interface AgentConfig {
  enabled: boolean
  agent_id: string | null
  thread_timeout_seconds: number
}

interface Agent {
  agent_id: string
  name: string
  color: string
  icon: string
}

export function SlackSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    healthStatus: 'unknown'
  })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [token, setToken] = useState('')
  const [teamId, setTeamId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  // Agent config state
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    enabled: false,
    agent_id: null,
    thread_timeout_seconds: 60
  })
  const [agentConfigLoading, setAgentConfigLoading] = useState(false)
  const [agentConfigSaving, setAgentConfigSaving] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])

  // Load initial status
  useEffect(() => {
    loadStatus()
    loadAgents()
  }, [])

  // Load agent config when connected
  useEffect(() => {
    if (status.connected) {
      loadAgentConfig()
    }
  }, [status.connected])

  async function loadAgents(): Promise<void> {
    try {
      const agentsList = await windowApi.agents.list()
      setAgents(agentsList)
    } catch (error) {
      console.error('Failed to load agents:', error)
    }
  }

  async function loadAgentConfig(): Promise<void> {
    setAgentConfigLoading(true)
    try {
      const config = await windowApi.slack.getAgentConfig()
      setAgentConfig({
        enabled: config.enabled === 1,
        agent_id: config.agent_id,
        thread_timeout_seconds: config.thread_timeout_seconds
      })
    } catch (error) {
      console.error('Failed to load Slack agent config:', error)
    } finally {
      setAgentConfigLoading(false)
    }
  }

  async function saveAgentConfig(updates: Partial<AgentConfig>): Promise<void> {
    setAgentConfigSaving(true)
    try {
      const config = await windowApi.slack.updateAgentConfig(updates)
      setAgentConfig({
        enabled: config.enabled === 1,
        agent_id: config.agent_id,
        thread_timeout_seconds: config.thread_timeout_seconds
      })
    } catch (error) {
      console.error('Failed to save Slack agent config:', error)
    } finally {
      setAgentConfigSaving(false)
    }
  }

  // Subscribe to connection changes
  useEffect(() => {
    const cleanup = window.api.slack.onConnectionChange((newStatus) => {
      setStatus({
        ...newStatus,
        healthStatus: newStatus.connected ? 'healthy' : 'unknown'
      })

      if (newStatus.connected) {
        setConnecting(false)
        setToken('')
        setTeamId('')
      }
    })

    window.api.slack.subscribeConnection()

    return () => {
      cleanup()
      window.api.slack.unsubscribeConnection()
    }
  }, [])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.slack.getStatus()
      setStatus({
        ...currentStatus,
        healthStatus: currentStatus.connected ? 'healthy' : 'unknown'
      })
    } catch (error) {
      console.error('Failed to load Slack status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    if (!token.trim() || !teamId.trim()) return
    setConnecting(true)
    try {
      await window.api.slack.connect(token.trim(), teamId.trim())
      await loadStatus()
    } catch (error) {
      console.error('Failed to connect Slack:', error)
      setStatus(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to connect'
      }))
    } finally {
      setConnecting(false)
    }
  }, [token, teamId])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.slack.disconnect()
      setStatus({
        connected: false,
        healthStatus: 'unknown'
      })
    } catch (error) {
      console.error('Failed to disconnect Slack:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading Slack status...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border border-border rounded-sm bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
            <MessageSquare className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Slack</span>
              <ConnectionHealthBadge
                status={status.connected ? 'connected' : 'disconnected'}
                healthStatus={status.healthStatus || 'unknown'}
              />
            </div>
            {status.connected && (
              <div className="text-sm text-muted-foreground">
                Connected
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status.connected ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={loadStatus}
                title="Refresh status"
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <PowerOff className="size-4 mr-2" />
                )}
                Disconnect
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Connected state - capabilities */}
      {status.connected && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-2 p-2 rounded bg-status-nominal/10 text-status-nominal">
              <Hash className="size-4" />
              <span className="text-sm">Channels</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded bg-status-nominal/10 text-status-nominal">
              <Users className="size-4" />
              <span className="text-sm">Users</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded bg-status-nominal/10 text-status-nominal">
              <Search className="size-4" />
              <span className="text-sm">Search</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Slack is connected. The agent can now list channels, read messages, and send messages.
          </p>
        </div>
      )}

      {/* Agent Auto-Response Configuration - show when connected */}
      {status.connected && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${agentConfig.enabled ? 'bg-status-nominal/20' : 'bg-muted'}`}>
                <Bot className={`size-5 ${agentConfig.enabled ? 'text-status-nominal' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <div className="font-medium">Auto-Agent Response</div>
                <div className="text-xs text-muted-foreground">
                  Automatically respond to incoming DMs
                </div>
              </div>
            </div>
            <Switch
              checked={agentConfig.enabled}
              onCheckedChange={(enabled) => saveAgentConfig({ enabled })}
              disabled={agentConfigSaving || agentConfigLoading}
            />
          </div>

          {agentConfig.enabled && (
            <div className="space-y-4 pt-4 border-t border-border/50">
              {/* Agent Selector */}
              <div className="space-y-2">
                <Label htmlFor="slack-agent-select">Agent</Label>
                <Select
                  value={agentConfig.agent_id || ''}
                  onValueChange={(value) => saveAgentConfig({ agent_id: value || null })}
                  disabled={agentConfigSaving || agents.length === 0}
                >
                  <SelectTrigger id="slack-agent-select">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.agent_id} value={agent.agent_id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="size-3 rounded-full"
                            style={{ backgroundColor: agent.color }}
                          />
                          {agent.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Thread Timeout */}
              <div className="space-y-2">
                <Label htmlFor="slack-thread-timeout">Thread timeout (seconds)</Label>
                <Input
                  id="slack-thread-timeout"
                  type="number"
                  min={30}
                  max={3600}
                  value={agentConfig.thread_timeout_seconds}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (value >= 30 && value <= 3600) {
                      saveAgentConfig({ thread_timeout_seconds: value })
                    }
                  }}
                  disabled={agentConfigSaving}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  New messages after timeout create a new conversation thread
                </p>
              </div>

              {/* Status Summary */}
              {!agentConfig.agent_id && (
                <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-amber-500 text-xs">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Select an agent to enable auto-responses</span>
                </div>
              )}

              {agentConfig.agent_id && (
                <div className="flex items-center gap-2 p-2 bg-status-nominal/10 border border-status-nominal/30 rounded text-status-nominal text-xs">
                  <Check className="size-4 shrink-0" />
                  <span>Auto-response is active. Incoming DMs will be answered by the agent.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Not connected - show connection form */}
      {!status.connected && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">User OAuth Token</label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="xoxp-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Team ID</label>
            <Input
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="T0123456789"
            />
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowSetup(!showSetup)}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              {showSetup ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              How to get these credentials
            </button>

            {showSetup && (
              <div className="p-3 rounded bg-muted/50 border border-border/50 space-y-3 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground mb-1">1. Create or open your Slack App</p>
                  <p>
                    Go to{' '}
                    <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                      api.slack.com/apps <ExternalLink className="size-3" />
                    </a>
                    {' '}and create a new app (or select an existing one).
                  </p>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">2. Add User Token Scopes</p>
                  <p className="mb-1.5">
                    In your app settings, go to{' '}
                    <span className="font-medium text-foreground">OAuth & Permissions</span>
                    {' '}(left sidebar). Scroll to <span className="font-medium text-foreground">User Token Scopes</span> and add:
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 ml-2">
                    <code className="text-[11px]">channels:read</code>
                    <span className="text-[11px]">List channels</span>
                    <code className="text-[11px]">channels:history</code>
                    <span className="text-[11px]">Read messages</span>
                    <code className="text-[11px]">chat:write</code>
                    <span className="text-[11px]">Send messages</span>
                    <code className="text-[11px]">reactions:write</code>
                    <span className="text-[11px]">Add reactions</span>
                    <code className="text-[11px]">users:read</code>
                    <span className="text-[11px]">List users</span>
                    <code className="text-[11px]">users:read.email</code>
                    <span className="text-[11px]">Read emails</span>
                    <code className="text-[11px]">search:read</code>
                    <span className="text-[11px]">Search messages</span>
                    <code className="text-[11px]">files:write</code>
                    <span className="text-[11px]">Upload files</span>
                    <code className="text-[11px]">files:read</code>
                    <span className="text-[11px]">Download files</span>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">3. Install to Workspace</p>
                  <p>
                    Scroll up on the OAuth & Permissions page and click{' '}
                    <span className="font-medium text-foreground">Install to Workspace</span>
                    {' '}(or Reinstall if updating scopes). Approve the permissions.
                  </p>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">4. Copy your credentials</p>
                  <p>
                    <span className="font-medium text-foreground">User OAuth Token:</span> Copy the token starting with <code className="text-[11px]">xoxp-</code> from the top of the OAuth & Permissions page.
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-foreground">Team ID:</span> Found in your Slack workspace URL: <code className="text-[11px]">app.slack.com/client/<span className="text-primary">T0xxxxx</span>/...</code>
                  </p>
                </div>
              </div>
            )}
          </div>
          {status.error && (
            <p className="text-xs text-destructive">{status.error}</p>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleConnect}
            disabled={connecting || !token.trim() || !teamId.trim()}
          >
            {connecting ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Power className="size-4 mr-2" />
            )}
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      )}
    </div>
  )
}
