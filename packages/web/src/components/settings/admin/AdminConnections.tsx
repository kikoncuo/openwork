import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminAppConnection } from '@/types'

const PAGE_SIZE = 50

export function AdminConnections() {
  const [connections, setConnections] = useState<AdminAppConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadConnections()
  }, [offset])

  async function loadConnections() {
    setLoading(true)
    try {
      const data = await window.api.admin.getConnections(PAGE_SIZE, offset)
      setConnections(data)
    } catch (e) {
      console.error('Failed to load connections:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(connection: AdminAppConnection, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('app_connections', connection.id, { [key]: value })
      setConnections((prev) => prev.map((c) => (c.id === connection.id ? { ...c, ...result } as AdminAppConnection : c)))
    } catch (e) {
      console.error('Failed to update connection:', e)
    }
  }

  const columns: ColumnDef<AdminAppConnection>[] = [
    {
      key: 'app_type',
      header: 'App',
      render: (c) => <span className="font-medium">{c.app_type}</span>,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (c) => <span className="font-mono text-xs">{c.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'status',
      header: 'Status',
      editable: true,
    },
    {
      key: 'health_status',
      header: 'Health',
      editable: true,
    },
    {
      key: 'updated_at',
      header: 'Updated',
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {new Date(c.updated_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL APP CONNECTIONS</div>
      <AdminDataTable
        columns={columns}
        data={connections}
        loading={loading}
        keyField="id"
        emptyMessage="No app connections found"
        filterPlaceholder="Search connections..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: connections.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
