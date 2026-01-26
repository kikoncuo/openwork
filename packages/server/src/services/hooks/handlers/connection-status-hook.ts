/**
 * Connection Status Hook Handler
 * Broadcasts connection status changes via WebSocket to the frontend
 */

import type { HookHandler, HookResult, HookEvent } from '../hook-manager.js'
import { broadcastToUser } from '../../../websocket/index.js'

/**
 * Connection Status WebSocket Handler
 * Broadcasts app connection events to the user's connected WebSocket clients
 */
export const connectionStatusHandler: HookHandler = {
  id: 'builtin:connection-status',
  name: 'Connection Status WebSocket Broadcaster',
  eventTypes: [
    'app:connecting',
    'app:connected',
    'app:disconnected',
    'app:health_warning',
    'app:health_cleared',
    'app:health_check'
  ],
  enabled: true,
  priority: 50, // Run early to ensure real-time updates

  async handler(event: HookEvent): Promise<HookResult> {
    try {
      const { userId, type, payload } = event

      // Construct WebSocket event data
      const wsEventData = {
        appType: payload.appType || event.source,
        eventType: type,
        status: payload.status,
        healthStatus: payload.healthStatus,
        warningMessage: payload.warningMessage || payload.warning,
        recommendation: payload.recommendation,
        details: payload.details,
        timestamp: event.timestamp.toISOString()
      }

      // Broadcast to all of user's connected sockets
      broadcastToUser(userId, 'connection:status', wsEventData)

      return { success: true }
    } catch (error) {
      console.error('[ConnectionStatusHook] Error broadcasting:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to broadcast connection status'
      }
    }
  }
}
