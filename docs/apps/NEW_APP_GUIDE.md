# Adding a New App Integration

This guide walks through the process of adding support for a new app (e.g., Telegram, Slack, Discord) to OpenWork.

## Overview

The app connection system uses an adapter pattern. Each app implements the `AppAdapter` interface, which is then registered with the `AppConnectionManager`.

```
┌─────────────────────────────────────────────────────────────┐
│                 AppConnectionManager                         │
├─────────────────────────────────────────────────────────────┤
│  - Manages connection lifecycle                             │
│  - Health monitoring with periodic checks                   │
│  - Emits events through Hook System                         │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ↓               ↓               ↓
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ WhatsApp   │  │ Your New   │  │ Future     │
     │ Adapter    │  │ Adapter    │  │ Adapters   │
     └────────────┘  └────────────┘  └────────────┘
```

## Step 1: Define the Adapter

Create a new directory and adapter file:

```
packages/server/src/services/apps/
├── types.ts
├── connection-manager.ts
├── whatsapp/
│   ├── whatsapp-adapter.ts
│   └── socket-manager.ts
└── your-app/                    # New directory
    ├── your-app-adapter.ts      # New adapter
    └── your-app-client.ts       # App-specific client
```

### Implement the AppAdapter Interface

```typescript
// packages/server/src/services/apps/your-app/your-app-adapter.ts

import type { AppAdapter, HealthCheckResult, HealthStatus } from '../types.js'
import { connectionManager } from '../connection-manager.js'
import { YourAppClient } from './your-app-client.js'

export class YourAppAdapter implements AppAdapter {
  // Required properties
  readonly appType = 'your_app' as const
  readonly displayName = 'Your App'
  readonly description = 'Connect your app account to send and receive messages'

  // Internal client instance(s)
  private clients: Map<string, YourAppClient> = new Map()

  /**
   * Connect to the app
   * Called when user initiates connection from Settings
   */
  async connect(userId: string, options?: Record<string, unknown>): Promise<void> {
    // 1. Initialize your app's client/SDK
    const client = new YourAppClient({
      // Pass any options from the connection request
      apiKey: options?.apiKey as string
    })

    // 2. Authenticate/connect
    await client.connect()

    // 3. Store the client instance
    this.clients.set(userId, client)

    // 4. Set up event listeners for incoming messages
    client.on('message', (message) => {
      // Emit message event through hook system
      // This allows the auto-agent responder to handle it
    })
  }

  /**
   * Disconnect from the app
   * Called when user disconnects or on cleanup
   */
  async disconnect(userId: string): Promise<void> {
    const client = this.clients.get(userId)
    if (client) {
      await client.disconnect()
      this.clients.delete(userId)
    }
  }

  /**
   * Perform health check
   * Called periodically and on-demand
   */
  async healthCheck(userId: string): Promise<HealthCheckResult> {
    const client = this.clients.get(userId)

    // Not connected
    if (!client) {
      return {
        healthy: false,
        status: 'critical',
        warningMessage: 'Not connected'
      }
    }

    // Check connection health
    const isAlive = await client.ping()
    if (!isAlive) {
      return {
        healthy: false,
        status: 'warning',
        warningMessage: 'Connection appears stale'
      }
    }

    // Check for other health indicators
    const lastActivity = client.getLastActivityTime()
    const timeSinceActivity = Date.now() - lastActivity

    if (timeSinceActivity > 30 * 60 * 1000) { // 30 minutes
      return {
        healthy: false,
        status: 'warning',
        warningMessage: 'No recent activity'
      }
    }

    return {
      healthy: true,
      status: 'healthy',
      details: {
        lastActivity: new Date(lastActivity).toISOString()
      }
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(userId: string): boolean {
    const client = this.clients.get(userId)
    return client?.isConnected() ?? false
  }

  /**
   * Get connection info for display
   */
  getConnectionInfo(userId: string): Record<string, unknown> | null {
    const client = this.clients.get(userId)
    if (!client) return null

    return {
      username: client.getUsername(),
      connectedAt: client.getConnectedAt()
    }
  }
}

// Singleton instance
export const yourAppAdapter = new YourAppAdapter()

/**
 * Register the adapter with the connection manager
 * Called during app initialization
 */
export function registerYourAppAdapter(): void {
  connectionManager.registerAdapter(yourAppAdapter)
}
```

## Step 2: Register the Adapter

Add registration in the main server initialization:

```typescript
// packages/server/src/index.ts

import { registerWhatsAppAdapter } from './services/apps/whatsapp/whatsapp-adapter.js'
import { registerYourAppAdapter } from './services/apps/your-app/your-app-adapter.js'

async function main() {
  // ... existing initialization ...

  // Register app adapters
  registerWhatsAppAdapter()
  registerYourAppAdapter()  // Add this line

  // Initialize from database
  await connectionManager.initializeFromDatabase()
}
```

