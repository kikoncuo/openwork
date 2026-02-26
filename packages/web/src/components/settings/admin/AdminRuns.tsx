import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminRun } from '@/types'

const PAGE_SIZE = 50

export function AdminRuns() {
  const [runs, setRuns] = useState<AdminRun[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadRuns()
  }, [offset])

  async function loadRuns() {
    setLoading(true)
    try {
      const data = await window.api.admin.getRuns(PAGE_SIZE, offset)
      setRuns(data)
    } catch (e) {
      console.error('Failed to load runs:', e)
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnDef<AdminRun>[] = [
    {
      key: 'run_id',
      header: 'Run ID',
      render: (r) => <span className="font-mono text-xs">{r.run_id.slice(0, 8)}...</span>,
    },
    {
      key: 'thread_id',
      header: 'Thread',
      render: (r) => <span className="font-mono text-xs">{r.thread_id.slice(0, 8)}...</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          r.status === 'success' ? 'bg-status-nominal/20 text-status-nominal' :
          r.status === 'error' ? 'bg-status-critical/20 text-status-critical' :
          r.status === 'running' ? 'bg-status-warning/20 text-status-warning' :
          'bg-muted text-muted-foreground'
        }`}>
          {r.status || 'unknown'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.updated_at).toLocaleString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL RUNS</div>
      <AdminDataTable
        columns={columns}
        data={runs}
        loading={loading}
        keyField="run_id"
        emptyMessage="No runs found"
        filterPlaceholder="Search runs..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: runs.length === PAGE_SIZE }}
      />
    </div>
  )
}
