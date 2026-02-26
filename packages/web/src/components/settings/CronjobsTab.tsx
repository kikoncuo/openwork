import { useState, useEffect } from 'react'
import { Loader2, Trash2, Plus, Clock, Play, Power, PowerOff, X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { CronBuilder } from './CronBuilder'

interface Cronjob {
  cronjob_id: string
  user_id: string
  name: string
  cron_expression: string
  message: string
  agent_id: string
  thread_mode: 'new' | 'reuse'
  thread_timeout_minutes: number
  enabled: number
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export function CronjobsTab() {
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)

  const [loading, setLoading] = useState(true)
  const [cronjobs, setCronjobs] = useState<Cronjob[]>([])
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formCron, setFormCron] = useState('0 9 * * *')
  const [formMessage, setFormMessage] = useState('')
  const [formAgentId, setFormAgentId] = useState<string>('')
  const [formThreadMode, setFormThreadMode] = useState<'new' | 'reuse'>('new')
  const [formTimeoutMinutes, setFormTimeoutMinutes] = useState(30)
  const [formValid, setFormValid] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  // Action states
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [triggeringId, setTriggeringId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  // Load cronjobs on mount
  useEffect(() => {
    loadCronjobs()
  }, [])

  // Set default agent when agents load
  useEffect(() => {
    if (!formAgentId && agents.length > 0) {
      setFormAgentId(activeAgentId || agents[0].agent_id)
    }
  }, [agents, activeAgentId, formAgentId])

  async function loadCronjobs() {
    setLoading(true)
    setError(null)
    try {
      const loaded = await window.api.cronjobs.list()
      setCronjobs(loaded)
    } catch (err) {
      console.error('[CronjobsTab] Failed to load cronjobs:', err)
      setError(err instanceof Error ? err.message : 'Failed to load cronjobs')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setFormName('')
    setFormCron('0 9 * * *')
    setFormMessage('')
    setFormAgentId(activeAgentId || agents[0]?.agent_id || '')
    setFormThreadMode('new')
    setFormTimeoutMinutes(30)
    setFormValid(true)
    setFormError(null)
    setEditingId(null)
  }

  function openCreateForm() {
    resetForm()
    setShowForm(true)
  }

  function openEditForm(cronjob: Cronjob) {
    setEditingId(cronjob.cronjob_id)
    setFormName(cronjob.name)
    setFormCron(cronjob.cron_expression)
    setFormMessage(cronjob.message)
    setFormAgentId(cronjob.agent_id)
    setFormThreadMode(cronjob.thread_mode)
    setFormTimeoutMinutes(cronjob.thread_timeout_minutes)
    setFormValid(true)
    setFormError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    resetForm()
  }

  async function handleSave() {
    if (!formName.trim() || !formMessage.trim() || !formAgentId || !formValid) {
      return
    }

    setSaving(true)
    setFormError(null)

    try {
      if (editingId) {
        // Update existing
        const updated = await window.api.cronjobs.update(editingId, {
          name: formName.trim(),
          cron_expression: formCron,
          message: formMessage.trim(),
          agent_id: formAgentId,
          thread_mode: formThreadMode,
          thread_timeout_minutes: formTimeoutMinutes,
        })
        setCronjobs(prev => prev.map(c => c.cronjob_id === editingId ? updated : c))
      } else {
        // Create new
        const created = await window.api.cronjobs.create({
          name: formName.trim(),
          cron_expression: formCron,
          message: formMessage.trim(),
          agent_id: formAgentId,
          thread_mode: formThreadMode,
          thread_timeout_minutes: formTimeoutMinutes,
        })
        setCronjobs(prev => [created, ...prev])
      }
      closeForm()
    } catch (err) {
      console.error('[CronjobsTab] Save error:', err)
      setFormError(err instanceof Error ? err.message : 'Failed to save cronjob')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cronjobId: string) {
    setDeletingId(cronjobId)
    try {
      await window.api.cronjobs.delete(cronjobId)
      setCronjobs(prev => prev.filter(c => c.cronjob_id !== cronjobId))
    } catch (err) {
      console.error('[CronjobsTab] Delete error:', err)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggle(cronjobId: string) {
    setTogglingId(cronjobId)
    try {
      const updated = await window.api.cronjobs.toggle(cronjobId)
      setCronjobs(prev => prev.map(c => c.cronjob_id === cronjobId ? updated : c))
    } catch (err) {
      console.error('[CronjobsTab] Toggle error:', err)
    } finally {
      setTogglingId(null)
    }
  }

  async function handleTrigger(cronjobId: string) {
    setTriggeringId(cronjobId)
    try {
      const result = await window.api.cronjobs.trigger(cronjobId)
      if (result.success) {
        // Refresh to get updated last_run_at
        await loadCronjobs()
      }
    } catch (err) {
      console.error('[CronjobsTab] Trigger error:', err)
    } finally {
      setTriggeringId(null)
    }
  }

  async function handleTestNow() {
    if (!formMessage.trim() || !formAgentId) return

    setTesting(true)
    try {
      const result = await window.api.cronjobs.test({
        agent_id: formAgentId,
        message: formMessage.trim(),
      })
      if (result.success && result.thread_id) {
        // Thread was created - user can view it in the sidebar
        console.log('[CronjobsTab] Test successful, thread_id:', result.thread_id)
      }
    } catch (err) {
      console.error('[CronjobsTab] Test error:', err)
    } finally {
      setTesting(false)
    }
  }

  function formatTime(timestamp: number | null): string {
    if (!timestamp) return 'Never'
    return new Date(timestamp).toLocaleString()
  }

  function getAgentName(agentId: string): string {
    const agent = agents.find(a => a.agent_id === agentId)
    return agent?.name || 'Unknown'
  }

  function handleCronValidation(valid: boolean, error?: string) {
    setFormValid(valid)
    if (!valid && error) {
      // Only show cron-specific errors in the cron builder
    }
  }

  return (
    <div className="space-y-6 py-4">
      {/* Header */}
      <div>
        <div className="text-section-header mb-2">SCHEDULED TASKS</div>
        <p className="text-xs text-muted-foreground mb-4">
          Schedule periodic agent invocations with custom messages.
        </p>
      </div>

      {/* Create Button */}
      {!showForm && (
        <Button onClick={openCreateForm}>
          <Plus className="size-4 mr-2" />
          Create Cronjob
        </Button>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="p-4 border border-border rounded-sm bg-background-elevated space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{editingId ? 'Edit Cronjob' : 'New Cronjob'}</span>
            <Button variant="ghost" size="icon-sm" onClick={closeForm}>
              <X className="size-4" />
            </Button>
          </div>

          {formError && (
            <div className="flex items-center gap-2 p-2 bg-status-critical/10 text-status-critical rounded text-sm">
              <AlertCircle className="size-4" />
              {formError}
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Daily report, Weekly sync, etc."
            />
          </div>

          {/* Agent Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Agent</label>
            <select
              value={formAgentId}
              onChange={(e) => setFormAgentId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {agents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Message</label>
            <textarea
              value={formMessage}
              onChange={(e) => setFormMessage(e.target.value)}
              placeholder="The message to send to the agent when the cronjob runs..."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            />
          </div>

          {/* Cron Builder */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Schedule</label>
            <CronBuilder
              value={formCron}
              onChange={setFormCron}
              onValidation={handleCronValidation}
            />
          </div>

          {/* Thread Mode */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Thread Mode</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="thread_mode"
                  value="new"
                  checked={formThreadMode === 'new'}
                  onChange={() => setFormThreadMode('new')}
                  className="text-primary"
                />
                <span className="text-sm">New thread each run</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="thread_mode"
                  value="reuse"
                  checked={formThreadMode === 'reuse'}
                  onChange={() => setFormThreadMode('reuse')}
                  className="text-primary"
                />
                <span className="text-sm">Reuse thread (with timeout)</span>
              </label>
            </div>
          </div>

          {/* Timeout (for reuse mode) */}
          {formThreadMode === 'reuse' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Thread Timeout (minutes)</label>
              <Input
                type="number"
                value={formTimeoutMinutes}
                onChange={(e) => setFormTimeoutMinutes(parseInt(e.target.value) || 30)}
                min={1}
                max={10080}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Create new thread if inactive longer than this
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!formName.trim() || !formMessage.trim() || !formAgentId || !formValid || saving}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              {editingId ? 'Save Changes' : 'Create Cronjob'}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestNow}
              disabled={!formMessage.trim() || !formAgentId || testing}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Play className="size-4 mr-2" />
              )}
              Test Now
            </Button>
            <Button variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {/* Cronjobs List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-status-critical">
            <AlertCircle className="size-8 mx-auto mb-2 opacity-50" />
            <p>{error}</p>
          </div>
        ) : cronjobs.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Clock className="size-8 mx-auto mb-2 opacity-50" />
            <p>No cronjobs configured</p>
            <p className="text-xs mt-1">Create a cronjob to schedule agent invocations</p>
          </div>
        ) : (
          cronjobs.map((cronjob) => (
            <div
              key={cronjob.cronjob_id}
              className={`p-3 border rounded-sm transition-colors ${
                cronjob.enabled
                  ? 'border-border bg-background-elevated'
                  : 'border-border/50 bg-background opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`p-1.5 rounded ${cronjob.enabled ? 'bg-status-nominal/20' : 'bg-muted'}`}>
                    {cronjob.enabled ? (
                      <Power className="size-4 text-status-nominal" />
                    ) : (
                      <PowerOff className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{cronjob.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                        {getAgentName(cronjob.agent_id)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <code className="bg-muted px-1 rounded">{cronjob.cron_expression}</code>
                      {' '}&middot;{' '}
                      {cronjob.thread_mode === 'reuse' ? `Reuse (${cronjob.thread_timeout_minutes}m)` : 'New thread'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      Message: {cronjob.message}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                      {cronjob.enabled && cronjob.next_run_at && (
                        <span>Next: {formatTime(cronjob.next_run_at)}</span>
                      )}
                      {cronjob.last_run_at && (
                        <span>Last: {formatTime(cronjob.last_run_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleTrigger(cronjob.cronjob_id)}
                    disabled={triggeringId === cronjob.cronjob_id}
                    title="Run now"
                  >
                    {triggeringId === cronjob.cronjob_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditForm(cronjob)}
                  >
                    Edit
                  </Button>
                  <Switch
                    checked={!!cronjob.enabled}
                    onCheckedChange={() => handleToggle(cronjob.cronjob_id)}
                    disabled={togglingId === cronjob.cronjob_id}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(cronjob.cronjob_id)}
                    disabled={deletingId === cronjob.cronjob_id}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    {deletingId === cronjob.cronjob_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
