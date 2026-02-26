/**
 * AppConnectionManager - Unified app connection management with health monitoring
 */

import { v4 as uuidv4 } from 'uuid'
import { hookManager } from '../hooks/hook-manager.js'
import { getSupabase } from '../db/supabase-client.js'
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

  registerAdapter(adapter: AppAdapter): void {
    if (this.adapters.has(adapter.appType)) {
      console.warn(`[ConnectionManager] Adapter for ${adapter.appType} already registered, replacing`)
    }
    this.adapters.set(adapter.appType, adapter)
    console.log(`[ConnectionManager] Registered adapter: ${adapter.displayName} (${adapter.appType})`)
  }

  getAdapter(appType: AppType): AppAdapter | undefined {
    return this.adapters.get(appType)
  }

  getRegisteredApps(): { appType: AppType; displayName: string; description: string }[] {
    return Array.from(this.adapters.values()).map(adapter => ({
      appType: adapter.appType,
      displayName: adapter.displayName,
      description: adapter.description
    }))
  }

  async connect(
    userId: string,
    appType: AppType,
    options?: Record<string, unknown>
  ): Promise<void> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      throw new Error(`No adapter registered for app type: ${appType}`)
    }

    await this.updateConnectionStatus(userId, appType, 'connecting', 'unknown')
    await this.emitConnectionEvent('app:connecting', userId, appType, { status: 'connecting' })

    try {
      await adapter.connect(userId, options)
      await this.updateConnectionStatus(userId, appType, 'connected', 'unknown')
      await this.emitConnectionEvent('app:connected', userId, appType, { status: 'connected' })
      this.startHealthMonitoring(userId, appType)
      await this.performHealthCheck(userId, appType)
    } catch (error) {
      await this.updateConnectionStatus(userId, appType, 'disconnected', 'critical',
        error instanceof Error ? error.message : 'Connection failed')
      throw error
    }
  }

  async disconnect(userId: string, appType: AppType): Promise<void> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      throw new Error(`No adapter registered for app type: ${appType}`)
    }

    this.stopHealthMonitoring(userId, appType)

    try {
      await adapter.disconnect(userId)
    } finally {
      await this.updateConnectionStatus(userId, appType, 'disconnected', 'unknown')
      await this.emitConnectionEvent('app:disconnected', userId, appType, { status: 'disconnected' })
    }
  }

  async performHealthCheck(userId: string, appType: AppType): Promise<HealthCheckResult> {
    const adapter = this.adapters.get(appType)
    if (!adapter) {
      return { healthy: false, status: 'critical', warningMessage: 'No adapter registered' }
    }

    if (!adapter.isConnected(userId)) {
      return { healthy: false, status: 'critical', warningMessage: 'Not connected' }
    }

    try {
      const result = await adapter.healthCheck(userId)
      const currentConnection = await this.getConnection(userId, appType)
      const previousHealthStatus = currentConnection?.healthStatus

      await this.updateConnectionStatus(
        userId, appType,
        result.healthy ? 'connected' : 'degraded',
        result.status,
        result.warningMessage
      )

      await this.logHealthEvent(userId, appType, 'health_check', {
        healthy: result.healthy, status: result.status, warningMessage: result.warningMessage
      })

      if (result.status === 'warning' || result.status === 'critical') {
        if (previousHealthStatus === 'healthy' || previousHealthStatus === 'unknown') {
          await this.emitConnectionEvent('app:health_warning', userId, appType, {
            status: 'degraded', healthStatus: result.status, warningMessage: result.warningMessage
          })
        }
      }

      if (result.status === 'healthy' &&
          (previousHealthStatus === 'warning' || previousHealthStatus === 'critical')) {
        await this.emitConnectionEvent('app:health_cleared', userId, appType, {
          status: 'connected', healthStatus: 'healthy'
        })
      }

      await this.emitConnectionEvent('app:health_check', userId, appType, {
        healthStatus: result.status, warningMessage: result.warningMessage, details: result.details
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Health check failed'
      await this.updateConnectionStatus(userId, appType, 'degraded', 'critical', errorMessage)
      return { healthy: false, status: 'critical', warningMessage: errorMessage }
    }
  }

  startHealthMonitoring(
    userId: string,
    appType: AppType,
    intervalMs: number = DEFAULT_HEALTH_CHECK_INTERVAL_MS
  ): void {
    const key = `${userId}:${appType}`
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

  stopHealthMonitoring(userId: string, appType: AppType): void {
    const key = `${userId}:${appType}`
    const interval = this.healthCheckIntervals.get(key)
    if (interval) {
      clearInterval(interval)
      this.healthCheckIntervals.delete(key)
      console.log(`[ConnectionManager] Stopped health monitoring for ${userId}:${appType}`)
    }
  }

  async recordActivity(userId: string, appType: AppType): Promise<void> {
    const now = new Date().toISOString()
    await getSupabase()
      .from('app_connections')
      .update({ last_successful_activity_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('app_type', appType)
  }

  async getConnection(userId: string, appType: AppType): Promise<AppConnection | null> {
    const { data, error } = await getSupabase()
      .from('app_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('app_type', appType)
      .single()
    if (error || !data) return null
    return this.rowToConnection(data as Record<string, unknown>)
  }

  async getAllConnections(userId: string): Promise<AppConnection[]> {
    const { data, error } = await getSupabase()
      .from('app_connections')
      .select('*')
      .eq('user_id', userId)
    if (error || !data) return []
    return data.map((row: unknown) => this.rowToConnection(row as Record<string, unknown>))
  }

  async getHealthEvents(
    userId: string,
    appType: AppType,
    limit: number = 50
  ): Promise<AppHealthEvent[]> {
    const connection = await this.getConnection(userId, appType)
    if (!connection) return []

    const { data, error } = await getSupabase()
      .from('app_health_events')
      .select('*')
      .eq('connection_id', connection.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return data.map((row: any) => ({
      id: row.id,
      connectionId: row.connection_id,
      eventType: row.event_type,
      details: row.details ? JSON.parse(row.details) : undefined,
      createdAt: new Date(row.created_at)
    }))
  }

  private async updateConnectionStatus(
    userId: string,
    appType: AppType,
    status: ConnectionStatus,
    healthStatus: HealthStatus,
    warningMessage?: string
  ): Promise<void> {
    const now = new Date().toISOString()
    const existing = await this.getConnection(userId, appType)

    if (existing) {
      await getSupabase()
        .from('app_connections')
        .update({
          status,
          health_status: healthStatus,
          warning_message: warningMessage || null,
          last_health_check_at: now,
          updated_at: now,
        })
        .eq('user_id', userId)
        .eq('app_type', appType)
    } else {
      const id = uuidv4()
      await getSupabase()
        .from('app_connections')
        .insert({
          id,
          user_id: userId,
          app_type: appType,
          status,
          health_status: healthStatus,
          warning_message: warningMessage || null,
          last_health_check_at: now,
          created_at: now,
          updated_at: now,
        })
    }
  }

  private async logHealthEvent(
    userId: string,
    appType: AppType,
    eventType: AppHealthEvent['eventType'],
    details?: Record<string, unknown>
  ): Promise<void> {
    const connection = await this.getConnection(userId, appType)
    if (!connection) return

    const id = uuidv4()
    const now = new Date().toISOString()

    await getSupabase()
      .from('app_health_events')
      .insert({
        id,
        connection_id: connection.id,
        event_type: eventType,
        details: details ? JSON.stringify(details) : null,
        created_at: now,
      })
  }

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
      payload: { appType, ...payload }
    })
  }

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

  async initializeFromDatabase(): Promise<void> {
    const { data, error } = await getSupabase()
      .from('app_connections')
      .select('user_id, app_type')
      .eq('status', 'connected')

    if (error || !data) return

    for (const row of data) {
      const adapter = this.adapters.get(row.app_type)
      if (adapter && adapter.isConnected(row.user_id)) {
        console.log(`[ConnectionManager] Resuming health monitoring for ${row.user_id}:${row.app_type}`)
        this.startHealthMonitoring(row.user_id, row.app_type)
      }
    }
  }
}

// Singleton instance
export const connectionManager = new AppConnectionManager()
