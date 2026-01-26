/**
 * Core types for the unified app connection system
 */

export type AppType = 'whatsapp' | 'google_workspace' | string

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'degraded'

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'

/**
 * Represents an app connection for a user
 */
export interface AppConnection {
  id: string
  userId: string
  appType: AppType
  status: ConnectionStatus
  healthStatus: HealthStatus
  warningMessage?: string
  lastHealthCheckAt?: Date
  lastSuccessfulActivityAt?: Date
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  healthy: boolean
  status: HealthStatus
  warningMessage?: string
  details?: Record<string, unknown>
}

/**
 * Health event for debugging/logging
 */
export interface AppHealthEvent {
  id: string
  connectionId: string
  eventType: 'connected' | 'disconnected' | 'warning' | 'error' | 'health_check' | 'activity'
  details?: Record<string, unknown>
  createdAt: Date
}

/**
 * Interface that app adapters must implement
 */
export interface AppAdapter {
  /** Unique identifier for this app type */
  appType: AppType

  /** Display name shown in UI */
  displayName: string

  /** App description */
  description: string

  /**
   * Initiate connection for a user
   * @param userId - User ID
   * @param options - App-specific options
   */
  connect(userId: string, options?: Record<string, unknown>): Promise<void>

  /**
   * Disconnect app for a user
   * @param userId - User ID
   */
  disconnect(userId: string): Promise<void>

  /**
   * Perform health check
   * @param userId - User ID
   * @returns Health check result
   */
  healthCheck(userId: string): Promise<HealthCheckResult>

  /**
   * Check if currently connected (quick synchronous check)
   * @param userId - User ID
   */
  isConnected(userId: string): boolean

  /**
   * Get connection-specific info (phone number, email, etc.)
   * @param userId - User ID
   */
  getConnectionInfo(userId: string): Record<string, unknown> | null
}

/**
 * Connection event emitted through hook system
 */
export interface ConnectionEvent {
  appType: AppType
  userId: string
  status?: ConnectionStatus
  healthStatus?: HealthStatus
  warningMessage?: string
  details?: Record<string, unknown>
}
