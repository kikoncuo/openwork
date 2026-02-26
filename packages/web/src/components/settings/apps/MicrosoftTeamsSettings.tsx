/**
 * Microsoft Teams Settings Component
 * Allows users to connect/disconnect Microsoft Teams via OAuth
 * and see connection status for Teams, Chats, Users, and Search
 */

import { useState, useEffect, useCallback } from 'react'
import { MessageSquareMore, Loader2, Power, PowerOff, RefreshCw, Users, Hash, Search, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionHealthBadge, type HealthStatus } from './ConnectionHealthBadge'

interface ConnectionStatus {
  connected: boolean
  email: string | null
  displayName: string | null
  connectedAt: number | null
  services: {
    teams: boolean
    chats: boolean
    users: boolean
    search: boolean
  }
  healthStatus?: HealthStatus
}

interface ServiceStatus {
  name: string
  enabled: boolean
  icon: React.ReactNode
}

export function MicrosoftTeamsSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    email: null,
    displayName: null,
    connectedAt: null,
    services: {
      teams: false,
      chats: false,
      users: false,
      search: false
    },
    healthStatus: 'unknown'
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
    const cleanup = window.api.microsoftTeams.onConnectionChange((newStatus) => {
      setStatus({
        ...newStatus,
        healthStatus: newStatus.connected ? 'healthy' : 'unknown'
      })

      // Stop connecting state when connected
      if (newStatus.connected) {
        setConnecting(false)
      }
    })

    // Subscribe to connection events
    window.api.microsoftTeams.subscribeConnection()

    return () => {
      cleanup()
      window.api.microsoftTeams.unsubscribeConnection()
    }
  }, [])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.microsoftTeams.getStatus()
      setStatus({
        ...currentStatus,
        healthStatus: currentStatus.connected ? 'healthy' : 'unknown'
      })
    } catch (error) {
      console.error('Failed to load Microsoft Teams status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    try {
      // Get the OAuth URL from the server
      const authUrl = await window.api.microsoftTeams.connect()

      // Open the OAuth URL in a new browser window
      if (authUrl) {
        window.open(authUrl, '_blank', 'width=600,height=700')

        // Poll for connection status as a fallback
        const pollInterval = setInterval(async () => {
          try {
            const currentStatus = await window.api.microsoftTeams.getStatus()
            if (currentStatus.connected) {
              clearInterval(pollInterval)
              setStatus({
                ...currentStatus,
                healthStatus: 'healthy'
              })
              setConnecting(false)
            }
          } catch {
            // Ignore polling errors
          }
        }, 2000)

        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval)
          setConnecting(false)
        }, 5 * 60 * 1000)
      }
    } catch (error) {
      console.error('Failed to connect Microsoft Teams:', error)
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.microsoftTeams.disconnect()
      setStatus({
        connected: false,
        email: null,
        displayName: null,
        connectedAt: null,
        services: {
          teams: false,
          chats: false,
          users: false,
          search: false
        },
        healthStatus: 'unknown'
      })
    } catch (error) {
      console.error('Failed to disconnect Microsoft Teams:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  const getServiceStatuses = (): ServiceStatus[] => {
    return [
      { name: 'Teams & Channels', enabled: status.services.teams, icon: <Hash className="size-4" /> },
      { name: 'Chats', enabled: status.services.chats, icon: <MessageSquareMore className="size-4" /> },
      { name: 'Users', enabled: status.services.users, icon: <Users className="size-4" /> },
      { name: 'Search', enabled: status.services.search, icon: <Search className="size-4" /> }
    ]
  }

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading Microsoft Teams status...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border border-border rounded-sm bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
            <MessageSquareMore className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Microsoft Teams</span>
              <ConnectionHealthBadge
                status={status.connected ? 'connected' : 'disconnected'}
                healthStatus={status.healthStatus || 'unknown'}
              />
            </div>
            {status.connected && status.email && (
              <div className="text-sm text-muted-foreground">
                {status.displayName ? `${status.displayName} (${status.email})` : status.email}
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
            Microsoft Teams is connected. The agent can now read and send messages in your teams, channels, and chats.
          </p>
        </div>
      )}

      {/* Connecting State Info */}
      {connecting && !status.connected && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            A browser window should open for Microsoft authentication. Complete the sign-in process to connect your account.
          </p>
        </div>
      )}
    </div>
  )
}
