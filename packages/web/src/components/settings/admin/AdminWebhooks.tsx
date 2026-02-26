import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminWebhook } from '@/types'

const PAGE_SIZE = 50

export function AdminWebhooks() {
  const [webhooks, setWebhooks] = useState<AdminWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadWebhooks()
  }, [offset])

  async function loadWebhooks() {
    setLoading(true)
    try {
      const data = await window.api.admin.getWebhooks(PAGE_SIZE, offset)
      setWebhooks(data)
    } catch (e) {
      console.error('Failed to load webhooks:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(webhook: AdminWebhook) {
    try {
      await window.api.admin.deleteWebhook(webhook.id)
      setWebhooks((prev) => prev.filter((w) => w.id !== webhook.id))
    } catch (e) {
      console.error('Failed to delete webhook:', e)
    }
  }

  async function handleUpdate(webhook: AdminWebhook, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('webhooks', webhook.id, { [key]: value })
      setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? { ...w, ...result } as AdminWebhook : w)))
    } catch (e) {
      console.error('Failed to update webhook:', e)
    }
  }

  const columns: ColumnDef<AdminWebhook>[] = [
    { key: 'name', header: 'Name', editable: true },
    {
      key: 'url',
      header: 'URL',
      editable: true,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (w) => <span className="font-mono text-xs">{w.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (w) => (
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          w.enabled ? 'bg-status-nominal/20 text-status-nominal' : 'bg-muted text-muted-foreground'
        }`}>
          {w.enabled ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-20',
    },
    {
      key: 'event_types',
      header: 'Events',
      editable: true,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL WEBHOOKS</div>
      <AdminDataTable
        columns={columns}
        data={webhooks}
        loading={loading}
        keyField="id"
        onDelete={handleDelete}
        deleteConfirm="Delete this webhook?"
        emptyMessage="No webhooks found"
        filterPlaceholder="Search webhooks..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: webhooks.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
