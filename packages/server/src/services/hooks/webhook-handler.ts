import crypto from 'crypto'
import { getDb, saveToDisk } from '../db/index.js'
import { HookEventType, HookHandler, HookEvent, HookResult, hookManager } from './hook-manager.js'

export interface WebhookConfig {
  id: string
  userId: string
  name: string
  url: string
  secret?: string  // For HMAC signing
  eventTypes: HookEventType[]
  enabled: boolean
  retryCount: number
  timeoutMs: number
  createdAt: Date
  updatedAt: Date
}

interface WebhookRow {
  id: string
  user_id: string
  name: string
  url: string
  secret: string | null
  event_types: string  // JSON array
  enabled: number
  retry_count: number
  timeout_ms: number
  created_at: string
  updated_at: string
}

/**
 * Create HMAC signature for webhook payload
 */
function createSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Send webhook with retry logic
 */
async function sendWebhook(
  config: WebhookConfig,
  event: HookEvent,
  attempt: number = 1
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const payload = JSON.stringify({
    event: {
      id: event.id,
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      userId: event.userId,
      source: event.source,
      payload: event.payload
    }
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': event.type,
    'X-Webhook-Id': event.id,
    'X-Webhook-Timestamp': event.timestamp.toISOString()
  }

  // Add HMAC signature if secret is configured
  if (config.secret) {
    headers['X-Webhook-Signature'] = `sha256=${createSignature(payload, config.secret)}`
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs)

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      console.log(`[Webhook] ${config.name}: Delivered ${event.type} to ${config.url}`)
      return { success: true, statusCode: response.status }
    }

    // Non-2xx response
    const errorText = await response.text().catch(() => 'Unknown error')
    console.warn(`[Webhook] ${config.name}: Failed with status ${response.status}: ${errorText}`)

    // Retry on 5xx errors
    if (response.status >= 500 && attempt < config.retryCount) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      console.log(`[Webhook] ${config.name}: Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${config.retryCount})`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
      return sendWebhook(config, event, attempt + 1)
    }

    return { success: false, statusCode: response.status, error: errorText }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage === 'This operation was aborted') {
      console.warn(`[Webhook] ${config.name}: Timeout after ${config.timeoutMs}ms`)
    } else {
      console.error(`[Webhook] ${config.name}: Error:`, errorMessage)
    }

    // Retry on network errors
    if (attempt < config.retryCount) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      console.log(`[Webhook] ${config.name}: Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${config.retryCount})`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
      return sendWebhook(config, event, attempt + 1)
    }

    return { success: false, error: errorMessage }
  }
}

/**
 * Create a hook handler from a webhook config
 */
export function createWebhookHandler(config: WebhookConfig): HookHandler {
  return {
    id: `webhook:${config.id}`,
    name: `Webhook: ${config.name}`,
    eventTypes: config.eventTypes,
    enabled: config.enabled,
    priority: 500,  // Webhooks run after internal handlers
    handler: async (event: HookEvent): Promise<HookResult> => {
      // Only process events for this user's webhooks
      if (event.userId !== config.userId) {
        return { success: true }
      }

      const result = await sendWebhook(config, event)
      return {
        success: result.success,
        error: result.error
      }
    }
  }
}

// ========== Database Operations ==========

/**
 * Get all webhooks for a user
 */
export function getWebhooks(userId: string): WebhookConfig[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM webhooks WHERE user_id = ?')
  stmt.bind([userId])

  const webhooks: WebhookConfig[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as WebhookRow
    webhooks.push(rowToConfig(row))
  }
  stmt.free()

  return webhooks
}

/**
 * Get a specific webhook by ID
 */
export function getWebhook(userId: string, webhookId: string): WebhookConfig | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?')
  stmt.bind([webhookId, userId])

  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as WebhookRow
    stmt.free()
    return rowToConfig(row)
  }

  stmt.free()
  return null
}

/**
 * Create a new webhook
 */
export function createWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): WebhookConfig {
  const db = getDb()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  db.run(`
    INSERT INTO webhooks (id, user_id, name, url, secret, event_types, enabled, retry_count, timeout_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    config.userId,
    config.name,
    config.url,
    config.secret || null,
    JSON.stringify(config.eventTypes),
    config.enabled ? 1 : 0,
    config.retryCount,
    config.timeoutMs,
    now,
    now
  ])

  saveToDisk()

  const webhook: WebhookConfig = {
    ...config,
    id,
    createdAt: new Date(now),
    updatedAt: new Date(now)
  }

  // Register the webhook as a hook handler
  const handler = createWebhookHandler(webhook)
  hookManager.registerHandler(handler)

  console.log(`[Webhook] Created webhook "${config.name}" for user ${config.userId}`)
  return webhook
}

/**
 * Update an existing webhook
 */
export function updateWebhook(
  userId: string,
  webhookId: string,
  updates: Partial<Omit<WebhookConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): WebhookConfig | null {
  const existing = getWebhook(userId, webhookId)
  if (!existing) {
    return null
  }

  const db = getDb()
  const now = new Date().toISOString()

  const updated: WebhookConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date(now)
  }

  db.run(`
    UPDATE webhooks
    SET name = ?, url = ?, secret = ?, event_types = ?, enabled = ?, retry_count = ?, timeout_ms = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `, [
    updated.name,
    updated.url,
    updated.secret || null,
    JSON.stringify(updated.eventTypes),
    updated.enabled ? 1 : 0,
    updated.retryCount,
    updated.timeoutMs,
    now,
    webhookId,
    userId
  ])

  saveToDisk()

  // Re-register the webhook handler with updated config
  hookManager.unregisterHandler(`webhook:${webhookId}`)
  const handler = createWebhookHandler(updated)
  hookManager.registerHandler(handler)

  console.log(`[Webhook] Updated webhook "${updated.name}"`)
  return updated
}

/**
 * Delete a webhook
 */
export function deleteWebhook(userId: string, webhookId: string): boolean {
  const db = getDb()

  const result = db.run('DELETE FROM webhooks WHERE id = ? AND user_id = ?', [webhookId, userId])

  if (result) {
    saveToDisk()
    hookManager.unregisterHandler(`webhook:${webhookId}`)
    console.log(`[Webhook] Deleted webhook ${webhookId}`)
    return true
  }

  return false
}

/**
 * Load all webhooks from database and register as handlers
 */
export function loadWebhooksFromDb(): void {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM webhooks')

  let count = 0
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as WebhookRow
    const config = rowToConfig(row)
    const handler = createWebhookHandler(config)
    hookManager.registerHandler(handler)
    count++
  }

  stmt.free()
  console.log(`[Webhook] Loaded ${count} webhooks from database`)
}

/**
 * Convert database row to WebhookConfig
 */
function rowToConfig(row: WebhookRow): WebhookConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    secret: row.secret || undefined,
    eventTypes: JSON.parse(row.event_types) as HookEventType[],
    enabled: row.enabled === 1,
    retryCount: row.retry_count,
    timeoutMs: row.timeout_ms,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
