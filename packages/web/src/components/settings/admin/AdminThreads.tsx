import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminThread } from '@/types'

const PAGE_SIZE = 50

export function AdminThreads() {
  const [threads, setThreads] = useState<AdminThread[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadThreads()
  }, [offset])

  async function loadThreads() {
    setLoading(true)
    try {
      const data = await window.api.admin.getThreads(PAGE_SIZE, offset)
      setThreads(data)
    } catch (e) {
      console.error('Failed to load threads:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(thread: AdminThread) {
    try {
      await window.api.admin.deleteThread(thread.thread_id)
      setThreads((prev) => prev.filter((t) => t.thread_id !== thread.thread_id))
    } catch (e) {
      console.error('Failed to delete thread:', e)
    }
  }

  async function handleUpdate(thread: AdminThread, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('threads', thread.thread_id, { [key]: value })
      setThreads((prev) => prev.map((t) => (t.thread_id === thread.thread_id ? { ...t, ...result } as AdminThread : t)))
    } catch (e) {
      console.error('Failed to update thread:', e)
    }
  }

  const columns: ColumnDef<AdminThread>[] = [
    {
      key: 'thread_id',
      header: 'ID',
      render: (t) => <span className="font-mono text-xs">{t.thread_id.slice(0, 8)}...</span>,
    },
    {
      key: 'title',
      header: 'Title',
      editable: true,
    },
    {
      key: 'user_id',
      header: 'User',
      render: (t) => <span className="font-mono text-xs">{t.user_id?.slice(0, 8) ?? '-'}...</span>,
    },
    {
      key: 'source',
      header: 'Source',
      render: (t) => (
        <span className="text-xs px-1.5 py-0.5 bg-muted rounded">
          {t.source || 'chat'}
        </span>
      ),
    },
    { key: 'status', header: 'Status', editable: true },
    {
      key: 'updated_at',
      header: 'Updated',
      render: (t) => (
        <span className="text-xs text-muted-foreground">
          {new Date(t.updated_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL THREADS</div>
      <AdminDataTable
        columns={columns}
        data={threads}
        loading={loading}
        keyField="thread_id"
        onDelete={handleDelete}
        deleteConfirm="Delete this thread? This cannot be undone."
        emptyMessage="No threads found"
        filterPlaceholder="Search threads..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: threads.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
