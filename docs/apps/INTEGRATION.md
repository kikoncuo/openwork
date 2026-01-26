# App Integration Guide for Developers

This guide explains how to integrate with the OpenWork app connection system via APIs and webhooks.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                 AppConnectionManager                     │
├─────────────────────────────────────────────────────────┤
│  - Manages connection lifecycle                         │
│  - Health monitoring with periodic checks               │
│  - Emits events through Hook System                     │
└───────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ↓               ↓               ↓
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ WhatsApp   │  │ Google     │  │ Future     │
     │ Adapter    │  │ Workspace  │  │ Apps       │
     └────────────┘  └────────────┘  └────────────┘
```

## REST API Endpoints

All endpoints require authentication via Bearer token.

### List All Connections

```http
GET /api/connections
Authorization: Bearer <token>
```

Response:
```json
[
  {
    "appType": "whatsapp",
    "displayName": "WhatsApp",
    "description": "Connect your WhatsApp account...",
    "id": "conn-123",
    "status": "connected",
    "healthStatus": "healthy",
    "warningMessage": null,
    "lastHealthCheckAt": "2024-01-26T10:30:00Z",
    "lastSuccessfulActivityAt": "2024-01-26T10:28:00Z"
  }
]
```

### Get Connection Status

```http
GET /api/connections/:appType
Authorization: Bearer <token>
```

### Trigger Health Check

```http
POST /api/connections/:appType/health-check
Authorization: Bearer <token>
```

Response:
```json
{
  "healthy": true,
  "status": "healthy",
  "warningMessage": null,
  "details": {
    "phoneOnline": true,
    "lastActivity": "2024-01-26T10:28:00Z"
  },
  "timestamp": "2024-01-26T10:30:00Z"
}
```

### Get Health Events

```http
GET /api/connections/:appType/health-events?limit=50
Authorization: Bearer <token>
```

Response:
```json
[
  {
    "id": "evt-123",
    "connectionId": "conn-123",
    "eventType": "health_check",
    "details": { "healthy": true, "status": "healthy" },
    "createdAt": "2024-01-26T10:30:00Z"
  }
]
```

## Hook Events

The app connection system emits events through the hook system that you can listen to via webhooks.

### Event Types

| Event | Description |
|-------|-------------|
| `app:connecting` | Connection attempt started |
| `app:connected` | Successfully connected |
| `app:disconnected` | Disconnected (intentional or error) |
| `app:health_warning` | Health degraded, needs attention |
| `app:health_cleared` | Health restored to normal |
| `app:health_check` | Periodic health check completed |

### Event Payload Structure

```json
{
  "id": "evt-uuid",
  "type": "app:health_warning",
  "timestamp": "2024-01-26T10:30:00Z",
  "userId": "user-123",
  "source": "whatsapp",
  "payload": {
    "appType": "whatsapp",
    "status": "degraded",
    "healthStatus": "warning",
    "warningMessage": "Phone appears offline"
  }
}
```

## WebSocket Events

Real-time connection status updates are broadcast via WebSocket.

### Subscribing

Connect to the WebSocket server with authentication:

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: 'your-jwt-token' }
})

socket.on('connection:status', (data) => {
  console.log('Connection status update:', data)
})
```

### Event Structure

```json
{
  "appType": "whatsapp",
  "eventType": "app:health_warning",
  "status": "degraded",
  "healthStatus": "warning",
  "warningMessage": "Phone appears offline",
  "timestamp": "2024-01-26T10:30:00Z"
}
```

## Creating a Webhook

To receive connection events via HTTP callback:

```http
POST /api/hooks/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Connection Monitor",
  "url": "https://my-server.com/webhook",
  "eventTypes": ["app:health_warning", "app:health_cleared"],
  "secret": "optional-hmac-secret"
}
```

### Webhook Payload

```json
{
  "event": {
    "id": "evt-uuid",
    "type": "app:health_warning",
    "timestamp": "2024-01-26T10:30:00Z",
    "userId": "user-123",
    "source": "whatsapp",
    "payload": { ... }
  },
  "webhook": {
    "id": "wh-uuid",
    "name": "My Connection Monitor"
  }
}
```

### Verifying Webhook Signatures

If you provided a secret, verify the `X-Hook-Signature` header:

```javascript
const crypto = require('crypto')

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(JSON.stringify(payload))
  const expected = `sha256=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}
```

## Adding a New App Adapter

To add support for a new app (e.g., Telegram):

### 1. Create the Adapter

```typescript
// packages/server/src/services/apps/telegram/telegram-adapter.ts

import type { AppAdapter, HealthCheckResult } from '../types.js'

export class TelegramAdapter implements AppAdapter {
  readonly appType = 'telegram'
  readonly displayName = 'Telegram'
  readonly description = 'Connect your Telegram account'

  async connect(userId: string, options?: Record<string, unknown>): Promise<void> {
    // Implement connection logic
  }

  async disconnect(userId: string): Promise<void> {
    // Implement disconnection logic
  }

  async healthCheck(userId: string): Promise<HealthCheckResult> {
    // Implement health check logic
    return { healthy: true, status: 'healthy' }
  }

  isConnected(userId: string): boolean {
    // Check connection status
  }

  getConnectionInfo(userId: string): Record<string, unknown> | null {
    // Return connection details
  }
}

export const telegramAdapter = new TelegramAdapter()
```

### 2. Register the Adapter

```typescript
// packages/server/src/index.ts

import { telegramAdapter } from './services/apps/telegram/telegram-adapter.js'

// In main():
connectionManager.registerAdapter(telegramAdapter)
```

### 3. Add Frontend Component

Create a settings component similar to `WhatsAppSettings.tsx`.

## Testing

### Unit Tests

```bash
cd packages/server
npx tsx src/services/apps/__tests__/connection-manager.test.ts
```

### Manual Testing

1. Connect WhatsApp via Settings
2. Verify health status shows "healthy"
3. Put phone in airplane mode
4. Wait for warning to appear
5. Reconnect and verify warning clears
