/**
 * Exa Settings Component (displayed as "Search and Datasets")
 * Allows users to connect/disconnect Exa API and see connection status
 */

import { useState, useEffect, useCallback } from 'react'
import { Search, Loader2, Power, PowerOff, RefreshCw, Database, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectionHealthBadge, type HealthStatus } from './ConnectionHealthBadge'

interface ConnectionStatus {
  connected: boolean
  apiKeyConfigured: boolean
  healthStatus?: HealthStatus
}

export function ExaSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    apiKeyConfigured: false,
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
    const cleanup = window.api.exa.onConnectionChange((newStatus) => {
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
    window.api.exa.subscribeConnection()

    return () => {
      cleanup()
      window.api.exa.unsubscribeConnection()
    }
  }, [])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.exa.getStatus()
      setStatus({
        ...currentStatus,
        healthStatus: currentStatus.connected ? 'healthy' : 'unknown'
      })
    } catch (error) {
      console.error('Failed to load Exa status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    try {
      await window.api.exa.connect()
      // Refresh status
      await loadStatus()
    } catch (error) {
      console.error('Failed to connect Exa:', error)
    } finally {
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.exa.disconnect()
      setStatus({
        connected: false,
        apiKeyConfigured: status.apiKeyConfigured,
        healthStatus: 'unknown'
      })
    } catch (error) {
      console.error('Failed to disconnect Exa:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [status.apiKeyConfigured])

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading Search and Datasets status...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border border-border rounded-sm bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
            <Search className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Search and Datasets</span>
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
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !status.apiKeyConfigured}
              title={!status.apiKeyConfigured ? 'Set EXA_API_KEY in server .env file' : undefined}
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

      {/* Capabilities - Only shown when connected */}
      {status.connected && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 p-2 rounded bg-status-nominal/10 text-status-nominal">
              <Globe className="size-4" />
              <span className="text-sm">Web Search</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded bg-status-nominal/10 text-status-nominal">
              <Database className="size-4" />
              <span className="text-sm">Datasets</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Search and Datasets is connected. The agent can now search the web for current information and create datasets with enriched data.
          </p>
        </div>
      )}

      {/* API Key Not Configured Warning */}
      {!status.connected && !status.apiKeyConfigured && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-amber-500">
            API key not configured. Add EXA_API_KEY to your server .env file to enable this feature.
          </p>
        </div>
      )}

      {/* Connecting State Info */}
      {connecting && !status.connected && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            Connecting to the search API...
          </p>
        </div>
      )}
    </div>
  )
}
