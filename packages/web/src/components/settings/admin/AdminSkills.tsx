import { useState, useEffect } from 'react'
import { AdminDataTable, type ColumnDef } from './AdminDataTable'
import type { AdminSkill } from '@/types'

const PAGE_SIZE = 50

export function AdminSkills() {
  const [skills, setSkills] = useState<AdminSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    loadSkills()
  }, [offset])

  async function loadSkills() {
    setLoading(true)
    try {
      const data = await window.api.admin.getSkills(PAGE_SIZE, offset)
      setSkills(data)
    } catch (e) {
      console.error('Failed to load skills:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(skill: AdminSkill) {
    try {
      await window.api.admin.deleteSkill(skill.skill_id)
      setSkills((prev) => prev.filter((s) => s.skill_id !== skill.skill_id))
    } catch (e) {
      console.error('Failed to delete skill:', e)
    }
  }

  async function handleUpdate(skill: AdminSkill, key: string, value: string) {
    try {
      const result = await window.api.admin.updateRecord('skills', skill.skill_id, { [key]: value })
      setSkills((prev) => prev.map((s) => (s.skill_id === skill.skill_id ? { ...s, ...result } as AdminSkill : s)))
    } catch (e) {
      console.error('Failed to update skill:', e)
    }
  }

  const columns: ColumnDef<AdminSkill>[] = [
    { key: 'name', header: 'Name', editable: true },
    {
      key: 'description',
      header: 'Description',
      editable: true,
    },
    {
      key: 'user_id',
      header: 'Owner',
      render: (s) => <span className="font-mono text-xs">{s.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'file_count',
      header: 'Files',
      className: 'w-16',
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (s) => (
        <span className="text-xs text-muted-foreground">
          {new Date(s.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-section-header">ALL SKILLS</div>
      <AdminDataTable
        columns={columns}
        data={skills}
        loading={loading}
        keyField="skill_id"
        onDelete={handleDelete}
        deleteConfirm="Delete this skill?"
        emptyMessage="No skills found"
        filterPlaceholder="Search skills..."
        pagination={{ offset, pageSize: PAGE_SIZE, onOffsetChange: setOffset, hasMore: skills.length === PAGE_SIZE }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
