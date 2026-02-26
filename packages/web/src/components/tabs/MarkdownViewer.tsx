import { useState, useCallback } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MDEditor from '@uiw/react-md-editor'

interface MarkdownViewerProps {
  filePath: string
  content: string
  onSave: (content: string) => Promise<void>
}

export function MarkdownViewer({ filePath, content, onSave }: MarkdownViewerProps) {
  const [editedContent, setEditedContent] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const fileName = filePath.split('/').pop() || filePath
  const lineCount = editedContent.split('\n').length

  const handleChange = useCallback((value?: string) => {
    const v = value ?? ''
    setEditedContent(v)
    setIsDirty(v !== content)
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
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden" data-color-mode="dark">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <span className="truncate">{fileName}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{lineCount} lines</span>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground/70">Markdown</span>
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
        </div>
      </div>

      {/* MDEditor with built-in edit/preview toggle */}
      <div className="flex-1 min-h-0 overflow-hidden [&_.w-md-editor]:!h-full [&_.w-md-editor]:!border-none [&_.w-md-editor]:!rounded-none [&_.w-md-editor]:!shadow-none [&_.w-md-editor]:!bg-transparent">
        <MDEditor
          value={editedContent}
          onChange={handleChange}
          height="100%"
          preview="live"
          visibleDragbar={false}
          hideToolbar={false}
        />
      </div>
    </div>
  )
}
