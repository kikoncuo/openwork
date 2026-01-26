/**
 * App Warning Banner
 * Displays a warning message when an app connection needs attention
 */

import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AppWarningBannerProps {
  message: string
  recommendation?: string
  onReconnect?: () => void
  reconnecting?: boolean
  className?: string
}

export function AppWarningBanner({
  message,
  recommendation,
  onReconnect,
  reconnecting = false,
  className = ''
}: AppWarningBannerProps): React.JSX.Element {
  return (
    <div className={`flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-sm ${className}`}>
      <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
          Connection Warning
        </div>
        <p className="text-sm text-amber-600/80 dark:text-amber-400/80 mt-1">
          {message}
        </p>
        {recommendation && (
          <p className="text-xs text-amber-600/60 dark:text-amber-400/60 mt-1">
            {recommendation}
          </p>
        )}
      </div>
      {onReconnect && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReconnect}
          disabled={reconnecting}
          className="shrink-0 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
        >
          {reconnecting ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Reconnecting...
            </>
          ) : (
            <>
              <RefreshCw className="size-4 mr-2" />
              Reconnect
            </>
          )}
        </Button>
      )}
    </div>
  )
}
