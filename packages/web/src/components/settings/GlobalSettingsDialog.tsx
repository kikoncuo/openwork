import { useState, useEffect } from 'react'
import { Loader2, Plus, Trash2, Power, PowerOff, Plug, RefreshCw, XCircle, AppWindow, Package, Clock, Container, Shield, Download, FolderOpen, ExternalLink, Globe, Terminal, Key, LogOut, Check } from 'lucide-react'
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
import { AppsTab } from './apps/AppsTab'
import { CronjobsTab } from './CronjobsTab'
import { SandboxSettings, type SandboxConfig } from './SandboxSettings'
import { AdminTab } from './admin/AdminTab'
import { useIsAdmin } from '@/lib/auth-store'

interface GlobalSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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

export function GlobalSettingsDialog({ open, onOpenChange }: GlobalSettingsDialogProps) {
  const isAdmin = useIsAdmin()
  const [activeTab, setActiveTab] = useState<'apps' | 'mcp' | 'skills' | 'cronjobs' | 'sandbox' | 'admin'>('apps')

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

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)

  // Sandbox settings state
  const [sandboxConfig, setSandboxConfig] = useState<SandboxConfig>({
    type: 'buddy',
    localHost: 'localhost',
    localPort: 8080
  })

  // Load settings when dialog opens
  useEffect(() => {
    if (open) {
      loadAllSettings()
    } else {
      // Clean up OAuth polling when dialog closes
      for (const key of Object.keys(oauthPollingRef)) {
        clearInterval(oauthPollingRef[key])
        delete oauthPollingRef[key]
      }
      setAuthorizingServerId(null)
    }
  }, [open])

  async function loadAllSettings() {
    // Load MCP servers
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

    // Load skills
    try {
      setSkillsLoading(true)
      const loadedSkills = await window.api.skills.list()
      setSkills(loadedSkills)
    } catch (error) {
      console.error('[GlobalSettings] Failed to load skills:', error)
    } finally {
      setSkillsLoading(false)
    }

    // Load sandbox config
    try {
      const config = await window.api.sandbox.getConfig()
      if (config) {
        setSandboxConfig(config)
      }
    } catch (e) {
      console.error('Failed to load sandbox config:', e)
    }
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

  async function initiateOAuth(serverId: string) {
    setAuthorizingServerId(serverId)
    try {
      const result = await window.api.mcp.initiateOAuth(serverId)

      if (result.authorized) {
        // Already authorized
        setMcpStatus(prev => ({
          ...prev,
          [serverId]: { ...prev[serverId], oauthAuthorized: true }
        }))
        setAuthorizingServerId(null)
        return
      }

      if (result.authUrl) {
        // Open popup for authorization
        window.open(result.authUrl, '_blank', 'width=600,height=700')

        // Poll for authorization status
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
              // Test connection now that we're authorized
              const server = mcpServers.find(s => s.id === serverId)
              if (server) testMcpConnection(server)
            }
          } catch { /* ignore polling errors */ }
        }, 2000)

        oauthPollingRef[serverId] = pollInterval

        // Stop polling after 5 minutes
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
    const updated = mcpServers.filter((s) => s.id !== id)
    setMcpServers(updated)

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
        setMcpStatus(prev => {
          const { [id]: _, ...rest } = prev
          return rest
        })
      }
    } catch (e) {
      console.error('Failed to toggle MCP server:', e)
    }
  }

  // Skills handlers
  async function handleSkillDownload() {
    if (!downloadUrl.trim()) return

    setDownloading(true)
    setDownloadError(null)

    try {
      const skill = await window.api.skills.download(downloadUrl.trim())
      setSkills(prev => [skill, ...prev])
      setDownloadUrl('')
    } catch (error) {
      console.error('[GlobalSettings] Download error:', error)
      setDownloadError(error instanceof Error ? error.message : 'Failed to download skill')
    } finally {
      setDownloading(false)
    }
  }

  async function handleSkillDelete(skillId: string) {
    setDeletingSkillId(skillId)
    try {
      await window.api.skills.delete(skillId)
      setSkills(prev => prev.filter(s => s.skill_id !== skillId))
    } catch (error) {
      console.error('[GlobalSettings] Delete error:', error)
    } finally {
      setDeletingSkillId(null)
    }
  }

  function formatGitHubUrl(url: string): string {
    try {
      const parsed = new URL(url)
      const parts = parsed.pathname.split('/')
      if (parts.length >= 5) {
        return `${parts[1]}/${parts[2]}/${parts.slice(4).join('/')}`
      }
      return url
    } catch {
      return url
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

  function getMcpStatusIcon(serverId: string) {
    const status = mcpStatus[serverId]
    if (!status || status.status === 'unknown') {
      return <div className="size-2 rounded-full bg-muted-foreground" />
    }
    if (status.status === 'testing') {
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />
    }
    if (status.status === 'connected') {
      return <div className="size-2 rounded-full bg-status-nominal" />
    }
    return <XCircle className="size-4 text-status-critical" />
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[950px] h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Global Settings</DialogTitle>
          <DialogDescription>
            Configure global settings for apps, servers, and system-wide features.
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-border">
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

          {/* Skills Catalog Tab */}
          {activeTab === 'skills' && (
            <div className="space-y-6 py-4">
              <div>
                <div className="text-section-header mb-2">SKILLS CATALOG</div>
                <p className="text-xs text-muted-foreground mb-4">
                  Download skills from GitHub to extend your agents' capabilities. Enable skills per-agent in Agent Settings.
                </p>
              </div>

              {/* Download Form */}
              <div className="flex gap-2">
                <Input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/tree/branch/path/to/skill"
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && downloadUrl.trim() && !downloading) {
                      handleSkillDownload()
                    }
                  }}
                />
                <Button
                  onClick={handleSkillDownload}
                  disabled={!downloadUrl.trim() || downloading}
                >
                  {downloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="size-4 mr-2" />
                      Download
                    </>
                  )}
                </Button>
              </div>

              {downloadError && (
                <p className="text-sm text-status-critical">{downloadError}</p>
              )}

              {/* Skills List */}
              <div className="space-y-2">
                {skillsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : skills.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <FolderOpen className="size-8 mx-auto mb-2 opacity-50" />
                    <p>No skills installed</p>
                    <p className="text-xs mt-1">Enter a GitHub URL above to download a skill</p>
                  </div>
                ) : (
                  skills.map((skill) => (
                    <div
                      key={skill.skill_id}
                      className="p-3 border border-border rounded-sm bg-background-elevated"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="p-1.5 rounded bg-primary/20">
                            <FolderOpen className="size-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{skill.name}</div>
                            {skill.description && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {skill.description}
                              </div>
                            )}
                            <a
                              href={skill.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 truncate"
                            >
                              <ExternalLink className="size-3 shrink-0" />
                              <span className="truncate">{formatGitHubUrl(skill.source_url)}</span>
                            </a>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleSkillDelete(skill.skill_id)}
                          disabled={deletingSkillId === skill.skill_id}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          {deletingSkillId === skill.skill_id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

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
  )
}