## Step 3: Implement Health Checks

Health checks are critical for user experience. Consider these factors:

### Health Status Levels

| Status | Meaning | User Action |
|--------|---------|-------------|
| `healthy` | Everything working | None needed |
| `warning` | Degraded, may have issues | Consider reconnecting |
| `critical` | Not functioning | Must reconnect |
| `unknown` | Can't determine | Check manually |

### Common Health Indicators

```typescript
async healthCheck(userId: string): Promise<HealthCheckResult> {
  const indicators: string[] = []
  let status: HealthStatus = 'healthy'

  // 1. Connection state
  if (!this.isConnected(userId)) {
    return { healthy: false, status: 'critical', warningMessage: 'Not connected' }
  }

  // 2. API responsiveness
  try {
    await client.ping({ timeout: 5000 })
  } catch {
    indicators.push('API not responding')
    status = this.degradeStatus(status, 'warning')
  }

  // 3. Authentication validity
  if (client.isTokenExpired()) {
    indicators.push('Authentication expired')
    status = this.degradeStatus(status, 'critical')
  }

  // 4. Rate limiting
  if (client.isRateLimited()) {
    indicators.push('Rate limited')
    status = this.degradeStatus(status, 'warning')
  }

  // 5. Activity freshness
  const lastActivity = client.getLastActivityTime()
  if (Date.now() - lastActivity > 30 * 60 * 1000) {
    indicators.push('No recent activity')
    status = this.degradeStatus(status, 'warning')
  }

  return {
    healthy: status === 'healthy',
    status,
    warningMessage: indicators.length > 0 ? indicators.join('. ') : undefined
  }
}

private degradeStatus(current: HealthStatus, target: HealthStatus): HealthStatus {
  const order: HealthStatus[] = ['healthy', 'unknown', 'warning', 'critical']
  return order.indexOf(target) > order.indexOf(current) ? target : current
}
```

## Step 4: Create Frontend Component

Create a settings component for your app:

```tsx
// packages/web/src/components/settings/apps/YourAppSettings.tsx

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConnectionHealthBadge } from './ConnectionHealthBadge'
import { AppWarningBanner } from './AppWarningBanner'
import type { ConnectionStatus, HealthStatus } from '@/types/connections'

interface ConnectionState {
  status: ConnectionStatus
  healthStatus: HealthStatus
  warningMessage: string | null
  username?: string
}

export function YourAppSettings() {
  const [status, setStatus] = useState<ConnectionState>({
    status: 'disconnected',
    healthStatus: 'unknown',
    warningMessage: null
  })
  const [apiKey, setApiKey] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)

  // Fetch initial status
  useEffect(() => {
    fetchStatus()
  }, [])

  // Listen for WebSocket updates
  useEffect(() => {
    const socket = getSocket()
    socket.on('connection:status', (data) => {
      if (data.appType === 'your_app') {
        setStatus({
          status: data.status ?? status.status,
          healthStatus: data.healthStatus ?? status.healthStatus,
          warningMessage: data.warningMessage ?? null
        })
      }
    })
    return () => {
      socket.off('connection:status')
    }
  }, [])

  async function fetchStatus() {
    const response = await fetch('/api/connections/your_app', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await response.json()
    setStatus({
      status: data.status,
      healthStatus: data.healthStatus,
      warningMessage: data.warningMessage
    })
  }

  async function handleConnect() {
    setIsConnecting(true)
    try {
      await fetch('/api/connections/your_app/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({ apiKey })
      })
      await fetchStatus()
    } finally {
      setIsConnecting(false)
    }
  }

  async function handleDisconnect() {
    await fetch('/api/connections/your_app/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    await fetchStatus()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <YourAppIcon className="h-8 w-8" />
            <div>
              <CardTitle>Your App</CardTitle>
              <CardDescription>
                Connect your account to send and receive messages
              </CardDescription>
            </div>
          </div>
          <ConnectionHealthBadge
            status={status.status}
            healthStatus={status.healthStatus}
          />
        </div>
      </CardHeader>

      {status.warningMessage && (
        <AppWarningBanner
          message={status.warningMessage}
          onReconnect={handleDisconnect}
        />
      )}

      <CardContent>
        {status.status === 'disconnected' ? (
          <div className="space-y-4">
            <Input
              placeholder="Enter API Key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button
              onClick={handleConnect}
              disabled={isConnecting || !apiKey}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connected as: {status.username}
            </p>
            <Button variant="outline" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

## Step 5: Add to Apps Panel

Register your component in the apps settings panel:

```tsx
// packages/web/src/components/settings/AppsPanel.tsx

