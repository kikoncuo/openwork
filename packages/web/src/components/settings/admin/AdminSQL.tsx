import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SQLResult } from '@/types'

export function AdminSQL() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SQLResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRun() {
    if (!query.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await window.api.admin.runSQL(query)
      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Query failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-section-header">SQL QUERY RUNNER</div>

      <div className="space-y-2">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SELECT * FROM users LIMIT 10"
          className="w-full h-32 px-3 py-2 text-sm font-mono bg-background border border-border rounded-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleRun()
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleRun}
            disabled={loading || !query.trim()}
          >
            {loading && <Loader2 className="size-4 animate-spin mr-1" />}
            Run Query
          </Button>
          <span className="text-xs text-muted-foreground">
            Only SELECT queries are allowed. Cmd/Ctrl+Enter to run.
          </span>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {result.rows.length} row{result.rows.length !== 1 ? 's' : ''} returned
          </div>

          {result.columns.length > 0 && (
            <div className="border border-border rounded-sm overflow-hidden">
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background-elevated sticky top-0">
                      {result.columns.map((col, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-b border-border/50 hover:bg-background-elevated/50"
                      >
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                            {cell === null ? (
                              <span className="text-muted-foreground">NULL</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
