/**
 * WhatsApp Settings Component
 * Allows users to connect/disconnect WhatsApp via QR code scanning
 */

import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, Check, Loader2, Power, PowerOff, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'

interface ConnectionStatus {
  connected: boolean
  phoneNumber: string | null
  connectedAt: number | null
}

export function WhatsAppSettings(): React.JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    phoneNumber: null,
    connectedAt: null
  })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  // Load initial status
  useEffect(() => {
    loadStatus()
  }, [])

  // Subscribe to connection changes
  useEffect(() => {
    const cleanup = window.api.whatsapp.onConnectionChange((data) => {
      setStatus({
        connected: data.connected,
        phoneNumber: data.phoneNumber || null,
        connectedAt: data.connected ? Date.now() : null
      })

      // Close QR modal on successful connection
      if (data.connected) {
        setQrModalOpen(false)
        setQrCode(null)
        setConnecting(false)
      }
    })

    // Subscribe to connection events
    window.api.whatsapp.subscribeConnection()

    return () => {
      cleanup()
      window.api.whatsapp.unsubscribeConnection()
    }
  }, [])

  // Subscribe to QR code events when modal is open
  useEffect(() => {
    if (!qrModalOpen) return

    const cleanup = window.api.whatsapp.onQRCode((qr) => {
      setQrCode(qr)
      setQrError(null)
    })

    // Subscribe to QR events
    window.api.whatsapp.subscribeQR()

    return () => {
      cleanup()
      window.api.whatsapp.unsubscribeQR()
    }
  }, [qrModalOpen])

  async function loadStatus(): Promise<void> {
    setLoading(true)
    try {
      const currentStatus = await window.api.whatsapp.getStatus() as {
        connected: boolean
        phoneNumber: string | null
        connectedAt: string | null
      }
      setStatus({
        connected: currentStatus.connected,
        phoneNumber: currentStatus.phoneNumber,
        connectedAt: currentStatus.connectedAt ? new Date(currentStatus.connectedAt).getTime() : null
      })
    } catch (error) {
      console.error('Failed to load WhatsApp status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    setQrError(null)
    setQrCode(null)
    setQrModalOpen(true)

    try {
      const qr = await window.api.whatsapp.connect()
      if (qr) {
        setQrCode(qr)
      } else {
        // Already connected, close modal
        setQrModalOpen(false)
        await loadStatus()
      }
    } catch (error) {
      console.error('Failed to connect WhatsApp:', error)
      setQrError(error instanceof Error ? error.message : 'Failed to connect')
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await window.api.whatsapp.disconnect()
      setStatus({
        connected: false,
        phoneNumber: null,
        connectedAt: null
      })
    } catch (error) {
      console.error('Failed to disconnect WhatsApp:', error)
    } finally {
      setDisconnecting(false)
    }
  }, [])

  const handleCloseQrModal = useCallback((): void => {
    setQrModalOpen(false)
    setQrCode(null)
    setQrError(null)
    setConnecting(false)
  }, [])

  if (loading) {
    return (
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading WhatsApp status...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="p-4 border border-border rounded-sm bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${status.connected ? 'bg-status-nominal/20' : 'bg-muted'}`}>
              <MessageSquare className={`size-5 ${status.connected ? 'text-status-nominal' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">WhatsApp</span>
                {status.connected ? (
                  <span className="flex items-center gap-1 text-xs text-status-nominal">
                    <Check className="size-3" />
                    Connected
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not connected</span>
                )}
              </div>
              {status.connected && status.phoneNumber && (
                <div className="text-sm text-muted-foreground">
                  {status.phoneNumber}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status.connected ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={loadStatus}
                  title="Refresh status"
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-destructive hover:text-destructive"
                >
                  {disconnecting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <PowerOff className="size-4 mr-2" />
                  )}
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <Power className="size-4 mr-2" />
                )}
                Connect
              </Button>
            )}
          </div>
        </div>

        {status.connected && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              WhatsApp is connected. The agent can now search messages, view contacts, and send messages on your behalf.
            </p>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      <Dialog open={qrModalOpen} onOpenChange={handleCloseQrModal}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
            <DialogDescription>
              Scan the QR code with your WhatsApp mobile app to connect.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-6">
            {qrError ? (
              <div className="text-center">
                <AlertCircle className="size-12 mx-auto mb-4 text-status-critical" />
                <p className="text-sm text-status-critical mb-4">{qrError}</p>
                <Button onClick={handleConnect}>
                  <RefreshCw className="size-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : qrCode ? (
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="w-64 h-64"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Loader2 className="size-12 animate-spin text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">Generating QR code...</p>
              </div>
            )}
          </div>

          <div className="text-center text-xs text-muted-foreground space-y-2">
            <p>1. Open WhatsApp on your phone</p>
            <p>2. Go to Settings → Linked Devices</p>
            <p>3. Tap "Link a Device" and scan this QR code</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
