import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { AgentIconComponent, AGENT_ICON_LABELS } from '@/lib/agent-icons'
import type { AgentIcon } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Simple label component
function Label({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={`text-sm font-medium leading-none ${className || ''}`}>
      {children}
    </label>
  )
}

const AGENT_ICONS: AgentIcon[] = ['bot', 'sparkles', 'code', 'pen', 'search', 'terminal', 'brain', 'shield']

const AGENT_COLORS = [
  '#8B5CF6', // Purple (default)
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#14B8A6', // Teal
]

interface AgentEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId?: string | null // If provided, editing existing agent
}

export function AgentEditorDialog({ open, onOpenChange, agentId }: AgentEditorDialogProps) {
  const agents = useAppStore((s) => s.agents)
  const createAgent = useAppStore((s) => s.createAgent)
  const updateAgent = useAppStore((s) => s.updateAgent)
  const models = useAppStore((s) => s.models)

  const existingAgent = agentId ? agents.find((a) => a.agent_id === agentId) : null
  const isEditing = !!existingAgent

  const [name, setName] = useState('')
  const [color, setColor] = useState(AGENT_COLORS[0])
  const [icon, setIcon] = useState<AgentIcon>('bot')
  const [modelDefault, setModelDefault] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset form when dialog opens/closes or agent changes
  useEffect(() => {
    if (open) {
      if (existingAgent) {
        setName(existingAgent.name)
        setColor(existingAgent.color)
        setIcon(existingAgent.icon)
        setModelDefault(existingAgent.model_default)
      } else {
        setName('')
        setColor(AGENT_COLORS[0])
        setIcon('bot')
        setModelDefault(models[0]?.id || '')
      }
    }
  }, [open, existingAgent, models])

  const handleSave = async () => {
    if (!name.trim()) return

    setSaving(true)
    try {
      if (isEditing && agentId) {
        await updateAgent(agentId, {
          name: name.trim(),
          color,
          icon,
          model_default: modelDefault,
        })
      } else {
        await createAgent({
          name: name.trim(),
          color,
          icon,
          model_default: modelDefault,
        })
      }
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save agent:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Agent' : 'Create New Agent'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter agent name..."
              autoFocus
            />
          </div>

          {/* Icon */}
          <div className="grid gap-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {AGENT_ICONS.map((iconOption) => (
                <button
                  key={iconOption}
                  type="button"
                  onClick={() => setIcon(iconOption)}
                  className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-colors ${
                    icon === iconOption
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                  title={AGENT_ICON_LABELS[iconOption]}
                >
                  <AgentIconComponent icon={iconOption} size={20} />
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {AGENT_COLORS.map((colorOption) => (
                <button
                  key={colorOption}
                  type="button"
                  onClick={() => setColor(colorOption)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === colorOption
                      ? 'border-white scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: colorOption }}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="grid gap-2">
            <Label>Preview</Label>
            <div className="flex items-center justify-center p-4 rounded-lg bg-background border">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-md"
                style={{
                  backgroundColor: `${color}15`,
                  border: `1px solid ${color}50`,
                  color: color,
                }}
              >
                <AgentIconComponent icon={icon} size={16} />
                <span className="font-bold uppercase tracking-wider text-sm">
                  {name || 'Agent Name'}
                </span>
              </div>
            </div>
          </div>

          {/* Default Model */}
          <div className="grid gap-2">
            <Label htmlFor="model">Default Model</Label>
            <select
              id="model"
              value={modelDefault}
              onChange={(e) => setModelDefault(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id} disabled={!model.available}>
                  {model.name} {!model.available && '(No API Key)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
