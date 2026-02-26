/**
 * Google Workspace Settings Component
 * Allows users to connect/disconnect Google Workspace via OAuth
 * and see connection status for Gmail, Calendar, Drive, and Docs
 */

import { useState, useEffect, useCallback } from 'react'
import { Cloud, Loader2, Power, PowerOff, RefreshCw, Mail, Calendar, HardDrive, FileText, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ConnectionStatus {
  connected: boolean
  email: string | null
  connectedAt: number | null
  services: {
    gmail: boolean
    calendar: boolean
    drive: boolean
    docs: boolean
  }
}

interface ServiceStatus {
  name: string
  enabled: boolean
  icon: React.ReactNode
}

export function GoogleWorkspaceSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    email: null,
    connectedAt: null,
    services: {
      gmail: false,
      calendar: false,
      drive: false,
      docs: false
    }
  })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Load initial status
  useEffect(() => {
    loadStatus()
  }, [])

  // Subscribe to connection changes
  useEffect(() => {
    const cleanup = window.api.googleWorkspace.onConnectionChange((newStatus) => {
      setStatus(newStatus)

      // Stop connecting state when connected
      if (newStatus.connected) {
        setConnecting(false)
      }
    })

    // Subscribe to connection events
    window.api.googleWorkspace.subscribeConnection()

    return () => {
      cleanup()
      window.api.googleWorkspace.unsubscribeConnection()
    }
  }, [])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.googleWorkspace.getStatus()
      setStatus(currentStatus)
    } catch (error) {
      console.error('Failed to load Google Workspace status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    try {
      // This opens the browser for OAuth
      await window.api.googleWorkspace.connect()
      // The connection callback will update the status when complete
    } catch (error) {
      console.error('Failed to connect Google Workspace:', error)
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.googleWorkspace.disconnect()
      setStatus({
        connected: false,
        email: null,
        connectedAt: null,
        services: {
          gmail: false,
          calendar: false,
          drive: false,
          docs: false
        }
      })
    } catch (error) {
      console.error('Failed to disconnect Google Workspace:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  const getServiceStatuses = (): ServiceStatus[] => {
    return [
      { name: 'Gmail', enabled: status.services.gmail, icon: <Mail className="size-4" /> },
      { name: 'Calendar', enabled: status.services.calendar, icon: <Calendar className="size-4" /> },
      { name: 'Drive', enabled: status.services.drive, icon: <HardDrive className="size-4" /> },
      { name: 'Docs & Sheets', enabled: status.services.docs, icon: <FileText className="size-4" /> }
    ]
  }

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading Google Workspace status...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border border-border rounded-sm bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
            <Cloud className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Google Workspace</span>
              {status.connected ? (
                <span className="flex items-center gap-1 text-xs text-status-nominal">
                  <Check className="size-3" />
                  Connected
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Not connected</span>
              )}
            </div>
            {status.connected && status.email && (
              <div className="text-sm text-muted-foreground">
                {status.email}
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
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {/* Service Status Cards - Only shown when connected */}
      {status.connected && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="grid grid-cols-2 gap-2">
            {getServiceStatuses().map((service) => (
              <div
                key={service.name}
                className={`flex items-center gap-2 p-2 rounded ${
                  service.enabled
                    ? 'bg-status-nominal/10 text-status-nominal'
                    : 'bg-muted/50 text-muted-foreground'
                }`}
              >
                {service.icon}
                <span className="text-sm">{service.name}</span>
                {service.enabled && <Check className="size-3 ml-auto" />}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Google Workspace is connected. The agent can now search emails, view calendar events, access Drive files, and read documents on your behalf.
          </p>
        </div>
      )}

      {/* Connecting State Info */}
      {connecting && !status.connected && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            A browser window should open for Google authentication. Complete the sign-in process to connect your account.
          </p>
        </div>
      )}
    </div>
  )
}
