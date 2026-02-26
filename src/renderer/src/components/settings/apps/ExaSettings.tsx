/**
 * Search and Datasets Settings Component
 * Allows users to connect/disconnect using an API key
 * Note: Display as "Search and Datasets" - never mention "Exa" in the UI
 */

import { useState, useEffect, useCallback } from 'react'
import { Search, Check, Loader2, Power, PowerOff, RefreshCw, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ConnectionStatus {
  connected: boolean
  apiKeyConfigured: boolean
  error?: string
}

export function ExaSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    apiKeyConfigured: false
  })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load initial status
  useEffect(() => {
    loadStatus()
  }, [])

  // Subscribe to connection changes
  useEffect(() => {
    const cleanup = window.api.exa.onConnectionChange((data) => {
      setStatus(data)
      if (data.connected) {
        setConnecting(false)
        setError(null)
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
      setStatus(currentStatus)
    } catch (err) {
      console.error('Failed to load Search and Datasets status:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setConnecting(true)
    setError(null)

    try {
      await window.api.exa.connect(apiKey.trim())
      setApiKey('')
      await loadStatus()
    } catch (err) {
      console.error('Failed to connect Search and Datasets:', err)
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setConnecting(false)
    }
  }, [apiKey])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.exa.disconnect()
      setStatus({
        connected: false,
        apiKeyConfigured: false
      })
    } catch (err) {
      console.error('Failed to disconnect Search and Datasets:', err)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  const handleKeyPress = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !connecting) {
      handleConnect()
    }
  }, [connecting, handleConnect])

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
              {status.connected ? (
                <span className="flex items-center gap-1 text-xs text-status-nominal">
                  <Check className="size-3" />
                  Connected
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Not connected</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Web search and dataset creation tools
            </p>
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

      {/* API Key Input when not connected */}
      {!status.connected && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                API Key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="Enter your API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleConnect}
                  disabled={connecting || !apiKey.trim()}
                >
                  {connecting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <Power className="size-4 mr-2" />
                  )}
                  Connect
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-status-critical">
                <AlertCircle className="size-4" />
                {error}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://dashboard.exa.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-status-info hover:underline"
              >
                dashboard.exa.ai
              </a>
            </p>
          </div>
        </div>
      )}

      {status.connected && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            Search and Datasets is connected. The agent can now search the web, create datasets, and export results to CSV.
          </p>
        </div>
      )}
    </div>
  )
}
