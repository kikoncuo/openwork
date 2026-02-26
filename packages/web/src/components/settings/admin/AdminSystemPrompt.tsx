import { useState, useEffect, useCallback } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DEFAULT_HIDDEN_PROMPT_MARKER = '{{USER_PROMPT}}'

export function AdminSystemPrompt() {
  const [prompt, setPrompt] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const fetchPrompt = useCallback(async () => {
    try {
      setLoading(true)
      const data = await window.api.admin.getSystemPrompt()
      setPrompt(data.prompt)
      setDefaultPrompt(data.prompt)
      setIsDirty(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load system prompt'
      setStatus({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrompt()
  }, [fetchPrompt])

  async function handleSave() {
    setSaving(true)
    setStatus(null)

    try {
      if (!prompt.includes(DEFAULT_HIDDEN_PROMPT_MARKER)) {
        setStatus({
          type: 'error',
          message: `The prompt must contain the ${DEFAULT_HIDDEN_PROMPT_MARKER} placeholder. This is where user/agent custom prompts get injected.`
        })
        setSaving(false)
        return
      }

      await window.api.admin.setSystemPrompt(prompt)
      setDefaultPrompt(prompt)
      setIsDirty(false)
      setStatus({ type: 'success', message: 'System prompt saved successfully.' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save system prompt'
      setStatus({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setSaving(true)
    setStatus(null)

    try {
      // Send empty string to reset - server will use DEFAULT_HIDDEN_PROMPT
      // Actually, we need to explicitly set the default. Let's fetch it by resetting.
      // The cleanest approach: delete the setting so the server falls back to default.
      // But we don't have a delete endpoint. Instead, we'll rely on the server returning
      // the default when we GET after saving.
      // For now, let's just refetch the default by clearing the DB setting.
      // We can set the prompt to the default value that the server returns on first load.
      await window.api.admin.setSystemPrompt('')
      // Refetch to get the default
      const data = await window.api.admin.getSystemPrompt()
      setPrompt(data.prompt)
      setDefaultPrompt(data.prompt)
      setIsDirty(false)
      setStatus({ type: 'success', message: 'System prompt reset to default.' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to reset system prompt'
      setStatus({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  function handleChange(value: string) {
    setPrompt(value)
    setIsDirty(value !== defaultPrompt)
    if (status) setStatus(null)
  }

  const hasPlaceholder = prompt.includes(DEFAULT_HIDDEN_PROMPT_MARKER)

  return (
    <div className="space-y-4">
      <div className="text-section-header">SYSTEM PROMPT</div>

      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          This is the hidden system prompt that wraps all agent prompts.
          The <code className="px-1 py-0.5 bg-primary/10 text-primary rounded text-xs font-mono">{DEFAULT_HIDDEN_PROMPT_MARKER}</code> placeholder
          is where each agent's custom prompt (or the default base prompt) gets injected.
        </p>
        <p>
          User/agent custom prompt instructions take precedence over the defaults in this template when there is a conflict.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="size-4 animate-spin" />
          Loading system prompt...
        </div>
      ) : (
        <>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => handleChange(e.target.value)}
              className="w-full h-[500px] px-3 py-2 text-sm font-mono bg-background border border-border rounded-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
              spellCheck={false}
            />
            {!hasPlaceholder && prompt.length > 0 && (
              <div className="absolute bottom-2 right-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
                Missing {DEFAULT_HIDDEN_PROMPT_MARKER} placeholder
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !isDirty || !hasPlaceholder}
            >
              {saving && <Loader2 className="size-4 animate-spin mr-1" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw className="size-3.5 mr-1" />
              Reset to Default
            </Button>
            {isDirty && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </>
      )}

      {status && (
        <div
          className={`text-sm rounded-sm px-3 py-2 ${
            status.type === 'success'
              ? 'text-green-600 bg-green-500/10 border border-green-500/20'
              : 'text-destructive bg-destructive/10 border border-destructive/20'
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  )
}
