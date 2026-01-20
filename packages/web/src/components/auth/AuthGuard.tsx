/**
 * AuthGuard component - wraps the app and shows login page if not authenticated
 */

import { useEffect, ReactNode } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { ws } from '@/api/websocket'
import { LoginPage } from './LoginPage'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps): React.JSX.Element {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()

  // Check auth status on mount
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  // Connect WebSocket when authenticated, disconnect when not
  useEffect(() => {
    if (isAuthenticated) {
      ws.connect()
    } else {
      ws.disconnect()
    }
  }, [isAuthenticated])

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />
  }

  // Render children if authenticated
  return <>{children}</>
}
