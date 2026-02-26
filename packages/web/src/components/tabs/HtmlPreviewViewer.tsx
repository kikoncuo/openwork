import { useState, useCallback } from 'react'
import { Eye, Code, Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HtmlPreviewViewerProps {
  filePath: string
  content: string
  onSave: (content: string) => Promise<void>
}

export function HtmlPreviewViewer({ filePath, content, onSave }: HtmlPreviewViewerProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [editedContent, setEditedContent] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const fileName = filePath.split('/').pop() || filePath
  const lineCount = editedContent.split('\n').length

  const handleToggle = useCallback(() => {
    setViewMode(prev => prev === 'preview' ? 'code' : 'preview')
  }, [])

  const handleEdit = useCallback((value: string) => {
    setEditedContent(value)
    setIsDirty(value !== content)
  }, [content])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSave(editedContent)
      setIsDirty(false)
    } finally {
      setIsSaving(false)
    }
  }, [editedContent, onSave])

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <span className="truncate">{fileName}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{lineCount} lines</span>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground/70">HTML</span>
          {viewMode === 'preview' && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-yellow-500 text-[11px]">External resources blocked for security</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isDirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="h-7 px-2 gap-1"
            >
              {isSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
              <span className="text-xs">Save</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            className="h-7 px-2 gap-1"
          >
            {viewMode === 'preview' ? <Code className="size-3" /> : <Eye className="size-3" />}
            <span className="text-xs">{viewMode === 'preview' ? 'Code' : 'Preview'}</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'preview' ? (
        <iframe
          srcDoc={editedContent}
          sandbox="allow-scripts"
          className="flex-1 min-h-0 w-full border-none bg-white"
          title={fileName}
        />
      ) : (
        <textarea
          className="flex-1 min-h-0 w-full resize-none bg-background p-4 text-sm font-mono leading-relaxed focus:outline-none"
          value={editedContent}
          onChange={e => handleEdit(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  )
}
