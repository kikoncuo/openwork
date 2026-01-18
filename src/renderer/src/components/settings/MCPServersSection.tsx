import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit, Server, Check, AlertCircle, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import type { MCPServerConfig, MCPServerInput } from '@/../../main/types/mcp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

interface MCPServersSectionProps {
  className?: string
}

export function MCPServersSection({ className }: MCPServersSectionProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editDialog, setEditDialog] = useState<{
    open: boolean
    server?: MCPServerConfig
  }>({ open: false })

  useEffect(() => {
    loadServers()
  }, [])

  async function loadServers() {
    setLoading(true)
    try {
      const serverList = await window.api.mcp.list()
      setServers(serverList)
    } catch (error) {
      console.error('Failed to load MCP servers:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(serverId: string) {
    try {
      await window.api.mcp.delete(serverId)
      await loadServers()
    } catch (error) {
      console.error('Failed to delete server:', error)
    }
  }

  async function handleToggleEnabled(server: MCPServerConfig) {
    try {
      await window.api.mcp.update(server.id, { enabled: !server.enabled })
      await loadServers()
    } catch (error) {
      console.error('Failed to toggle server:', error)
    }
  }

  function openEditDialog(server?: MCPServerConfig) {
    setEditDialog({ open: true, server })
  }

  function closeEditDialog() {
    setEditDialog({ open: false, server: undefined })
  }

  async function handleSave(input: MCPServerInput) {
    try {
      if (editDialog.server) {
        await window.api.mcp.update(editDialog.server.id, input)
      } else {
        await window.api.mcp.create(input)
      }
      await loadServers()
      closeEditDialog()
    } catch (error) {
      console.error('Failed to save server:', error)
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-section-header">MCP SERVERS</div>
        <Button variant="outline" size="sm" onClick={() => openEditDialog()}>
          <Plus className="size-4 mr-1.5" />
          Add Server
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Server className="size-8 mx-auto mb-2 opacity-50" />
          <p>No MCP servers configured</p>
          <p className="text-xs mt-1">Add a server to enable MCP tools</p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.id}
              className="border border-border rounded-sm p-3 hover:border-border-emphasis transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{server.name}</span>
                    {server.enabled ? (
                      <Badge variant="default" className="text-xs">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Disabled
                      </Badge>
                    )}
                    {server.defaultRequireInterrupt && (
                      <Badge variant="outline" className="text-xs flex items-center gap-1">
                        <ShieldCheck className="size-3" />
                        Interrupts
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {server.type === 'url' ? (
                      <span>{server.url}</span>
                    ) : (
                      <span>{server.command} {server.args?.join(' ')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleEnabled(server)}
                    className="h-8 w-8 p-0"
                  >
                    {server.enabled ? (
                      <Check className="size-4 text-status-nominal" />
                    ) : (
                      <AlertCircle className="size-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(server)}
                    className="h-8 w-8 p-0"
                  >
                    <Edit className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(server.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <MCPServerDialog
        open={editDialog.open}
        server={editDialog.server}
        onClose={closeEditDialog}
        onSave={handleSave}
      />
    </div>
  )
}

interface MCPServerDialogProps {
  open: boolean
  server?: MCPServerConfig
  onClose: () => void
  onSave: (input: MCPServerInput) => void
}

function MCPServerDialog({ open, server, onClose, onSave }: MCPServerDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'url' | 'stdio'>('url')
  const [url, setUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [defaultRequireInterrupt, setDefaultRequireInterrupt] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (server) {
        setName(server.name)
        setType(server.type)
        setUrl(server.url || '')
        setAuthToken(server.authToken ? '••••••••••••••••' : '')
        setDefaultRequireInterrupt(server.defaultRequireInterrupt ?? true)
      } else {
        // Reset for new server
        setName('')
        setType('url')
        setUrl('')
        setAuthToken('')
        setDefaultRequireInterrupt(true)
      }
      setShowToken(false)
    }
  }, [open, server])

  async function handleSubmit() {
    if (!name.trim() || (type === 'url' && !url.trim())) {
      return
    }

    setSaving(true)
    try {
      const input: MCPServerInput = {
        name: name.trim(),
        type,
        url: type === 'url' ? url.trim() : undefined,
        authToken: authToken && authToken !== '••••••••••••••••' ? authToken.trim() : undefined,
        defaultRequireInterrupt
      }
      await onSave(input)
    } finally {
      setSaving(false)
    }
  }

  function handleTokenChange(value: string) {
    // If user starts typing on a masked field, clear it
    if (authToken === '••••••••••••••••' && value.length > 16) {
      value = value.slice(16)
    }
    setAuthToken(value)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{server ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
          <DialogDescription>
            Configure an MCP (Model Context Protocol) server to provide additional tools to the agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Server Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Server URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp/sse"
            />
            <p className="text-xs text-muted-foreground">
              SSE endpoint for the MCP server
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Authorization Token (Optional)</label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={authToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="token_..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="require-interrupt"
                checked={defaultRequireInterrupt}
                onChange={(e) => setDefaultRequireInterrupt(e.target.checked)}
                className="size-4"
              />
              <label htmlFor="require-interrupt" className="text-sm font-medium cursor-pointer">
                Require approval before calling tools
              </label>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              When enabled, all tool calls from this server will require human approval before execution
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim() || !url.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {server ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
