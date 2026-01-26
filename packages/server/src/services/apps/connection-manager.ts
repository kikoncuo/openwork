/**
 * AppConnectionManager - Unified app connection management with health monitoring
 *
 * This manager provides a unified interface for:
 * - Registering app adapters (WhatsApp, Google Workspace, etc.)
 * - Managing connection lifecycle
 * - Health monitoring with periodic checks
 * - Emitting events through the hook system
 */

import { v4 as uuidv4 } from 'uuid'
import { hookManager } from '../hooks/hook-manager.js'
import { getDb, saveToDisk } from '../db/index.js'
import type {
  AppType,
  AppAdapter,
  AppConnection,
  HealthCheckResult,
  HealthStatus,
  ConnectionStatus,
  AppHealthEvent
} from './types.js'

// Default health check interval (5 minutes)
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000

class AppConnectionManager {
  private adapters: Map<AppType, AppAdapter> = new Map()
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Register an app adapter
   */
  registerAdapter(adapter: AppAdapter): void {
    if (this.adapters.has(adapter.appType)) {
      console.warn(`[ConnectionManager] Adapter for ${adapter.appType} already registered, replacing`)
    }
    this.adapters.set(adapter.appType, adapter)
    console.log(`[ConnectionManager] Registered adapter: ${adapter.displayName} (${adapter.appType})`)
  }

  /**
   * Get a registered adapter
   */
  getAdapter(appType: AppType): AppAdapter | undefined {
    return this.adapters.get(appType)
  }

  /**
   * Get all registered app types
   */
  getRegisteredApps(): { appType: AppType; displayName: string; description: string }[] {
    return Array.from(this.adapters.values()).map(adapter => ({
      appType: adapter.appType,
      displayName: adapter.displayName,
      description: adapter.description
    }))
  }

