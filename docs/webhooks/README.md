# Webhook Integration Guide

This guide explains how to receive real-time notifications from OpenWork via webhooks.

## Overview

Webhooks allow external systems to receive HTTP callbacks when events occur in OpenWork. This is useful for:
- Monitoring app connection health
- Building custom notification systems
- Integrating with automation platforms (n8n, Zapier, Make)
- Syncing state with external databases

## Creating a Webhook

### Via API

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

### Response

```json
{
  "id": "wh-uuid-123",
  "name": "My Connection Monitor",
  "url": "https://my-server.com/webhook",
  "eventTypes": ["app:health_warning", "app:health_cleared"],
  "enabled": true,
  "createdAt": "2024-01-26T10:00:00Z"
}
```

## Event Types

### App Connection Events

| Event | Description |
|-------|-------------|
| `app:connecting` | Connection attempt started |
| `app:connected` | Successfully connected to app |
| `app:disconnected` | Disconnected from app |
| `app:health_warning` | Connection health degraded |
| `app:health_cleared` | Connection health restored |
| `app:health_check` | Periodic health check completed |

### Message Events

| Event | Description |
|-------|-------------|
| `message:received` | New message received |
| `message:sending` | Message about to be sent |
| `message:sent` | Message successfully sent |

### Agent Events

| Event | Description |
|-------|-------------|
| `agent:invoked` | Agent started processing |
| `agent:response` | Agent generated response |
| `agent:error` | Agent encountered error |

## Webhook Payload Format

All webhook deliveries follow this structure:

```json
{
  "event": {
    "id": "evt-uuid-456",
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
  },
  "webhook": {
    "id": "wh-uuid-123",
    "name": "My Connection Monitor"
  }
}
```

## Event Payload Details

### app:health_warning

```json
{
  "appType": "whatsapp",
  "status": "degraded",
  "healthStatus": "warning",
  "warningMessage": "Phone appears offline",
  "recommendation": "Check your phone connection"
}
```

### app:health_cleared

```json
{
  "appType": "whatsapp",
  "status": "connected",
  "healthStatus": "healthy",
  "previousWarning": "Phone appears offline"
}
```

### app:connected

```json
{
  "appType": "whatsapp",
  "status": "connected",
  "metadata": {
    "phoneNumber": "+1234567890"
  }
}
```

### app:disconnected

```json
{
  "appType": "whatsapp",
  "status": "disconnected",
  "reason": "user_initiated"
}
```

## Verifying Webhook Signatures

If you provide a `secret` when creating a webhook, each delivery includes an `X-Hook-Signature` header containing an HMAC-SHA256 signature.

### Verification Example (Node.js)

```javascript
const crypto = require('crypto')

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(JSON.stringify(payload))
  const expected = `sha256=${hmac.digest('hex')}`

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

// Express middleware example
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-hook-signature']
  const isValid = verifyWebhookSignature(req.body, signature, process.env.WEBHOOK_SECRET)

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // Process the event
  const { event } = req.body
  console.log(`Received ${event.type} from ${event.source}`)

  res.status(200).json({ received: true })
})
```

### Verification Example (Python)

```python
import hmac
import hashlib
import json

def verify_webhook_signature(payload: dict, signature: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        json.dumps(payload).encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected)
```

## Retry Behavior

Failed webhook deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the webhook is marked as failing and the event is dropped.

## Managing Webhooks

### List Webhooks

```http
GET /api/hooks/webhooks
Authorization: Bearer <token>
```

### Get Webhook Details

```http
GET /api/hooks/webhooks/:id
Authorization: Bearer <token>
```

### Update Webhook

```http
PATCH /api/hooks/webhooks/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "eventTypes": ["app:health_warning"],
  "enabled": false
}
```

### Delete Webhook

```http
DELETE /api/hooks/webhooks/:id
Authorization: Bearer <token>
```

## Example Integrations

### n8n Workflow

1. Create a **Webhook** node in n8n
2. Copy the webhook URL
3. Create a webhook in OpenWork pointing to that URL
4. Process events in your n8n workflow

### Zapier Integration

1. Create a new Zap with **Webhooks by Zapier** trigger
2. Choose "Catch Hook"
3. Copy the webhook URL
4. Create a webhook in OpenWork
5. Add actions to handle events (Slack, Email, etc.)

### Slack Notifications

```javascript
// Example: Send Slack message on health warning
app.post('/webhook', async (req, res) => {
  const { event } = req.body

  if (event.type === 'app:health_warning') {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Warning: ${event.payload.warningMessage}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${event.source} Connection Warning*\n${event.payload.warningMessage}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Recommendation: ${event.payload.recommendation || 'Check your connection'}`
              }
            ]
          }
        ]
      })
    })
  }

  res.status(200).json({ received: true })
})
```

### Custom Monitoring Dashboard

```javascript
// Store events in database for dashboard
app.post('/webhook', async (req, res) => {
  const { event, webhook } = req.body

  await db.healthEvents.insert({
    eventId: event.id,
    eventType: event.type,
    source: event.source,
    payload: event.payload,
    receivedAt: new Date()
  })

  // Emit to WebSocket for real-time dashboard
  io.emit('health-event', event)

  res.status(200).json({ received: true })
})
```

## Best Practices

1. **Always verify signatures** - Prevent unauthorized webhook calls
2. **Respond quickly** - Return 200 within 5 seconds, process asynchronously
3. **Handle duplicates** - Use `event.id` for idempotency
4. **Log all events** - Helpful for debugging
5. **Monitor failures** - Set up alerts for webhook delivery failures

## Troubleshooting

### Webhook Not Receiving Events

1. Verify the webhook URL is publicly accessible
2. Check the webhook is enabled
3. Confirm the event types match what you subscribed to
4. Check your server logs for incoming requests

### Invalid Signature Errors

1. Ensure you're using the exact secret from webhook creation
2. Verify you're hashing the raw JSON body
3. Check for encoding issues (UTF-8)

### Missing Events

1. Check the webhook delivery logs via API
2. Verify your event type subscriptions
3. Ensure the webhook wasn't disabled due to failures

## Rate Limits

- Maximum 10 webhooks per user
- Maximum 100 events per minute per webhook
- Payload size limit: 256KB

## Security Recommendations

1. Use HTTPS endpoints only
2. Rotate secrets periodically
3. Validate event timestamps (reject events older than 5 minutes)
4. Implement IP allowlisting if possible
5. Monitor for unusual event patterns
