import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Folder, File, ChevronUp, Loader2, Home, FolderOpen } from 'lucide-react'

interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modifiedAt?: string
}

interface PathSuggestion {
  path: string
  label: string
}

interface WorkspaceBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  initialPath?: string
}

export function WorkspaceBrowser({ open, onOpenChange, onSelect, initialPath }: WorkspaceBrowserProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<BrowseEntry[]>([])
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([])
  const [manualPath, setManualPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load suggestions when dialog opens
  useEffect(() => {
    if (open) {
      loadSuggestions()
      // Browse to initial path or home
      browse(initialPath || '')
    }
  }, [open, initialPath])

  async function loadSuggestions() {
    try {
      const result = await window.api.workspace.getSuggestions()
      setSuggestions(result)
    } catch (e) {
      console.error('[WorkspaceBrowser] Failed to load suggestions:', e)
    }
  }

  const browse = useCallback(async (targetPath: string) => {
    setLoading(true)
    setError(null)

    try {
      const result = await window.api.workspace.browse(targetPath || undefined)
      setCurrentPath(result.currentPath)
      setParentPath(result.parentPath)
      setEntries(result.entries)
      setManualPath(result.currentPath)
    } catch (e) {
      console.error('[WorkspaceBrowser] Browse error:', e)
      setError('Failed to browse directory')
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleManualPathSubmit() {
    if (!manualPath.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await window.api.workspace.validate(manualPath)
      if (result.valid) {
        browse(result.path)
      } else {
        setError(result.error || 'Invalid path')
      }
    } catch (e) {
      setError('Failed to validate path')
    } finally {
      setLoading(false)
    }
  }

  function handleSelectCurrent() {
    if (currentPath) {
      onSelect(currentPath)
      onOpenChange(false)
    }
  }

  function handleEntryClick(entry: BrowseEntry) {
    if (entry.isDirectory) {
      browse(entry.path)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleManualPathSubmit()
    }
  }

  // Format file size for display
  function formatSize(bytes?: number): string {
    if (bytes === undefined) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Workspace Folder</DialogTitle>
          <DialogDescription>
            Choose a folder on your computer where the agent can read and write files.
          </DialogDescription>
        </DialogHeader>

        {/* Manual path input */}
        <div className="flex gap-2">
          <Input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="Enter path or browse below..."
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button onClick={handleManualPathSubmit} variant="outline" disabled={loading}>
            Go
          </Button>
        </div>

        {/* Quick access suggestions */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 6).map((s) => (
              <Button
                key={s.path}
                variant="outline"
                size="sm"
                onClick={() => browse(s.path)}
                className="text-xs"
              >
                {s.label === 'Home' ? (
                  <Home className="size-3 mr-1" />
                ) : (
                  <Folder className="size-3 mr-1" />
                )}
                {s.label}
              </Button>
            ))}
          </div>
        )}

        {/* Current path and navigation */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
          {parentPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => browse(parentPath)}
              className="h-7 px-2"
            >
              <ChevronUp className="size-4" />
            </Button>
          )}
          <FolderOpen className="size-4 text-yellow-500" />
          <span className="truncate font-mono text-xs">{currentPath}</span>
        </div>

        {/* Directory listing */}
        <ScrollArea className="flex-1 min-h-[300px] border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center h-full py-8">
              <Loader2 className="animate-spin size-6 text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full py-8 text-destructive">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full py-8 text-muted-foreground">
              Empty directory
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleEntryClick(entry)}
                  className={`flex items-center gap-3 w-full p-2 rounded-md text-left text-sm transition-colors ${
                    entry.isDirectory
                      ? 'hover:bg-muted cursor-pointer'
                      : 'text-muted-foreground cursor-default'
                  }`}
                  disabled={!entry.isDirectory}
                >
                  {entry.isDirectory ? (
                    <Folder className="size-4 text-yellow-500 shrink-0" />
                  ) : (
                    <File className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate flex-1">{entry.name}</span>
                  {!entry.isDirectory && entry.size !== undefined && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatSize(entry.size)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelectCurrent} disabled={!currentPath || loading}>
            Select This Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
