import { useEffect, useState } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PDFViewerProps {
  filePath: string
  base64Content: string
}

export function PDFViewer({ filePath, base64Content }: PDFViewerProps) {
  const fileName = filePath.split('/').pop() || filePath
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    const bytes = atob(base64Content)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [base64Content])

  const handleDownload = () => {
    if (!blobUrl) return
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName
    link.click()
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <span className="truncate">{fileName}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>PDF Document</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          className="h-7 px-2 gap-1"
        >
          <ExternalLink className="size-3" />
          <span className="text-xs">Download</span>
        </Button>
      </div>

      {/* PDF embed via iframe with blob URL (avoids CSP data: restrictions) */}
      {blobUrl ? (
        <iframe
          src={blobUrl}
          className="flex-1 min-h-0 w-full border-none"
          title={fileName}
        />
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8">
          <FileText className="size-16 text-muted-foreground/50" />
          <div className="text-center">
            <div className="font-medium text-foreground mb-2">{fileName}</div>
            <div className="text-sm text-muted-foreground mb-4">
              Loading PDF...
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
