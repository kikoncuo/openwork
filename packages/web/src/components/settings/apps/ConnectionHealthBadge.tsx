/**
 * Connection Health Badge
 * Shows the health status of an app connection with appropriate styling
 */

import { Check, AlertTriangle, XCircle, Loader2, Circle } from 'lucide-react'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'degraded'
export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'

interface ConnectionHealthBadgeProps {
  status: ConnectionStatus
  healthStatus: HealthStatus
  className?: string
}

export function ConnectionHealthBadge({
  status,
  healthStatus,
  className = ''
}: ConnectionHealthBadgeProps): React.JSX.Element {
  // Disconnected state
  if (status === 'disconnected') {
    return (
      <span className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
        <Circle className="size-3" />
        Not connected
      </span>
    )
  }

  // Connecting state
  if (status === 'connecting') {
    return (
      <span className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="size-3 animate-spin" />
        Connecting...
      </span>
    )
  }

  // Connected states with health indicator
  switch (healthStatus) {
    case 'healthy':
      return (
        <span className={`flex items-center gap-1 text-xs text-status-nominal ${className}`}>
          <Check className="size-3" />
          Connected
        </span>
      )

    case 'warning':
      return (
        <span className={`flex items-center gap-1 text-xs text-amber-500 ${className}`}>
          <AlertTriangle className="size-3" />
          Needs Attention
        </span>
      )

    case 'critical':
      return (
        <span className={`flex items-center gap-1 text-xs text-destructive ${className}`}>
          <XCircle className="size-3" />
          Connection Issue
        </span>
      )

    default:
      return (
        <span className={`flex items-center gap-1 text-xs text-status-nominal ${className}`}>
          <Check className="size-3" />
          Connected
        </span>
      )
  }
}
