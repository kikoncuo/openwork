/**
 * Hook System Entry Point
 * Exports and initializes all hook-related functionality
 */

// Core exports
export {
  hookManager,
  type HookEventType,
  type HookEvent,
  type HookHandler,
  type HookResult
} from './hook-manager.js'

// Webhook handler exports
export {
  type WebhookConfig,
  createWebhookHandler,
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  loadWebhooksFromDb
} from './webhook-handler.js'

// Built-in handler exports
export { agentHookHandler, isAutoAgentEnabled } from './handlers/agent-hook.js'
export { debugHookHandler, setDebugLoggingEnabled } from './handlers/debug-hook.js'
export { senderHookHandler } from './handlers/sender-hook.js'
export { connectionStatusHandler } from './handlers/connection-status-hook.js'

// ========== Initialization ==========

import { hookManager } from './hook-manager.js'
import { loadWebhooksFromDb } from './webhook-handler.js'
import { agentHookHandler } from './handlers/agent-hook.js'
import { debugHookHandler } from './handlers/debug-hook.js'
import { senderHookHandler } from './handlers/sender-hook.js'
import { connectionStatusHandler } from './handlers/connection-status-hook.js'

let initialized = false

/**
 * Initialize the hook system.
 * Registers all built-in handlers and loads webhooks from the database.
 */
export function initializeHookSystem(): void {
  if (initialized) {
    console.warn('[HookSystem] Already initialized')
    return
  }

  console.log('[HookSystem] Initializing...')

  // Register built-in handlers
  hookManager.registerHandler(debugHookHandler)
  hookManager.registerHandler(agentHookHandler)
  hookManager.registerHandler(senderHookHandler)
  hookManager.registerHandler(connectionStatusHandler)

  // Load webhooks from database
  try {
    loadWebhooksFromDb()
  } catch (error) {
    console.error('[HookSystem] Failed to load webhooks:', error)
  }

  initialized = true
  console.log('[HookSystem] Initialization complete')
}

/**
 * Check if the hook system is initialized.
 */
export function isHookSystemInitialized(): boolean {
  return initialized
}
