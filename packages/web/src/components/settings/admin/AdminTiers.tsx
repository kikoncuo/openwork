import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminTier } from '@/types'

const PAGE_SIZE = 50

export function AdminTiers() {
  const [tiers, setTiers] = useState<AdminTier[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadTiers()
  }, [offset])

  async function loadTiers() {
    setLoading(true)
    try {
      const data = await window.api.admin.getTiers(PAGE_SIZE, offset)
      setTiers(data)
    } catch (e) {
      console.error('Failed to load tiers:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(tier: AdminTier, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('user_tiers', tier.tier_id, { [key]: value })
      setTiers((prev) => prev.map((t) => (t.tier_id === tier.tier_id ? { ...t, ...result } as AdminTier : t)))
    } catch (e) {
      console.error('Failed to update tier:', e)
    }
  }

  const columns: ColumnDef<AdminTier>[] = [
    { key: 'tier_id', header: 'ID', className: 'w-16' },
    { key: 'name', header: 'Name', editable: true },
    { key: 'display_name', header: 'Display Name', editable: true },
    {
      key: 'default_model',
      header: 'Default Model',
      editable: true,
    },
    {
      key: 'available_models',
      header: 'Models',
      render: (tier) => (
        <span className="text-xs text-muted-foreground">
          {tier.available_models.length} model{tier.available_models.length !== 1 ? 's' : ''}
        </span>
      ),
    },
    {
      key: 'features',
      header: 'Features',
      render: (tier) => (
        <div className="flex gap-1 flex-wrap">
          {Object.entries(tier.features).map(([key, val]) => (
            <span
              key={key}
              className={`text-xs px-1.5 py-0.5 rounded ${
                val ? 'bg-status-nominal/20 text-status-nominal' : 'bg-muted text-muted-foreground'
              }`}
            >
              {key.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">TIERS</div>
      <AdminDataTable
        columns={columns}
        data={tiers}
        loading={loading}
        keyField="tier_id"
        emptyMessage="No tiers found"
        filterPlaceholder="Search tiers..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: tiers.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