  /**
   * Connect an app for a user
   */
  async connect(
    userId: string,
    appType: AppType,
    options?: Record<string, unknown>
  ): Promise<void> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      throw new Error(`No adapter registered for app type: ${appType}`)
    }

    // Update status to connecting
    await this.updateConnectionStatus(userId, appType, 'connecting', 'unknown')

    // Emit connecting event
    await this.emitConnectionEvent('app:connecting', userId, appType, {
      status: 'connecting'
    })

    try {
      // Delegate to adapter
      await adapter.connect(userId, options)

      // Update status to connected
      await this.updateConnectionStatus(userId, appType, 'connected', 'unknown')

      // Emit connected event
      await this.emitConnectionEvent('app:connected', userId, appType, {
        status: 'connected'
      })

      // Start health monitoring
      this.startHealthMonitoring(userId, appType)

      // Perform initial health check
      await this.performHealthCheck(userId, appType)
    } catch (error) {
      // Update status to disconnected on failure
      await this.updateConnectionStatus(userId, appType, 'disconnected', 'critical',
        error instanceof Error ? error.message : 'Connection failed')

      throw error
    }
  }

  /**
   * Disconnect an app for a user
   */
  async disconnect(userId: string, appType: AppType): Promise<void> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      throw new Error(`No adapter registered for app type: ${appType}`)
    }

    // Stop health monitoring
    this.stopHealthMonitoring(userId, appType)

    try {
      // Delegate to adapter
      await adapter.disconnect(userId)
    } finally {
      // Update status to disconnected
      await this.updateConnectionStatus(userId, appType, 'disconnected', 'unknown')

      // Emit disconnected event
      await this.emitConnectionEvent('app:disconnected', userId, appType, {
        status: 'disconnected'
      })
    }
  }

  /**
   * Perform health check for an app
   */
  async performHealthCheck(userId: string, appType: AppType): Promise<HealthCheckResult> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      return { healthy: false, status: 'critical', warningMessage: 'No adapter registered' }
    }

    // Check if connected first
    if (!adapter.isConnected(userId)) {
      return { healthy: false, status: 'critical', warningMessage: 'Not connected' }
    }

    try {
      const result = await adapter.healthCheck(userId)

      // Get current connection to check previous health status
      const currentConnection = await this.getConnection(userId, appType)
      const previousHealthStatus = currentConnection?.healthStatus

      // Update connection with health status
      await this.updateConnectionStatus(
        userId,
        appType,
        result.healthy ? 'connected' : 'degraded',
        result.status,
        result.warningMessage
      )

      // Log health event
      await this.logHealthEvent(userId, appType, 'health_check', {
        healthy: result.healthy,
        status: result.status,
        warningMessage: result.warningMessage
      })

      // Emit health warning if status changed to warning/critical
      if (result.status === 'warning' || result.status === 'critical') {
        if (previousHealthStatus === 'healthy' || previousHealthStatus === 'unknown') {
          await this.emitConnectionEvent('app:health_warning', userId, appType, {
            status: 'degraded',
            healthStatus: result.status,
            warningMessage: result.warningMessage
          })
        }
      }

      // Emit health cleared if status improved
      if (result.status === 'healthy' &&
          (previousHealthStatus === 'warning' || previousHealthStatus === 'critical')) {
        await this.emitConnectionEvent('app:health_cleared', userId, appType, {
          status: 'connected',
          healthStatus: 'healthy'
        })
      }

      // Emit health check event
      await this.emitConnectionEvent('app:health_check', userId, appType, {
        healthStatus: result.status,
        warningMessage: result.warningMessage,
        details: result.details
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Health check failed'
      await this.updateConnectionStatus(userId, appType, 'degraded', 'critical', errorMessage)
      return { healthy: false, status: 'critical', warningMessage: errorMessage }
    }
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring(
    userId: string,
    appType: AppType,
    intervalMs: number = DEFAULT_HEALTH_CHECK_INTERVAL_MS
  ): void {
    const key = `${userId}:${appType}`

    // Clear existing interval if any
    this.stopHealthMonitoring(userId, appType)

    const interval = setInterval(async () => {
      try {
        await this.performHealthCheck(userId, appType)
      } catch (error) {
        console.error(`[ConnectionManager] Health check error for ${appType}:`, error)
      }
    }, intervalMs)

    this.healthCheckIntervals.set(key, interval)
    console.log(`[ConnectionManager] Started health monitoring for ${userId}:${appType}`)
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(userId: string, appType: AppType): void {
    const key = `${userId}:${appType}`
    const interval = this.healthCheckIntervals.get(key)
    if (interval) {
      clearInterval(interval)
      this.healthCheckIntervals.delete(key)
      console.log(`[ConnectionManager] Stopped health monitoring for ${userId}:${appType}`)
    }
  }

  /**
   * Record successful activity (message sent/received)
   */
  async recordActivity(userId: string, appType: AppType): Promise<void> {
    const db = getDb()
    const now = new Date().toISOString()

    db.run(
      `UPDATE app_connections
       SET last_successful_activity_at = ?, updated_at = ?
       WHERE user_id = ? AND app_type = ?`,
      [now, now, userId, appType]
    )
    saveToDisk()
  }

  /**
   * Get connection status for a user and app
   */
  async getConnection(userId: string, appType: AppType): Promise<AppConnection | null> {
    const db = getDb()
    const stmt = db.prepare(
      'SELECT * FROM app_connections WHERE user_id = ? AND app_type = ?'
    )
    stmt.bind([userId, appType])

    if (!stmt.step()) {
      stmt.free()
      return null
    }

    const row = stmt.getAsObject() as Record<string, unknown>
    stmt.free()

    return this.rowToConnection(row)
  }

  /**
   * Get all connections for a user
   */
  async getAllConnections(userId: string): Promise<AppConnection[]> {
    const db = getDb()
    const stmt = db.prepare('SELECT * FROM app_connections WHERE user_id = ?')
    stmt.bind([userId])

    const connections: AppConnection[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>
      connections.push(this.rowToConnection(row))
    }
    stmt.free()

    return connections
  }

  /**
   * Get health events for a connection
   */
  async getHealthEvents(
    userId: string,
    appType: AppType,
    limit: number = 50
  ): Promise<AppHealthEvent[]> {
    const connection = await this.getConnection(userId, appType)
    if (!connection) return []

    const db = getDb()
    const stmt = db.prepare(
      `SELECT * FROM app_health_events
       WHERE connection_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    stmt.bind([connection.id, limit])

    const events: AppHealthEvent[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>
      events.push({
        id: row.id as string,
        connectionId: row.connection_id as string,
        eventType: row.event_type as AppHealthEvent['eventType'],
        details: row.details ? JSON.parse(row.details as string) : undefined,
        createdAt: new Date(row.created_at as string)
      })
    }
    stmt.free()

    return events
  }

  /**
   * Update connection status in database
   */
  private async updateConnectionStatus(
    userId: string,
    appType: AppType,
    status: ConnectionStatus,
    healthStatus: HealthStatus,
    warningMessage?: string
  ): Promise<void> {
    const db = getDb()
    const now = new Date().toISOString()

    // Check if connection exists
    const existing = await this.getConnection(userId, appType)

    if (existing) {
      db.run(
        `UPDATE app_connections
         SET status = ?, health_status = ?, warning_message = ?,
             last_health_check_at = ?, updated_at = ?
         WHERE user_id = ? AND app_type = ?`,
        [status, healthStatus, warningMessage || null, now, now, userId, appType]
      )
    } else {
      const id = uuidv4()
      db.run(
        `INSERT INTO app_connections
         (id, user_id, app_type, status, health_status, warning_message,
          last_health_check_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, appType, status, healthStatus, warningMessage || null, now, now, now]
      )
    }

    saveToDisk()
  }

  /**
   * Log a health event
   */
  private async logHealthEvent(
    userId: string,
    appType: AppType,
    eventType: AppHealthEvent['eventType'],
    details?: Record<string, unknown>
  ): Promise<void> {
    const connection = await this.getConnection(userId, appType)
    if (!connection) return

    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()

    db.run(
      `INSERT INTO app_health_events (id, connection_id, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, connection.id, eventType, details ? JSON.stringify(details) : null, now]
    )

    saveToDisk()
  }

  /**
   * Emit connection event through hook system
   */
  private async emitConnectionEvent(
    eventType: 'app:connecting' | 'app:connected' | 'app:disconnected' |
               'app:health_warning' | 'app:health_cleared' | 'app:health_check',
    userId: string,
    appType: AppType,
    payload: Record<string, unknown>
  ): Promise<void> {
    await hookManager.emit({
      type: eventType,
      userId,
      source: appType,
      payload: {
        appType,
        ...payload
      }
    })
  }

  /**
   * Convert database row to AppConnection
   */
  private rowToConnection(row: Record<string, unknown>): AppConnection {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      appType: row.app_type as AppType,
      status: row.status as ConnectionStatus,
      healthStatus: row.health_status as HealthStatus,
      warningMessage: row.warning_message as string | undefined,
      lastHealthCheckAt: row.last_health_check_at
        ? new Date(row.last_health_check_at as string)
        : undefined,
      lastSuccessfulActivityAt: row.last_successful_activity_at
        ? new Date(row.last_successful_activity_at as string)
        : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string)
    }
  }

  /**
   * Initialize connections from database (called on startup)
   * Restarts health monitoring for connected apps
   */
  async initializeFromDatabase(): Promise<void> {
    const db = getDb()
    const stmt = db.prepare(
      "SELECT DISTINCT user_id, app_type FROM app_connections WHERE status = 'connected'"
    )

    while (stmt.step()) {
      const row = stmt.getAsObject() as { user_id: string; app_type: string }
      const adapter = this.adapters.get(row.app_type)

      if (adapter && adapter.isConnected(row.user_id)) {
        console.log(`[ConnectionManager] Resuming health monitoring for ${row.user_id}:${row.app_type}`)
        this.startHealthMonitoring(row.user_id, row.app_type)
      }
    }
    stmt.free()
  }
}

// Singleton instance
export const connectionManager = new AppConnectionManager()
