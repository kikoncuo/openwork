/**
 * WhatsApp Adapter - Implements AppAdapter interface for WhatsApp
 * Wraps the existing socket-manager functionality
 */

import type { AppAdapter, HealthCheckResult, HealthStatus } from '../types.js'
import { socketManager } from './socket-manager.js'
import { connectionManager } from '../connection-manager.js'

// Health check thresholds
const ACTIVITY_WARNING_THRESHOLD_MS = 30 * 60 * 1000  // 30 minutes no activity
const ACTIVITY_CRITICAL_THRESHOLD_MS = 2 * 60 * 60 * 1000  // 2 hours no activity

export class WhatsAppAdapter implements AppAdapter {
  readonly appType = 'whatsapp' as const
  readonly displayName = 'WhatsApp'
  readonly description = 'Connect your WhatsApp account to send and receive messages via AI agents'

  /**
   * Connect to WhatsApp
   * This will trigger QR code generation if no stored credentials
   */
  async connect(userId: string): Promise<void> {
    await socketManager.connect(userId, false, false)
  }

  /**
   * Disconnect from WhatsApp and clear auth state
   */
  async disconnect(userId: string): Promise<void> {
    await socketManager.disconnect(userId)
  }

  /**
   * Perform health check
   * Checks multiple indicators:
   * - Socket connection state
   * - Phone online status (from Baileys events)
   * - Last message activity timestamp
   */
  async healthCheck(userId: string): Promise<HealthCheckResult> {
    // First check if socket is connected
    if (!this.isConnected(userId)) {
      return {
        healthy: false,
        status: 'critical',
        warningMessage: 'Not connected to WhatsApp'
      }
    }

    const healthIndicators: string[] = []
    let overallStatus: HealthStatus = 'healthy'

    // Check phone online status (if tracked)
    const phoneOnline = socketManager.isPhoneOnline?.(userId)
    if (phoneOnline === false) {
      healthIndicators.push('Phone appears offline')
      overallStatus = this.degradeStatus(overallStatus, 'warning')
    }

    // Check last activity time
    const lastActivity = socketManager.getLastActivityTime?.(userId)
    if (lastActivity) {
      const timeSinceActivity = Date.now() - lastActivity

      if (timeSinceActivity > ACTIVITY_CRITICAL_THRESHOLD_MS) {
        healthIndicators.push('No activity for over 2 hours')
        overallStatus = this.degradeStatus(overallStatus, 'critical')
      } else if (timeSinceActivity > ACTIVITY_WARNING_THRESHOLD_MS) {
        healthIndicators.push('No recent activity')
        overallStatus = this.degradeStatus(overallStatus, 'warning')
      }
    }

    // Check connection status from socket manager
    const status = socketManager.getConnectionStatus(userId)
    if (status.connecting) {
      healthIndicators.push('Connection in progress')
      overallStatus = this.degradeStatus(overallStatus, 'warning')
    }

    const healthy = overallStatus === 'healthy'
    const warningMessage = healthIndicators.length > 0
      ? healthIndicators.join('. ')
      : undefined

    return {
      healthy,
      status: overallStatus,
      warningMessage,
      details: {
        phoneOnline,
        lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
        connectionStatus: status
      }
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(userId: string): boolean {
    return socketManager.isConnected(userId)
  }

  /**
   * Get connection info (phone number, profile, etc.)
   */
  getConnectionInfo(userId: string): Record<string, unknown> | null {
    const status = socketManager.getConnectionStatus(userId)

    if (!status.connected) {
      return null
    }

    return {
      phoneNumber: status.phoneNumber,
      connectedAt: status.connectedAt instanceof Date
        ? status.connectedAt.toISOString()
        : status.connectedAt
    }
  }

  /**
   * Helper to degrade health status
   */
  private degradeStatus(current: HealthStatus, target: HealthStatus): HealthStatus {
    const statusOrder: HealthStatus[] = ['healthy', 'unknown', 'warning', 'critical']
    const currentIndex = statusOrder.indexOf(current)
    const targetIndex = statusOrder.indexOf(target)
    return targetIndex > currentIndex ? target : current
  }
}

// Singleton instance
export const whatsAppAdapter = new WhatsAppAdapter()

/**
 * Register the WhatsApp adapter with the connection manager
 * Called during app initialization
 */
export function registerWhatsAppAdapter(): void {
  connectionManager.registerAdapter(whatsAppAdapter)
}
