/**
 * Hooks REST API Routes
 * Provides endpoints for managing hooks, webhooks, and event logs
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  hookManager,
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type HookEventType
} from '../services/hooks/index.js'

const router = Router()

// ============================================
// Hook Handlers Management
// ============================================

/**
 * GET /api/hooks
 * List all registered hook handlers
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const handlers = hookManager.getHandlers()

    // Transform handlers to API response format
    const response = handlers.map(h => ({
      id: h.id,
      name: h.name,
      eventTypes: h.eventTypes,
      enabled: h.enabled,
      priority: h.priority ?? 100,
      isBuiltin: h.id.startsWith('builtin:'),
      isWebhook: h.id.startsWith('webhook:')
    }))

    res.json(response)
  } catch (error) {
    console.error('[Hooks API] Error listing handlers:', error)
    res.status(500).json({ error: 'Failed to list handlers' })
  }
})

/**
 * PATCH /api/hooks/:id
 * Enable or disable a handler
 */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { enabled } = req.body

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' })
    }

    const handler = hookManager.getHandler(id)
    if (!handler) {
      return res.status(404).json({ error: 'Handler not found' })
    }

    hookManager.setHandlerEnabled(id, enabled)

    res.json({
      id: handler.id,
      name: handler.name,
      enabled
    })
  } catch (error) {
    console.error('[Hooks API] Error updating handler:', error)
    res.status(500).json({ error: 'Failed to update handler' })
  }
})

// ============================================
// Event Log
// ============================================

/**
 * GET /api/hooks/events
 * Get recent events from the log
 */
router.get('/events', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const limitParam = req.query.limit
    const limit = limitParam ? parseInt(String(limitParam), 10) : 100

    const eventTypeParam = req.query.eventType as string | undefined
    const sourceParam = req.query.source as string | undefined

    const events = hookManager.getEventLog({
      userId,
      eventType: eventTypeParam as HookEventType | undefined,
      source: sourceParam,
      limit
    })

    // Transform events for API response
    const response = events.map(e => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp.toISOString(),
      source: e.source,
      payload: e.payload
    }))

    res.json(response)
  } catch (error) {
    console.error('[Hooks API] Error getting events:', error)
    res.status(500).json({ error: 'Failed to get events' })
  }
})

/**
 * DELETE /api/hooks/events
 * Clear the event log
 */
router.delete('/events', requireAuth, async (req, res) => {
  try {
    hookManager.clearEventLog()
    res.json({ success: true })
  } catch (error) {
    console.error('[Hooks API] Error clearing events:', error)
    res.status(500).json({ error: 'Failed to clear events' })
  }
})

/**
 * POST /api/hooks/test
 * Send a test event (for debugging)
 */
router.post('/test', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { eventType, source, payload } = req.body

    if (!eventType) {
      return res.status(400).json({ error: 'eventType is required' })
    }

    await hookManager.emit({
      type: eventType as HookEventType,
      userId,
      source: source || 'test',
      payload: payload || {}
    })

    res.json({ success: true, message: 'Test event emitted' })
  } catch (error) {
    console.error('[Hooks API] Error sending test event:', error)
    res.status(500).json({ error: 'Failed to send test event' })
  }
})

// ============================================
// Webhook Management
// ============================================

/**
 * GET /api/hooks/webhooks
 * List all webhooks for the current user
 */
router.get('/webhooks', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const webhooks = getWebhooks(userId)

    // Transform for API response (omit secret)
    const response = webhooks.map(w => ({
      id: w.id,
      name: w.name,
      url: w.url,
      hasSecret: !!w.secret,
      eventTypes: w.eventTypes,
      enabled: w.enabled,
      retryCount: w.retryCount,
      timeoutMs: w.timeoutMs,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString()
    }))

    res.json(response)
  } catch (error) {
    console.error('[Hooks API] Error listing webhooks:', error)
    res.status(500).json({ error: 'Failed to list webhooks' })
  }
})

/**
 * GET /api/hooks/webhooks/:id
 * Get a specific webhook
 */
router.get('/webhooks/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const webhook = getWebhook(userId, id)
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    res.json({
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      hasSecret: !!webhook.secret,
      eventTypes: webhook.eventTypes,
      enabled: webhook.enabled,
      retryCount: webhook.retryCount,
      timeoutMs: webhook.timeoutMs,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString()
    })
  } catch (error) {
    console.error('[Hooks API] Error getting webhook:', error)
    res.status(500).json({ error: 'Failed to get webhook' })
  }
})

/**
 * POST /api/hooks/webhooks
 * Create a new webhook
 */
router.post('/webhooks', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { name, url, secret, eventTypes, enabled, retryCount, timeoutMs } = req.body

    // Validate required fields
    if (!name || !url || !eventTypes) {
      return res.status(400).json({ error: 'name, url, and eventTypes are required' })
    }

    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      return res.status(400).json({ error: 'eventTypes must be a non-empty array' })
    }

    // Validate URL
    try {
      new URL(url)
    } catch {
      return res.status(400).json({ error: 'Invalid URL' })
    }

    const webhook = createWebhook({
      userId,
      name,
      url,
      secret,
      eventTypes: eventTypes as HookEventType[],
      enabled: enabled !== false,  // Default to true
      retryCount: retryCount ?? 3,
      timeoutMs: timeoutMs ?? 5000
    })

    res.status(201).json({
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      hasSecret: !!webhook.secret,
      eventTypes: webhook.eventTypes,
      enabled: webhook.enabled,
      retryCount: webhook.retryCount,
      timeoutMs: webhook.timeoutMs,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString()
    })
  } catch (error) {
    console.error('[Hooks API] Error creating webhook:', error)
    res.status(500).json({ error: 'Failed to create webhook' })
  }
})

/**
 * PATCH /api/hooks/webhooks/:id
 * Update a webhook
 */
router.patch('/webhooks/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params
    const { name, url, secret, eventTypes, enabled, retryCount, timeoutMs } = req.body

    // Validate URL if provided
    if (url) {
      try {
        new URL(url)
      } catch {
        return res.status(400).json({ error: 'Invalid URL' })
      }
    }

    // Validate eventTypes if provided
    if (eventTypes !== undefined) {
      if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
        return res.status(400).json({ error: 'eventTypes must be a non-empty array' })
      }
    }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (url !== undefined) updates.url = url
    if (secret !== undefined) updates.secret = secret
    if (eventTypes !== undefined) updates.eventTypes = eventTypes
    if (enabled !== undefined) updates.enabled = enabled
    if (retryCount !== undefined) updates.retryCount = retryCount
    if (timeoutMs !== undefined) updates.timeoutMs = timeoutMs

    const webhook = updateWebhook(userId, id, updates)
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    res.json({
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      hasSecret: !!webhook.secret,
      eventTypes: webhook.eventTypes,
      enabled: webhook.enabled,
      retryCount: webhook.retryCount,
      timeoutMs: webhook.timeoutMs,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString()
    })
  } catch (error) {
    console.error('[Hooks API] Error updating webhook:', error)
    res.status(500).json({ error: 'Failed to update webhook' })
  }
})

/**
 * DELETE /api/hooks/webhooks/:id
 * Delete a webhook
 */
router.delete('/webhooks/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const deleted = deleteWebhook(userId, id)
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Hooks API] Error deleting webhook:', error)
    res.status(500).json({ error: 'Failed to delete webhook' })
  }
})

export default router
