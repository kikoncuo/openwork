/**
 * Debug Logger Hook Handler
 * Logs all events for debugging purposes
 */

import { HookHandler, HookEvent, HookResult } from '../hook-manager.js'

// Control debug logging via environment variable
const DEBUG_HOOKS = process.env.DEBUG_HOOKS === 'true' || process.env.NODE_ENV === 'development'

/**
 * Format event payload for logging.
 * Truncates long strings and omits sensitive data.
 */
function formatPayloadForLog(payload: Record<string, unknown>): Record<string, unknown> {
  const formatted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    // Skip sensitive keys
    if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')) {
      formatted[key] = '[REDACTED]'
      continue
    }

    // Truncate long strings
    if (typeof value === 'string' && value.length > 200) {
      formatted[key] = value.substring(0, 200) + '...'
      continue
    }

    // Handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      formatted[key] = formatPayloadForLog(value as Record<string, unknown>)
      continue
    }

    formatted[key] = value
  }

  return formatted
}

/**
 * Debug Hook Handler
 * Logs all events with detailed information
 */
export const debugHookHandler: HookHandler = {
  id: 'builtin:debug',
  name: 'Debug Logger',
  eventTypes: ['*'],  // All events
  enabled: DEBUG_HOOKS,
  priority: 1,  // Run first to log before other handlers
  handler: async (event: HookEvent): Promise<HookResult> => {
    const formattedPayload = formatPayloadForLog(event.payload)

    console.log(`[Hook Debug] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[Hook Debug] Event: ${event.type}`)
    console.log(`[Hook Debug] ID: ${event.id}`)
    console.log(`[Hook Debug] Time: ${event.timestamp.toISOString()}`)
    console.log(`[Hook Debug] User: ${event.userId}`)
    console.log(`[Hook Debug] Source: ${event.source}`)
    console.log(`[Hook Debug] Payload:`, JSON.stringify(formattedPayload, null, 2))
    console.log(`[Hook Debug] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

    return { success: true }
  }
}

/**
 * Enable or disable debug logging at runtime
 */
export function setDebugLoggingEnabled(enabled: boolean): void {
  debugHookHandler.enabled = enabled
  console.log(`[Hook Debug] Debug logging ${enabled ? 'enabled' : 'disabled'}`)
}
