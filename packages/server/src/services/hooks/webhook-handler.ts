import crypto from 'crypto'
import { getSupabase } from '../db/supabase-client.js'
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
export async function getWebhooks(userId: string): Promise<WebhookConfig[]> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select('*')
    .eq('user_id', userId)
  if (error || !data) return []
  return data.map((row: unknown) => rowToConfig(row as WebhookRow))
}

/**
 * Get a specific webhook by ID
 */
export async function getWebhook(userId: string, webhookId: string): Promise<WebhookConfig | null> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select('*')
    .eq('id', webhookId)
    .eq('user_id', userId)
    .single()
  if (error || !data) return null
  return rowToConfig(data as unknown as WebhookRow)
}

/**
 * Create a new webhook
 */
export async function createWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookConfig> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const { error } = await getSupabase()
    .from('webhooks')
    .insert({
      id,
      user_id: config.userId,
      name: config.name,
      url: config.url,
      secret: config.secret || null,
      event_types: JSON.stringify(config.eventTypes),
      enabled: config.enabled ? 1 : 0,
      retry_count: config.retryCount,
      timeout_ms: config.timeoutMs,
      created_at: now,
      updated_at: now,
    })
  if (error) throw new Error(`createWebhook: ${error.message}`)

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
export async function updateWebhook(
  userId: string,
  webhookId: string,
  updates: Partial<Omit<WebhookConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<WebhookConfig | null> {
  const existing = await getWebhook(userId, webhookId)
  if (!existing) {
    return null
  }

  const now = new Date().toISOString()

  const updated: WebhookConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date(now)
  }

  const { error } = await getSupabase()
    .from('webhooks')
    .update({
      name: updated.name,
      url: updated.url,
      secret: updated.secret || null,
      event_types: JSON.stringify(updated.eventTypes),
      enabled: updated.enabled ? 1 : 0,
      retry_count: updated.retryCount,
      timeout_ms: updated.timeoutMs,
      updated_at: now,
    })
    .eq('id', webhookId)
    .eq('user_id', userId)
  if (error) throw new Error(`updateWebhook: ${error.message}`)

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
export async function deleteWebhook(userId: string, webhookId: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('webhooks')
    .delete()
    .eq('id', webhookId)
    .eq('user_id', userId)

  if (error) return false

  hookManager.unregisterHandler(`webhook:${webhookId}`)
  console.log(`[Webhook] Deleted webhook ${webhookId}`)
  return true
}

/**
 * Load all webhooks from database and register as handlers
 */
export async function loadWebhooksFromDb(): Promise<void> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select('*')

  if (error || !data) {
    console.log('[Webhook] No webhooks loaded')
    return
  }

  let count = 0
  for (const row of data) {
    const config = rowToConfig(row as unknown as WebhookRow)
    const handler = createWebhookHandler(config)
    hookManager.registerHandler(handler)
    count++
  }

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
