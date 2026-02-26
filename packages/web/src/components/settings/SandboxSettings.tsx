// packages/web/src/components/settings/SandboxSettings.tsx
// Settings UI for sandbox backend selection (Buddy Computer vs Local Docker)

import { useState, useEffect } from 'react'
import { Check, Loader2, Cloud, Container, RefreshCw, XCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ClientSandbox, createClientSandbox } from '@/services/client-sandbox'
import { initClientToolHandler, stopClientToolHandler, updateClientToolHandler } from '@/services/client-tool-handler'

export interface SandboxConfig {
  type: 'buddy' | 'local'
  localHost: string
  localPort: number
}

interface SandboxSettingsProps {
  config: SandboxConfig
  onConfigChange: (config: SandboxConfig) => void
  onSave: () => Promise<void>
}

type ConnectionStatus = 'disconnected' | 'checking' | 'connected' | 'error'

export function SandboxSettings({ config, onConfigChange, onSave }: SandboxSettingsProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [workspaceInfo, setWorkspaceInfo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Test connection when local settings change
  useEffect(() => {
    if (config.type === 'local') {
      testConnection()
    }
  }, [config.localHost, config.localPort])

  async function testConnection() {
    setConnectionStatus('checking')
    setConnectionError(null)
    setWorkspaceInfo(null)

    try {
      const sandbox = createClientSandbox(config.localHost, config.localPort)
      const health = await sandbox.health()

      if (health && health.status === 'ok') {
        setConnectionStatus('connected')
        setWorkspaceInfo(health.workspace)
      } else {
        setConnectionStatus('error')
        setConnectionError('Container returned invalid health response')
      }
    } catch (error) {
      setConnectionStatus('error')
      setConnectionError(
        error instanceof Error
          ? error.message
          : 'Failed to connect to container'
      )
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave()

      // Initialize or stop client tool handler based on config
      if (config.type === 'local') {
        initClientToolHandler(config.localHost, config.localPort)
      } else {
        stopClientToolHandler()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="text-section-header">SANDBOX BACKEND</div>

      <p className="text-sm text-muted-foreground">
        Choose where code execution and file operations run. Buddy Computer uses
        E2B cloud sandboxes, while Local Container runs on Docker on your machine.
      </p>

      {/* Backend Selection */}
      <div className="grid grid-cols-2 gap-4">
        {/* Buddy Computer (E2B) Option */}
        <button
          onClick={() => onConfigChange({ ...config, type: 'buddy' })}
          className={`relative flex flex-col items-start gap-3 rounded-lg border p-4 transition-colors ${
            config.type === 'buddy'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/50'
          }`}
        >
          <div className="flex items-center gap-3 w-full">
            <div className={`p-2 rounded-lg ${
              config.type === 'buddy' ? 'bg-primary/20' : 'bg-muted'
            }`}>
              <Cloud className="size-5" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium">Buddy Computer</div>
              <div className="text-xs text-muted-foreground">E2B Cloud Sandbox</div>
            </div>
            {config.type === 'buddy' && (
              <Check className="size-5 text-primary" />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-left">
            Runs in isolated cloud environments. No local Docker required.
            Requires E2B API key.
          </p>
        </button>

        {/* Local Container Option */}
        <button
          onClick={() => onConfigChange({ ...config, type: 'local' })}
          className={`relative flex flex-col items-start gap-3 rounded-lg border p-4 transition-colors ${
            config.type === 'local'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/50'
          }`}
        >
          <div className="flex items-center gap-3 w-full">
            <div className={`p-2 rounded-lg ${
              config.type === 'local' ? 'bg-primary/20' : 'bg-muted'
            }`}>
              <Container className="size-5" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium">Local Container</div>
              <div className="text-xs text-muted-foreground">Docker on your machine</div>
            </div>
            {config.type === 'local' && (
              <Check className="size-5 text-primary" />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-left">
            Runs on your local Docker. Files persist on your machine.
            Full control over environment.
          </p>
        </button>
      </div>

      {/* Local Container Settings */}
      {config.type === 'local' && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="text-sm font-medium">Local Container Settings</div>

          {/* Host and Port */}
          <div className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm text-muted-foreground">Host</label>
              <Input
                value={config.localHost}
                onChange={(e) => onConfigChange({ ...config, localHost: e.target.value })}
                placeholder="localhost"
              />
            </div>
            <div className="w-24 space-y-2">
              <label className="text-sm text-muted-foreground">Port</label>
              <Input
                type="number"
                value={config.localPort}
                onChange={(e) => onConfigChange({ ...config, localPort: parseInt(e.target.value) || 8080 })}
                placeholder="8080"
              />
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 text-sm ${
              connectionStatus === 'connected' ? 'text-green-500' :
              connectionStatus === 'error' ? 'text-red-500' :
              connectionStatus === 'checking' ? 'text-yellow-500' :
              'text-muted-foreground'
            }`}>
              {connectionStatus === 'connected' && (
                <>
                  <div className="size-2 rounded-full bg-green-500" />
                  <span>Connected</span>
                </>
              )}
              {connectionStatus === 'error' && (
                <>
                  <XCircle className="size-4" />
                  <span>Not connected</span>
                </>
              )}
              {connectionStatus === 'checking' && (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Checking...</span>
                </>
              )}
              {connectionStatus === 'disconnected' && (
                <>
                  <div className="size-2 rounded-full bg-muted-foreground" />
                  <span>Not tested</span>
                </>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={connectionStatus === 'checking'}
            >
              <RefreshCw className={`size-4 mr-2 ${connectionStatus === 'checking' ? 'animate-spin' : ''}`} />
              Test Connection
            </Button>
          </div>

          {/* Connection Error */}
          {connectionError && (
            <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-md">
              {connectionError}
            </div>
          )}

          {/* Workspace Info */}
          {workspaceInfo && connectionStatus === 'connected' && (
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              <span className="font-medium">Workspace:</span> {workspaceInfo}
            </div>
          )}

          {/* Docker Instructions */}
          <div className="border-t border-border pt-4 mt-4">
            <div className="text-sm font-medium mb-2">Quick Start</div>
            <div className="text-xs text-muted-foreground space-y-2">
              <p>Run this command to start the local container:</p>
              <code className="block bg-muted p-2 rounded text-[11px] font-mono overflow-x-auto">
                docker run -d -p 8080:8080 -v ~/openwork-workspace:/home/user buddy-sandbox
              </code>
              <p className="mt-2">
                Files will be stored in <code className="bg-muted px-1 rounded">~/openwork-workspace</code> on your machine.
              </p>
            </div>
          </div>

          {/* Background Features Notice */}
          <div className="border-t border-border pt-4 mt-4">
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Info className="size-4 text-amber-500" />
              Background Features
            </div>
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                When using Local Container, background features like <strong>Cronjobs</strong>, <strong>WhatsApp integration</strong>, and <strong>Hooks</strong> will only work while this application is open.
              </p>
              <p>
                If you need these features to run continuously in the background (even when the app is closed), use <strong>Buddy Computer</strong> instead.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  )
}
