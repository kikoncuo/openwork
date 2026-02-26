import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminCronjob } from '@/types'

const PAGE_SIZE = 50

export function AdminCronjobs() {
  const [cronjobs, setCronjobs] = useState<AdminCronjob[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadCronjobs()
  }, [offset])

  async function loadCronjobs() {
    setLoading(true)
    try {
      const data = await window.api.admin.getCronjobs(PAGE_SIZE, offset)
      setCronjobs(data)
    } catch (e) {
      console.error('Failed to load cronjobs:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(cronjob: AdminCronjob) {
    try {
      await window.api.admin.deleteCronjob(cronjob.cronjob_id)
      setCronjobs((prev) => prev.filter((c) => c.cronjob_id !== cronjob.cronjob_id))
    } catch (e) {
      console.error('Failed to delete cronjob:', e)
    }
  }

  async function handleUpdate(cronjob: AdminCronjob, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('cronjobs', cronjob.cronjob_id, { [key]: value })
      setCronjobs((prev) => prev.map((c) => (c.cronjob_id === cronjob.cronjob_id ? { ...c, ...result } as AdminCronjob : c)))
    } catch (e) {
      console.error('Failed to update cronjob:', e)
    }
  }

  const columns: ColumnDef<AdminCronjob>[] = [
    { key: 'name', header: 'Name', editable: true },
    {
      key: 'cron_expression',
      header: 'Schedule',
      editable: true,
    },
    {
      key: 'message',
      header: 'Message',
      editable: true,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (c) => <span className="font-mono text-xs">{c.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (c) => (
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          c.enabled ? 'bg-status-nominal/20 text-status-nominal' : 'bg-muted text-muted-foreground'
        }`}>
          {c.enabled ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-20',
    },
    {
      key: 'last_run_at',
      header: 'Last Run',
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.last_run_at ? new Date(c.last_run_at).toLocaleString() : 'Never'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL CRONJOBS</div>
      <AdminDataTable
        columns={columns}
        data={cronjobs}
        loading={loading}
        keyField="cronjob_id"
        onDelete={handleDelete}
        deleteConfirm="Delete this cronjob?"
        emptyMessage="No cronjobs found"
        filterPlaceholder="Search cronjobs..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: cronjobs.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
