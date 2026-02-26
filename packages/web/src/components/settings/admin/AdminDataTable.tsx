import { useState, useRef, useEffect, useMemo } from 'react'
import { Loader2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface ColumnDef<T> {
  key: string
  header: string
  render?: (item: T) => React.ReactNode
  className?: string
  editable?: boolean
}

interface PaginationProps {
  offset: number
  pageSize: number
  onOffsetChange: (offset: number) => void
  hasMore: boolean
}

interface AdminDataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  loading: boolean
  keyField: string
  onDelete?: (item: T) => void
  deleteConfirm?: string
  emptyMessage?: string
  filterPlaceholder?: string
  pagination?: PaginationProps
  onUpdate?: (item: T, key: string, value: string) => void
}

function EditableCell({
  value,
  onSave,
  onCancel,
}: {
  value: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <Input
      ref={inputRef}
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onSave(editValue)
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      onBlur={() => onSave(editValue)}
      className="h-7 text-sm px-1.5 py-0.5"
    />
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AdminDataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  keyField,
  onDelete,
  deleteConfirm = 'Are you sure you want to delete this item?',
  emptyMessage = 'No data found',
  filterPlaceholder,
  pagination,
  onUpdate,
}: AdminDataTableProps<T>) {
  const [filterText, setFilterText] = useState('')
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null)

  const filteredData = useMemo(() => {
    if (!filterText) return data
    const lower = filterText.toLowerCase()
    return data.filter((item) =>
      columns.some((col) => {
        const val = item[col.key]
        return val != null && String(val).toLowerCase().includes(lower)
      })
    )
  }, [data, filterText, columns])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filterPlaceholder && (
        <Input
          placeholder={filterPlaceholder}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
      )}

      {filteredData.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {filterText ? 'No matching results' : emptyMessage}
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background-elevated">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider ${col.className || ''}`}
                    >
                      {col.header}
                    </th>
                  ))}
                  {onDelete && (
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider w-16">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item) => {
                  const rowKey = String(item[keyField])
                  return (
                    <tr
                      key={rowKey}
                      className="border-b border-border/50 hover:bg-background-elevated/50 transition-colors"
                    >
                      {columns.map((col) => {
                        const isEditing = editingCell?.rowKey === rowKey && editingCell?.colKey === col.key
                        const canEdit = col.editable && onUpdate && !col.render

                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-2 ${col.className || ''} ${canEdit ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (canEdit && !isEditing) {
                                setEditingCell({ rowKey, colKey: col.key })
                              }
                            }}
                          >
                            {isEditing ? (
                              <EditableCell
                                value={String(item[col.key] ?? '')}
                                onSave={(value) => {
                                  setEditingCell(null)
                                  if (value !== String(item[col.key] ?? '')) {
                                    onUpdate!(item, col.key, value)
                                  }
                                }}
                                onCancel={() => setEditingCell(null)}
                              />
                            ) : col.render ? (
                              col.render(item)
                            ) : (
                              String(item[col.key] ?? '-')
                            )}
                          </td>
                        )
                      })}
                      {onDelete && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              if (window.confirm(deleteConfirm)) {
                                onDelete(item)
                              }
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Showing {pagination.offset + 1}-{pagination.offset + filteredData.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.offset === 0}
              onClick={() => pagination.onOffsetChange(Math.max(0, pagination.offset - pagination.pageSize))}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasMore}
              onClick={() => pagination.onOffsetChange(pagination.offset + pagination.pageSize)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
