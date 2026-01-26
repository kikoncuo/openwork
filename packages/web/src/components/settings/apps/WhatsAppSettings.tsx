/**
 * WhatsApp Settings Component
 * Allows users to connect/disconnect WhatsApp via QR code scanning
 * and configure auto-agent responses for incoming messages
 */

import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, Loader2, Power, PowerOff, RefreshCw, AlertCircle, Bot, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/lib/store'
import { ConnectionHealthBadge, type HealthStatus } from './ConnectionHealthBadge'
import { AppWarningBanner } from './AppWarningBanner'

interface ConnectionStatus {
  connected: boolean
  phoneNumber: string | null
  connectedAt: number | null
  healthStatus?: HealthStatus
  warningMessage?: string | null
}

interface AgentConfig {
  enabled: boolean
  agent_id: string | null
  thread_timeout_minutes: number
}

export function WhatsAppSettings(): React.JSX.Element {
  const agents = useAppStore((s) => s.agents)
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    phoneNumber: null,
    connectedAt: null,
    healthStatus: 'unknown',
    warningMessage: null
  })
  const [reconnecting, setReconnecting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  // Agent config state
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    enabled: false,
    agent_id: null,
    thread_timeout_minutes: 30
  })
  const [agentConfigLoading, setAgentConfigLoading] = useState(false)
  const [agentConfigSaving, setAgentConfigSaving] = useState(false)

  // Load initial status
  useEffect(() => {
    loadStatus()
  }, [])

  // Load agent config when connected
  useEffect(() => {
    if (status.connected) {
      loadAgentConfig()
    }
  }, [status.connected])

  async function loadAgentConfig(): Promise<void> {
    setAgentConfigLoading(true)
    try {
      const config = await window.api.whatsapp.getAgentConfig()
      setAgentConfig(config)
    } catch (error) {
      console.error('Failed to load WhatsApp agent config:', error)
    } finally {
      setAgentConfigLoading(false)
    }
  }

  async function saveAgentConfig(updates: Partial<AgentConfig>): Promise<void> {
    setAgentConfigSaving(true)
    try {
      const config = await window.api.whatsapp.updateAgentConfig(updates)
      setAgentConfig(config)
    } catch (error) {
      console.error('Failed to save WhatsApp agent config:', error)
    } finally {
      setAgentConfigSaving(false)
    }
  }

  // Subscribe to connection changes
  useEffect(() => {
    const cleanup = window.api.whatsapp.onConnectionChange((data) => {
      setStatus(prev => ({
        ...prev,
        connected: data.connected,
        phoneNumber: data.phoneNumber || null,
        connectedAt: data.connected ? Date.now() : null,
        // Clear health warning on fresh connection
        healthStatus: data.connected ? 'healthy' : 'unknown',
        warningMessage: null
      }))

      // Close QR modal on successful connection
      if (data.connected) {
        setQrModalOpen(false)
        setQrCode(null)
        setConnecting(false)
        setReconnecting(false)
      }
    })

    // Subscribe to connection events
    window.api.whatsapp.subscribeConnection()

    return () => {
      cleanup()
      window.api.whatsapp.unsubscribeConnection()
    }
  }, [])

  // Subscribe to connection health status updates via WebSocket
  useEffect(() => {
    const handleConnectionStatus = (data: {
      appType: string
      eventType: string
      status?: string
      healthStatus?: HealthStatus
      warningMessage?: string
    }) => {
      // Only handle whatsapp events
      if (data.appType !== 'whatsapp') return

      console.log('[WhatsApp] Connection status update:', data)

      if (data.eventType === 'app:health_warning') {
        setStatus(prev => ({
          ...prev,
          healthStatus: data.healthStatus || 'warning',
          warningMessage: data.warningMessage || 'Connection needs attention'
        }))
      } else if (data.eventType === 'app:health_cleared') {
        setStatus(prev => ({
          ...prev,
          healthStatus: 'healthy',
          warningMessage: null
        }))
        setReconnecting(false)
      } else if (data.eventType === 'app:disconnected') {
        setStatus(prev => ({
          ...prev,
          connected: false,
          healthStatus: 'unknown',
          warningMessage: null
        }))
        setReconnecting(false)
      }
    }

    // Listen for WebSocket connection status events
    if (window.api?.socket?.on) {
      window.api.socket.on('connection:status', handleConnectionStatus)
    }

    return () => {
      if (window.api?.socket?.off) {
        window.api.socket.off('connection:status', handleConnectionStatus)
      }
    }
  }, [])

  // Subscribe to QR code events when modal is open
  useEffect(() => {
    if (!qrModalOpen) return

    const cleanup = window.api.whatsapp.onQRCode((qr) => {
      setQrCode(qr)
      setQrError(null)
    })

    // Subscribe to QR events
    window.api.whatsapp.subscribeQR()

    return () => {
      cleanup()
      window.api.whatsapp.unsubscribeQR()
    }
  }, [qrModalOpen])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.whatsapp.getStatus() as {
        connected: boolean
        phoneNumber: string | null
        connectedAt: string | null
        healthStatus?: HealthStatus
        warningMessage?: string | null
      }
      setStatus({
        connected: currentStatus.connected,
        phoneNumber: currentStatus.phoneNumber,
        connectedAt: currentStatus.connectedAt ? new Date(currentStatus.connectedAt).getTime() : null,
        healthStatus: currentStatus.healthStatus || (currentStatus.connected ? 'healthy' : 'unknown'),
        warningMessage: currentStatus.warningMessage || null
      })
    } catch (error) {
      console.error('Failed to load WhatsApp status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    setQrError(null)
    setQrCode(null)
    setQrModalOpen(true)

    try {
      const qr = await window.api.whatsapp.connect()
      if (qr) {
        setQrCode(qr)
      } else {
        // Already connected, close modal
        setQrModalOpen(false)
        await loadStatus()
      }
    } catch (error) {
      console.error('Failed to connect WhatsApp:', error)
      setQrError(error instanceof Error ? error.message : 'Failed to connect')
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.whatsapp.disconnect()
      setStatus({
        connected: false,
        phoneNumber: null,
        connectedAt: null,
        healthStatus: 'unknown',
        warningMessage: null
      })
    } catch (error) {
      console.error('Failed to disconnect WhatsApp:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  const handleReconnect = useCallback(async (): Promise<void> => {
    setReconnecting(true)
    try {
      // Disconnect first, then reconnect
      await window.api.whatsapp.disconnect()
      // Small delay before reconnecting
      await new Promise(resolve => setTimeout(resolve, 500))
      // Reconnect - this will show QR modal if needed
      setConnecting(true)
      setQrError(null)
      setQrCode(null)
      setQrModalOpen(true)

      const qr = await window.api.whatsapp.connect()
      if (qr) {
        setQrCode(qr)
      } else {
        // Already connected, close modal
        setQrModalOpen(false)
        await loadStatus()
        setReconnecting(false)
      }
    } catch (error) {
      console.error('Failed to reconnect WhatsApp:', error)
      setReconnecting(false)
      setConnecting(false)
    }
  }, [])

  const handleCloseQrModal = useCallback((): void => {
    setQrModalOpen(false)
    setQrCode(null)
    setQrError(null)
    setConnecting(false)
  }, [])

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading WhatsApp status...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
              <MessageSquare className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">WhatsApp</span>
                <ConnectionHealthBadge
                  status={status.connected ? 'connected' : 'disconnected'}
                  healthStatus={status.healthStatus || 'unknown'}
                />
              </div>
              {status.connected && status.phoneNumber && (
                <div className="text-sm text-muted-foreground">
                  {status.phoneNumber}
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
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <Power className="size-4 mr-2" />
                )}
                Connect
              </Button>
            )}
          </div>
        </div>

        {/* Warning Banner - shown when health is degraded */}
        {status.connected && status.warningMessage && (
          <AppWarningBanner
            message={status.warningMessage}
            recommendation="Try reconnecting to restore full functionality"
            onReconnect={handleReconnect}
            reconnecting={reconnecting}
            className="mt-3"
          />
        )}

        {status.connected && !status.warningMessage && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              WhatsApp is connected. The agent can now search messages, view contacts, and send messages on your behalf.
            </p>
          </div>
        )}
      </div>

      {/* Agent Configuration Section - Only shown when connected */}
      {status.connected && (
        <div className="p-4 border border-border rounded-sm bg-background mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${agentConfig.enabled ? 'bg-status-nominal/20' : 'bg-muted'}`}>
                <Bot className={`size-5 ${agentConfig.enabled ? 'text-status-nominal' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <div className="font-medium">Auto-Agent Response</div>
                <div className="text-xs text-muted-foreground">
                  Automatically respond to incoming messages
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
                <Label htmlFor="agent-select">Agent</Label>
                <Select
                  value={agentConfig.agent_id || ''}
                  onValueChange={(value) => saveAgentConfig({ agent_id: value || null })}
                  disabled={agentConfigSaving || agents.length === 0}
                >
                  <SelectTrigger id="agent-select">
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
                {agents.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No agents available. Create an agent first.
                  </p>
                )}
              </div>

              {/* Thread Timeout */}
              <div className="space-y-2">
                <Label htmlFor="thread-timeout">Thread Timeout (minutes)</Label>
                <Input
                  id="thread-timeout"
                  type="number"
                  min={1}
                  max={1440}
                  value={agentConfig.thread_timeout_minutes}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (value >= 1 && value <= 1440) {
                      saveAgentConfig({ thread_timeout_minutes: value })
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
                  <span>Auto-response is active. Incoming messages will be answered by the agent.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* QR Code Modal */}
      <Dialog open={qrModalOpen} onOpenChange={handleCloseQrModal}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
            <DialogDescription>
              Scan the QR code with your WhatsApp mobile app to connect.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-6">
            {qrError ? (
              <div className="text-center">
                <AlertCircle className="size-12 mx-auto mb-4 text-status-critical" />
                <p className="text-sm text-status-critical mb-4">{qrError}</p>
                <Button onClick={handleConnect}>
                  <RefreshCw className="size-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : qrCode ? (
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="w-64 h-64"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Loader2 className="size-12 animate-spin text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">Generating QR code...</p>
              </div>
            )}
          </div>

          <div className="text-center text-xs text-muted-foreground space-y-2">
            <p>1. Open WhatsApp on your phone</p>
            <p>2. Go to Settings → Linked Devices</p>
            <p>3. Tap "Link a Device" and scan this QR code</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
