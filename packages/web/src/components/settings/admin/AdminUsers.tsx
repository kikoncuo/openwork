import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminUser, AdminTier } from '@/types'

const PAGE_SIZE = 50

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [tiers, setTiers] = useState<AdminTier[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadData()
  }, [offset])

  async function loadData() {
    setLoading(true)
    try {
      const [usersData, tiersData] = await Promise.all([
        window.api.admin.getUsers(PAGE_SIZE, offset),
        window.api.admin.getTiers(),
      ])
      setUsers(usersData)
      setTiers(tiersData)
    } catch (e) {
      console.error('Failed to load users:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleAdmin(user: AdminUser) {
    try {
      const updated = await window.api.admin.updateUser(user.user_id, {
        is_admin: !user.is_admin,
      })
      setUsers((prev) => prev.map((u) => (u.user_id === updated.user_id ? updated : u)))
    } catch (e) {
      console.error('Failed to toggle admin:', e)
    }
  }

  async function handleTierChange(user: AdminUser, tierId: number) {
    try {
      const updated = await window.api.admin.updateUser(user.user_id, { tier_id: tierId })
      setUsers((prev) => prev.map((u) => (u.user_id === updated.user_id ? updated : u)))
    } catch (e) {
      console.error('Failed to update tier:', e)
    }
  }

  async function handleDelete(user: AdminUser) {
    try {
      await window.api.admin.deleteUser(user.user_id)
      setUsers((prev) => prev.filter((u) => u.user_id !== user.user_id))
    } catch (e) {
      console.error('Failed to delete user:', e)
    }
  }

  async function handleUpdate(user: AdminUser, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('users', user.user_id, { [key]: value })
      setUsers((prev) => prev.map((u) => (u.user_id === user.user_id ? { ...u, ...result } as AdminUser : u)))
    } catch (e) {
      console.error('Failed to update user:', e)
    }
  }

  const columns: ColumnDef<AdminUser>[] = [
    {
      key: 'email',
      header: 'Email',
      render: (user) => (
        <span className="font-mono text-xs">{user.email}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      editable: true,
    },
    {
      key: 'tier_id',
      header: 'Tier',
      render: (user) => (
        <select
          value={user.tier_id}
          onChange={(e) => handleTierChange(user, Number(e.target.value))}
          className="text-xs bg-background border border-border rounded px-1.5 py-0.5"
        >
          {tiers.map((t) => (
            <option key={t.tier_id} value={t.tier_id}>
              {t.display_name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'is_admin',
      header: 'Admin',
      render: (user) => (
        <Switch
          checked={Boolean(user.is_admin)}
          onCheckedChange={() => handleToggleAdmin(user)}
        />
      ),
      className: 'w-20',
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (user) => (
        <span className="text-xs text-muted-foreground">
          {new Date(user.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL USERS</div>
      <AdminDataTable
        columns={columns}
        data={users}
        loading={loading}
        keyField="user_id"
        onDelete={handleDelete}
        deleteConfirm="Are you sure you want to delete this user? All their data will be lost."
        emptyMessage="No users found"
        filterPlaceholder="Search users..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: users.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
