import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminAgent } from '@/types'

const PAGE_SIZE = 50

export function AdminAgents() {
  const [agents, setAgents] = useState<AdminAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadAgents()
  }, [offset])

  async function loadAgents() {
    setLoading(true)
    try {
      const data = await window.api.admin.getAgents(PAGE_SIZE, offset)
      setAgents(data)
    } catch (e) {
      console.error('Failed to load agents:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(agent: AdminAgent) {
    try {
      await window.api.admin.deleteAgent(agent.agent_id)
      setAgents((prev) => prev.filter((a) => a.agent_id !== agent.agent_id))
    } catch (e) {
      console.error('Failed to delete agent:', e)
    }
  }

  async function handleUpdate(agent: AdminAgent, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('agents', agent.agent_id, { [key]: value })
      setAgents((prev) => prev.map((a) => (a.agent_id === agent.agent_id ? { ...a, ...result } as AdminAgent : a)))
    } catch (e) {
      console.error('Failed to update agent:', e)
    }
  }

  const columns: ColumnDef<AdminAgent>[] = [
    {
      key: 'name',
      header: 'Name',
      editable: true,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (a) => <span className="font-mono text-xs">{a.user_id?.slice(0, 8) ?? '-'}...</span>,
    },
    {
      key: 'model_default',
      header: 'Model',
      editable: true,
    },
    {
      key: 'is_default',
      header: 'Default',
      render: (a) => a.is_default ? 'Yes' : '-',
      className: 'w-16',
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (a) => (
        <span className="text-xs text-muted-foreground">
          {new Date(a.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL AGENTS</div>
      <AdminDataTable
        columns={columns}
        data={agents}
        loading={loading}
        keyField="agent_id"
        onDelete={handleDelete}
        deleteConfirm="Delete this agent? This cannot be undone."
        emptyMessage="No agents found"
        filterPlaceholder="Search agents..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: agents.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
