/**
 * Connection types for frontend
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'degraded'
export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface AppConnectionStatus {
  appType: string
  displayName: string
  description: string
  id: string | null
  status: ConnectionStatus
  healthStatus: HealthStatus
  warningMessage: string | null
  lastHealthCheckAt: string | null
  lastSuccessfulActivityAt: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ConnectionStatusEvent {
  appType: string
  eventType: string
  status?: ConnectionStatus
  healthStatus?: HealthStatus
  warningMessage?: string
  recommendation?: string
  details?: Record<string, unknown>
  timestamp: string
}
