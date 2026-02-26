import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Eye, Code, Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DynamicDataSheetGrid,
  textColumn,
  keyColumn,
} from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'

interface CsvViewerProps {
  filePath: string
  content: string
  onSave: (content: string) => Promise<void>
}

const ROW_CAP = 1000

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        row.push(field)
        field = ''
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field)
        field = ''
        if (row.some(cell => cell !== '')) rows.push(row)
        row = []
        if (ch === '\r') i++
      } else {
        field += ch
      }
    }
  }
  row.push(field)
  if (row.some(cell => cell !== '')) rows.push(row)

  return rows
}

function escapeField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function toCsv(headers: string[], data: Record<string, string>[], delimiter: string): string {
  const headerLine = headers.map(h => escapeField(h, delimiter)).join(delimiter)
  const lines = data.map(row =>
    headers.map(h => escapeField(row[h] ?? '', delimiter)).join(delimiter)
  )
  return [headerLine, ...lines].join('\n')
}

export function CsvViewer({ filePath, content, onSave }: CsvViewerProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'code'>('grid')
  const [editedContent, setEditedContent] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)

  const fileName = filePath.split('/').pop() || filePath
  const ext = fileName.split('.').pop()?.toLowerCase()
  const delimiter = ext === 'tsv' ? '\t' : ','

  const allRows = useMemo(() => parseCsv(editedContent, delimiter), [editedContent, delimiter])
  const headers = useMemo(() => allRows[0] || [], [allRows])
  const totalRows = allRows.length - 1
  const isCapped = totalRows > ROW_CAP

  // Measure container height for DataSheetGrid
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Convert parsed rows to record objects for DataSheetGrid
  const [gridData, setGridData] = useState<Record<string, string>[]>(() => {
    const dataRows = allRows.slice(1, ROW_CAP + 1)
    return dataRows.map(row => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
      return obj
    })
  })

  // Build columns for DataSheetGrid
  const columns = useMemo(() => {
    return headers.map(h => ({
      ...keyColumn(h, textColumn),
      title: h,
      grow: 1,
      minWidth: 120,
    }))
  }, [headers])

  const handleGridChange = useCallback((newData: Record<string, string>[]) => {
    setGridData(newData)
    const newCsv = toCsv(headers, newData, delimiter)
    setEditedContent(newCsv)
    setIsDirty(true)
  }, [headers, delimiter])

  const handleToggle = useCallback(() => {
    setViewMode(prev => prev === 'grid' ? 'code' : 'grid')
  }, [])

  const handleTextEdit = useCallback((value: string) => {
    setEditedContent(value)
    setIsDirty(value !== content)
    // Re-parse for grid when switching back
    const parsed = parseCsv(value, delimiter)
    const h = parsed[0] || []
    const dataRows = parsed.slice(1, ROW_CAP + 1)
    setGridData(dataRows.map(row => {
      const obj: Record<string, string> = {}
      h.forEach((hdr, i) => { obj[hdr] = row[i] ?? '' })
      return obj
    }))
  }, [content, delimiter])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSave(editedContent)
      setIsDirty(false)
    } finally {
      setIsSaving(false)
    }
  }, [editedContent, onSave])

  const createRow = useCallback(() => {
    const obj: Record<string, string> = {}
    headers.forEach(h => { obj[h] = '' })
    return obj
  }, [headers])

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden">
          <span className="truncate">{fileName}</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{totalRows} rows × {headers.length} cols</span>
          {isCapped && (
            <>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-yellow-500">showing {ROW_CAP} of {totalRows} rows</span>
            </>
          )}
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground/70">{ext?.toUpperCase()}</span>
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
            {viewMode === 'grid' ? <Code className="size-3" /> : <Eye className="size-3" />}
            <span className="text-xs">{viewMode === 'grid' ? 'Code' : 'Grid'}</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'grid' ? (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden csv-grid-dark">
          <DynamicDataSheetGrid
            value={gridData}
            onChange={handleGridChange}
            columns={columns}
            createRow={createRow}
            lockRows={isCapped}
            height={containerHeight}
            addRowsComponent={false}
          />
        </div>
      ) : (
        <textarea
          className="flex-1 min-h-0 w-full resize-none bg-background p-4 text-sm font-mono leading-relaxed focus:outline-none"
          value={editedContent}
          onChange={e => handleTextEdit(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  )
}
