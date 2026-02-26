import { useState, useEffect, useCallback } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AdminTier } from '@/types'

interface OpenRouterConfig {
  enabled: boolean
  tier_models: Record<string, string>
  reasoning_tiers: number[]
  provider_order: string[]
  allow_fallbacks: boolean
  hasApiKey: boolean
}

export function AdminOpenRouter() {
  const [config, setConfig] = useState<OpenRouterConfig>({
    enabled: false,
    tier_models: {},
    reasoning_tiers: [],
    provider_order: [],
    allow_fallbacks: true,
    hasApiKey: false,
  })
  const [tiers, setTiers] = useState<AdminTier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [orConfig, tierList] = await Promise.all([
        window.api.admin.getOpenRouter(),
        window.api.admin.getTiers(),
      ])
      setConfig(orConfig)
      setTiers(tierList)
      setIsDirty(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load OpenRouter config'
      setStatus({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function updateConfig(partial: Partial<OpenRouterConfig>) {
    const updated = { ...config, ...partial }
    setConfig(updated)
    setIsDirty(true)
    if (status) setStatus(null)
  }

  function setTierModel(tierId: number, model: string) {
    const tier_models = { ...config.tier_models }
    if (model.trim() === '') {
      delete tier_models[String(tierId)]
    } else {
      tier_models[String(tierId)] = model.trim()
    }
    updateConfig({ tier_models })
  }

  function toggleReasoning(tierId: number) {
    const reasoning_tiers = config.reasoning_tiers.includes(tierId)
      ? config.reasoning_tiers.filter((id) => id !== tierId)
      : [...config.reasoning_tiers, tierId]
    updateConfig({ reasoning_tiers })
  }

  async function handleSave() {
    setSaving(true)
    setStatus(null)
    try {
      const result = await window.api.admin.setOpenRouter({
        enabled: config.enabled,
        tier_models: config.tier_models,
        reasoning_tiers: config.reasoning_tiers,
        provider_order: config.provider_order,
        allow_fallbacks: config.allow_fallbacks,
      })
      setConfig(result)
      setIsDirty(false)
      setStatus({ type: 'success', message: 'OpenRouter configuration saved.' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save config'
      setStatus({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setStatus(null)
    try {
      const firstModel = Object.values(config.tier_models).find((m) => m.trim() !== '')
      const result = await window.api.admin.testOpenRouter(firstModel)
      if (result.success) {
        setStatus({
          type: 'success',
          message: `Test passed. Model: ${result.model} responded: "${result.response}"`,
        })
      } else {
        setStatus({ type: 'error', message: `Test failed: ${result.error}` })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Test request failed'
      setStatus({ type: 'error', message: msg })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" />
        Loading OpenRouter configuration...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-section-header">OPENROUTER</div>

      <div className="text-sm text-muted-foreground">
        Route tier models through OpenRouter. Configure which OpenRouter model each tier should use.
        Reasoning models (e.g., DeepSeek R1) use a specialized provider to capture reasoning tokens.
      </div>

      {/* API Key Status */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block size-2 rounded-full ${config.hasApiKey ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-muted-foreground">
          OPENROUTER_API_KEY: {config.hasApiKey ? 'Configured' : 'Not set in .env'}
        </span>
      </div>

      {/* Enable Toggle */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => updateConfig({ enabled: e.target.checked })}
          className="rounded border-border"
        />
        Enable OpenRouter routing
      </label>

      {/* Per-Tier Configuration Table */}
      <div className="border border-border rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tier</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">OpenRouter Model</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.tier_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  <div>{tier.display_name}</div>
                  <div className="text-xs text-muted-foreground">Default: {tier.default_model}</div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={config.tier_models[String(tier.tier_id)] || ''}
                    onChange={(e) => setTierModel(tier.tier_id, e.target.value)}
                    placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                    className="w-full px-2 py-1 text-sm bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={config.reasoning_tiers.includes(tier.tier_id)}
                    onChange={() => toggleReasoning(tier.tier_id)}
                    className="rounded border-border"
                  />
                </td>
              </tr>
            ))}
            {tiers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                  No tiers configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Provider Routing */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">Provider Routing</div>
        <div className="text-xs text-muted-foreground">
          Specify preferred provider order for OpenRouter. Models are routed to the first available provider in order.
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Provider order (comma-separated, e.g. Anthropic, OpenAI, Together)
          </label>
          <input
            type="text"
            value={(config.provider_order || []).join(', ')}
            onChange={(e) => {
              const order = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              updateConfig({ provider_order: order })
            }}
            placeholder="e.g. Anthropic, OpenAI, Together"
            className="w-full px-2 py-1 text-sm bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={config.allow_fallbacks !== false}
            onChange={(e) => updateConfig({ allow_fallbacks: e.target.checked })}
            className="rounded border-border"
          />
          Allow fallbacks to other providers
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !isDirty}
        >
          {saving && <Loader2 className="size-4 animate-spin mr-1" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={testing || !config.hasApiKey}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin mr-1" />
          ) : (
            <Zap className="size-3.5 mr-1" />
          )}
          Test Connection
        </Button>
        {isDirty && (
          <span className="text-xs text-muted-foreground">
            Unsaved changes
          </span>
        )}
      </div>

      {/* Status Message */}
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
