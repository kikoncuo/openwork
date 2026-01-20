import { Router } from 'express'
import {
  getApiKey,
  setApiKey,
  deleteApiKey,
  hasApiKey
} from '../services/storage.js'
import { getDefaultModel, setDefaultModel } from '../services/settings.js'
import type { ModelConfig, Provider } from '../services/types.js'

const router = Router()

// Provider configurations
const PROVIDERS: Omit<Provider, 'hasApiKey'>[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'google', name: 'Google' }
]

// Available models configuration (updated Jan 2026)
const AVAILABLE_MODELS: ModelConfig[] = [
  // Anthropic Claude 4.5 series
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    description: 'Premium model with maximum intelligence',
    available: true
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    description: 'Best balance of intelligence, speed, and cost for agents',
    available: true
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    description: 'Fastest model with near-frontier intelligence',
    available: true
  },
  // Anthropic Claude legacy models
  {
    id: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    model: 'claude-opus-4-1-20250805',
    description: 'Previous generation premium model with extended thinking',
    available: true
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    description: 'Fast and capable previous generation model',
    available: true
  },
  // OpenAI GPT-5 series
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    model: 'gpt-5.2',
    description: 'Latest flagship with enhanced coding and agentic capabilities',
    available: true
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    model: 'gpt-5.1',
    description: 'Advanced reasoning and robust performance',
    available: true
  },
  // OpenAI o-series
  {
    id: 'o3',
    name: 'o3',
    provider: 'openai',
    model: 'o3',
    description: 'Advanced reasoning for complex problem-solving',
    available: true
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    model: 'o3-mini',
    description: 'Cost-effective reasoning with faster response times',
    available: true
  },
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    model: 'o4-mini',
    description: 'Fast, efficient reasoning model succeeding o3',
    available: true
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    model: 'o1',
    description: 'Premium reasoning for research, coding, math and science',
    available: true
  },
  // OpenAI GPT-4 series
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    model: 'gpt-4.1',
    description: 'Strong instruction-following with 1M context window',
    available: true
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    description: 'Faster, smaller version balancing performance and efficiency',
    available: true
  },
  {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'openai',
    model: 'gpt-4.1-nano',
    description: 'Most cost-efficient for lighter tasks',
    available: true
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    description: 'Versatile model for text generation and comprehension',
    available: true
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    description: 'Cost-efficient variant with faster response times',
    available: true
  },
  // Google Gemini models
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    provider: 'google',
    model: 'gemini-3-pro-preview',
    description: 'State-of-the-art reasoning and multimodal understanding',
    available: true
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'google',
    model: 'gemini-3-flash-preview',
    description: 'Fast frontier-class model with low latency and cost',
    available: true
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    model: 'gemini-2.5-pro',
    description: 'High-capability model for complex reasoning and coding',
    available: true
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    model: 'gemini-2.5-flash',
    description: 'Lightning-fast with balance of intelligence and latency',
    available: true
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    description: 'Fast, low-cost, high-performance model',
    available: true
  }
]

// List available models
router.get('/', async (_req, res) => {
  try {
    const models = AVAILABLE_MODELS.map((model) => ({
      ...model,
      available: hasApiKey(model.provider)
    }))
    res.json(models)
  } catch (error) {
    console.error('[Models] List error:', error)
    res.status(500).json({ error: 'Failed to list models' })
  }
})

// List providers
router.get('/providers', async (_req, res) => {
  try {
    const providers = PROVIDERS.map((provider) => ({
      ...provider,
      hasApiKey: hasApiKey(provider.id)
    }))
    res.json(providers)
  } catch (error) {
    console.error('[Models] List providers error:', error)
    res.status(500).json({ error: 'Failed to list providers' })
  }
})

// Get default model
router.get('/default', async (_req, res) => {
  try {
    res.json({ modelId: getDefaultModel() })
  } catch (error) {
    console.error('[Models] Get default error:', error)
    res.status(500).json({ error: 'Failed to get default model' })
  }
})

// Set default model
router.put('/default', async (req, res) => {
  try {
    const { modelId } = req.body
    setDefaultModel(modelId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Models] Set default error:', error)
    res.status(500).json({ error: 'Failed to set default model' })
  }
})

// Get API key for a provider
router.get('/providers/:providerId/key', async (req, res) => {
  try {
    const apiKey = getApiKey(req.params.providerId)
    res.json({ apiKey: apiKey ?? null })
  } catch (error) {
    console.error('[Models] Get API key error:', error)
    res.status(500).json({ error: 'Failed to get API key' })
  }
})

// Set API key for a provider
router.put('/providers/:providerId/key', async (req, res) => {
  try {
    const { apiKey } = req.body
    setApiKey(req.params.providerId, apiKey)
    res.json({ success: true })
  } catch (error) {
    console.error('[Models] Set API key error:', error)
    res.status(500).json({ error: 'Failed to set API key' })
  }
})

// Delete API key for a provider
router.delete('/providers/:providerId/key', async (req, res) => {
  try {
    deleteApiKey(req.params.providerId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Models] Delete API key error:', error)
    res.status(500).json({ error: 'Failed to delete API key' })
  }
})

export default router