import { WhatsAppSettings } from './apps/WhatsAppSettings'
import { YourAppSettings } from './apps/YourAppSettings'

export function AppsPanel() {
  return (
    <div className="space-y-6">
      <WhatsAppSettings />
      <YourAppSettings />  {/* Add your component */}
    </div>
  )
}
```

## Step 6: Handle Messages

If your app receives messages that should trigger AI agents:

```typescript
// In your adapter's connect method

client.on('message', async (message) => {
  // Emit through hook system
  await hookManager.emit({
    type: 'message:received',
    userId,
    source: 'your_app',
    payload: {
      messageId: message.id,
      from: message.sender,
      content: message.text,
      timestamp: message.timestamp
    }
  })
})
```

## Step 7: Testing

### Unit Tests

```typescript
// packages/server/src/services/apps/your-app/__tests__/your-app-adapter.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { YourAppAdapter } from '../your-app-adapter'

describe('YourAppAdapter', () => {
  let adapter: YourAppAdapter

  beforeEach(() => {
    adapter = new YourAppAdapter()
  })

  describe('healthCheck', () => {
    it('returns critical when not connected', async () => {
      const result = await adapter.healthCheck('user-123')
      expect(result.status).toBe('critical')
      expect(result.healthy).toBe(false)
    })

    it('returns healthy when connected and active', async () => {
      // Mock connected state
      await adapter.connect('user-123', { apiKey: 'test' })

      const result = await adapter.healthCheck('user-123')
      expect(result.status).toBe('healthy')
      expect(result.healthy).toBe(true)
    })

    it('returns warning when no recent activity', async () => {
      await adapter.connect('user-123', { apiKey: 'test' })
      // Simulate stale connection
      vi.setSystemTime(Date.now() + 31 * 60 * 1000)

      const result = await adapter.healthCheck('user-123')
      expect(result.status).toBe('warning')
    })
  })
})
```

### Manual Testing Checklist

- [ ] Connect via Settings UI
- [ ] Verify "Connected/Healthy" status shows
- [ ] Disconnect and verify status updates
- [ ] Simulate connection issues and verify warning appears
- [ ] Click "Reconnect" and verify warning clears
- [ ] Send/receive messages and verify activity updates
- [ ] Check WebSocket events are emitted correctly

## Best Practices

### 1. Graceful Error Handling

```typescript
async connect(userId: string, options?: Record<string, unknown>): Promise<void> {
  try {
    await this.doConnect(userId, options)
  } catch (error) {
    // Clean up partial state
    this.clients.delete(userId)

    // Re-throw with context
    throw new Error(`Failed to connect: ${error.message}`)
  }
}
```

### 2. Resource Cleanup

```typescript
async disconnect(userId: string): Promise<void> {
  const client = this.clients.get(userId)
  if (!client) return

  try {
    // Stop health monitoring first
    connectionManager.stopHealthMonitoring(userId, this.appType)

    // Close connections
    await client.disconnect()
  } finally {
    // Always clean up map
    this.clients.delete(userId)
  }
}
```

### 3. Activity Tracking

```typescript
// Track last activity for health checks
private lastActivityTimes: Map<string, number> = new Map()

private updateActivity(userId: string): void {
  this.lastActivityTimes.set(userId, Date.now())
}

// Call this when messages are sent/received
client.on('message', () => this.updateActivity(userId))
client.on('messageSent', () => this.updateActivity(userId))
```

### 4. Emit Connection Events

```typescript
// Emit events so the connection manager can track state
async connect(userId: string): Promise<void> {
  await hookManager.emit({
    type: 'app:connecting',
    userId,
    source: this.appType,
    payload: { appType: this.appType }
  })

  await this.doConnect(userId)

  await hookManager.emit({
    type: 'app:connected',
    userId,
    source: this.appType,
    payload: {
      appType: this.appType,
      metadata: this.getConnectionInfo(userId)
    }
  })
}
```

## Troubleshooting

### Adapter Not Appearing in UI

1. Verify `registerYourAppAdapter()` is called in index.ts
2. Check the adapter is exported correctly
3. Verify the frontend component is imported in AppsPanel

### Health Checks Not Running

1. Verify `connectionManager.startHealthMonitoring()` is called after connect
2. Check the health check interval configuration
3. Look for errors in server logs

### WebSocket Events Not Received

1. Verify the connection-status hook handler is registered
2. Check the event types match what you're emitting
3. Verify the user is in the correct WebSocket room
