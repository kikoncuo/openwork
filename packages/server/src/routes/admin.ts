/**
 * Admin API routes - all protected by requireAdmin middleware
 */

import { Router } from 'express'
import { requireAdmin } from '../middleware/admin.js'
import {
  adminGetStats,
  getAllUsers,
  adminUpdateUser,
  adminDeleteUser,
  getAllTiers,
  adminCreateTier,
  adminUpdateTier,
  adminGetAllThreads,
  adminDeleteThread,
  adminGetAllAgents,
  adminDeleteAgent,
  adminGetAllSkills,
  adminDeleteSkill,
  adminGetAllCronjobs,
  adminDeleteCronjob,
  adminGetAllWebhooks,
  adminDeleteWebhook,
  adminGetAllAppConnections,
  adminGetAllWhatsAppContacts,
  adminGetAllWhatsAppChats,
  adminGetAllRuns,
  adminUpdateRecord,
  getEditableTables,
  adminRunSQL,
  getSystemSetting,
  setSystemSetting,
} from '../services/db/admin.js'
// getDb and saveToDisk removed - using Supabase now
import {
  getAllowedEmails,
  setAllowedEmails,
  addAllowedEmail,
  removeAllowedEmail,
} from '../services/db/allowlist.js'
import { DEFAULT_HIDDEN_PROMPT } from '../services/agent/system-prompt.js'
import { ChatOpenAI } from '@langchain/openai'

const router = Router()

// All admin routes require admin privileges
router.use(requireAdmin)

// ============================================
// Stats
// ============================================

router.get('/stats', async (_req, res) => {
  try {
    const stats = await adminGetStats()
    res.json(stats)
  } catch (error) {
    console.error('[Admin] Get stats error:', error)
    res.status(500).json({ error: 'Failed to get stats' })
  }
})

// ============================================
// Users
// ============================================

router.get('/users', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const users = await getAllUsers(limit, offset)
    // Strip password_hash from response
    const safeUsers = users.map(({ password_hash: _, ...user }) => user)
    res.json(safeUsers)
  } catch (error) {
    console.error('[Admin] Get users error:', error)
    res.status(500).json({ error: 'Failed to get users' })
  }
})

router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { name, tier_id, is_admin } = req.body

    const updates: { name?: string; tier_id?: number; is_admin?: number } = {}
    if (name !== undefined) updates.name = name
    if (tier_id !== undefined) updates.tier_id = Number(tier_id)
    if (is_admin !== undefined) updates.is_admin = is_admin ? 1 : 0

    const user = await adminUpdateUser(userId, updates)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Strip password_hash
    const { password_hash: _, ...safeUser } = user
    res.json(safeUser)
  } catch (error) {
    console.error('[Admin] Update user error:', error)
    res.status(500).json({ error: 'Failed to update user' })
  }
})

router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    // Prevent self-deletion
    if (userId === req.user!.userId) {
      res.status(400).json({ error: 'Cannot delete your own account' })
      return
    }

    const deleted = await adminDeleteUser(userId)
    if (!deleted) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete user error:', error)
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

// ============================================
// Tiers
// ============================================

router.get('/tiers', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const tiers = await getAllTiers(limit, offset)
    res.json(tiers)
  } catch (error) {
    console.error('[Admin] Get tiers error:', error)
    res.status(500).json({ error: 'Failed to get tiers' })
  }
})

router.post('/tiers', async (req, res) => {
  try {
    const { name, display_name, default_model, available_models, features } = req.body

    if (!name || !display_name || !default_model) {
      res.status(400).json({ error: 'name, display_name, and default_model are required' })
      return
    }

    const tier = await adminCreateTier({
      name,
      display_name,
      default_model,
      available_models: available_models || [default_model],
      features: features || { model_selection: false, custom_providers: false },
    })

    res.status(201).json(tier)
  } catch (error) {
    console.error('[Admin] Create tier error:', error)
    res.status(500).json({ error: 'Failed to create tier' })
  }
})

router.patch('/tiers/:tierId', async (req, res) => {
  try {
    const tierId = Number(req.params.tierId)
    const { name, display_name, default_model, available_models, features } = req.body

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (display_name !== undefined) updates.display_name = display_name
    if (default_model !== undefined) updates.default_model = default_model
    if (available_models !== undefined) updates.available_models = available_models
    if (features !== undefined) updates.features = features

    const tier = await adminUpdateTier(tierId, updates as Parameters<typeof adminUpdateTier>[1])
    if (!tier) {
      res.status(404).json({ error: 'Tier not found' })
      return
    }

    res.json(tier)
  } catch (error) {
    console.error('[Admin] Update tier error:', error)
    res.status(500).json({ error: 'Failed to update tier' })
  }
})

// ============================================
// Threads
// ============================================

router.get('/threads', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const threads = await adminGetAllThreads(limit, offset)
    res.json(threads)
  } catch (error) {
    console.error('[Admin] Get threads error:', error)
    res.status(500).json({ error: 'Failed to get threads' })
  }
})

router.delete('/threads/:threadId', async (req, res) => {
  try {
    const deleted = await adminDeleteThread(req.params.threadId)
    if (!deleted) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete thread error:', error)
    res.status(500).json({ error: 'Failed to delete thread' })
  }
})

// ============================================
// Agents
// ============================================

router.get('/agents', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const agents = await adminGetAllAgents(limit, offset)
    res.json(agents)
  } catch (error) {
    console.error('[Admin] Get agents error:', error)
    res.status(500).json({ error: 'Failed to get agents' })
  }
})

router.delete('/agents/:agentId', async (req, res) => {
  try {
    const deleted = await adminDeleteAgent(req.params.agentId)
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete agent error:', error)
    res.status(500).json({ error: 'Failed to delete agent' })
  }
})

// ============================================
// Skills
// ============================================

router.get('/skills', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const skills = await adminGetAllSkills(limit, offset)
    res.json(skills)
  } catch (error) {
    console.error('[Admin] Get skills error:', error)
    res.status(500).json({ error: 'Failed to get skills' })
  }
})

router.delete('/skills/:skillId', async (req, res) => {
  try {
    const deleted = await adminDeleteSkill(req.params.skillId)
    if (!deleted) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete skill error:', error)
    res.status(500).json({ error: 'Failed to delete skill' })
  }
})

// ============================================
// Cronjobs
// ============================================

router.get('/cronjobs', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const cronjobs = await adminGetAllCronjobs(limit, offset)
    res.json(cronjobs)
  } catch (error) {
    console.error('[Admin] Get cronjobs error:', error)
    res.status(500).json({ error: 'Failed to get cronjobs' })
  }
})

router.delete('/cronjobs/:cronjobId', async (req, res) => {
  try {
    const deleted = await adminDeleteCronjob(req.params.cronjobId)
    if (!deleted) {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete cronjob error:', error)
    res.status(500).json({ error: 'Failed to delete cronjob' })
  }
})

// ============================================
// Webhooks
// ============================================

router.get('/webhooks', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const webhooks = await adminGetAllWebhooks(limit, offset)
    res.json(webhooks)
  } catch (error) {
    console.error('[Admin] Get webhooks error:', error)
    res.status(500).json({ error: 'Failed to get webhooks' })
  }
})

router.delete('/webhooks/:webhookId', async (req, res) => {
  try {
    const deleted = await adminDeleteWebhook(req.params.webhookId)
    if (!deleted) {
      res.status(404).json({ error: 'Webhook not found' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] Delete webhook error:', error)
    res.status(500).json({ error: 'Failed to delete webhook' })
  }
})

// ============================================
// App Connections
// ============================================

router.get('/connections', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const connections = await adminGetAllAppConnections(limit, offset)
    res.json(connections)
  } catch (error) {
    console.error('[Admin] Get connections error:', error)
    res.status(500).json({ error: 'Failed to get connections' })
  }
})

// ============================================
// WhatsApp
// ============================================

router.get('/whatsapp/contacts', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const contacts = await adminGetAllWhatsAppContacts(limit, offset)
    res.json(contacts)
  } catch (error) {
    console.error('[Admin] Get WhatsApp contacts error:', error)
    res.status(500).json({ error: 'Failed to get WhatsApp contacts' })
  }
})

router.get('/whatsapp/chats', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const chats = await adminGetAllWhatsAppChats(limit, offset)
    res.json(chats)
  } catch (error) {
    console.error('[Admin] Get WhatsApp chats error:', error)
    res.status(500).json({ error: 'Failed to get WhatsApp chats' })
  }
})

// ============================================
// Runs
// ============================================

router.get('/runs', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const offset = Number(req.query.offset) || 0
    const runs = await adminGetAllRuns(limit, offset)
    res.json(runs)
  } catch (error) {
    console.error('[Admin] Get runs error:', error)
    res.status(500).json({ error: 'Failed to get runs' })
  }
})

// ============================================
// Generic Record Update
// ============================================

router.patch('/records/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params
    const { updates } = req.body

    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'updates object is required' })
      return
    }

    if (!getEditableTables().includes(table)) {
      res.status(400).json({ error: `Table '${table}' is not editable` })
      return
    }

    const result = await adminUpdateRecord(table, id, updates)
    if (!result) {
      res.status(404).json({ error: 'Record not found' })
      return
    }

    res.json(result)
  } catch (error) {
    console.error('[Admin] Update record error:', error)
    res.status(500).json({ error: 'Failed to update record' })
  }
})

// ============================================
// System Prompt
// ============================================

router.get('/system-prompt', async (_req, res) => {
  try {
    const prompt = await getSystemSetting('system_prompt') || DEFAULT_HIDDEN_PROMPT
    res.json({ prompt })
  } catch (error) {
    console.error('[Admin] Get system prompt error:', error)
    res.status(500).json({ error: 'Failed to get system prompt' })
  }
})

router.put('/system-prompt', async (req, res) => {
  try {
    const { prompt } = req.body
    if (typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt string is required' })
      return
    }
    if (prompt === '') {
      // Empty string means reset to default — delete the setting
      // so getSystemSetting returns null and the fallback kicks in
      await adminRunSQL("DELETE FROM system_settings WHERE key = 'system_prompt'")
    } else {
      await setSystemSetting('system_prompt', prompt)
    }
    // Return the effective prompt (either saved or default fallback)
    const effectivePrompt = await getSystemSetting('system_prompt') || DEFAULT_HIDDEN_PROMPT
    res.json({ prompt: effectivePrompt })
  } catch (error) {
    console.error('[Admin] Set system prompt error:', error)
    res.status(500).json({ error: 'Failed to set system prompt' })
  }
})

// ============================================
// OpenRouter
// ============================================

router.get('/openrouter', async (_req, res) => {
  try {
    const raw = await getSystemSetting('openrouter_config')
    const config = raw ? JSON.parse(raw) : { enabled: false, tier_models: {}, reasoning_tiers: [], provider_order: [], allow_fallbacks: true }
    res.json({ ...config, hasApiKey: !!process.env.OPENROUTER_API_KEY })
  } catch (error) {
    console.error('[Admin] Get OpenRouter config error:', error)
    res.status(500).json({ error: 'Failed to get OpenRouter config' })
  }
})

router.put('/openrouter', async (req, res) => {
  try {
    const { enabled, tier_models, reasoning_tiers, provider_order, allow_fallbacks } = req.body
    const config = {
      enabled: !!enabled,
      tier_models: tier_models || {},
      reasoning_tiers: reasoning_tiers || [],
      provider_order: provider_order || [],
      allow_fallbacks: allow_fallbacks !== false,
    }
    await setSystemSetting('openrouter_config', JSON.stringify(config))
    res.json({ ...config, hasApiKey: !!process.env.OPENROUTER_API_KEY })
  } catch (error) {
    console.error('[Admin] Set OpenRouter config error:', error)
    res.status(500).json({ error: 'Failed to set OpenRouter config' })
  }
})

router.post('/openrouter/test', async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      res.json({ success: false, error: 'OPENROUTER_API_KEY not set in .env' })
      return
    }
    const { model } = req.body
    const testModel = model || 'openai/gpt-4o-mini'
    const llm = new ChatOpenAI({
      model: testModel,
      apiKey: apiKey,
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
      maxTokens: 10,
    })
    const result = await llm.invoke('Say "hello" in one word.')
    res.json({ success: true, model: testModel, response: result.content })
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

// ============================================
// Email Allowlist
// ============================================

router.get('/allowlist', async (_req, res) => {
  try {
    const emails = await getAllowedEmails()
    res.json({ emails })
  } catch (error) {
    console.error('[Admin] Get allowlist error:', error)
    res.status(500).json({ error: 'Failed to get allowlist' })
  }
})

router.put('/allowlist', async (req, res) => {
  try {
    const { emails } = req.body
    if (!Array.isArray(emails)) {
      res.status(400).json({ error: 'emails array is required' })
      return
    }
    await setAllowedEmails(emails)
    const updated = await getAllowedEmails()
    res.json({ emails: updated })
  } catch (error) {
    console.error('[Admin] Set allowlist error:', error)
    res.status(500).json({ error: 'Failed to set allowlist' })
  }
})

router.post('/allowlist', async (req, res) => {
  try {
    const { email } = req.body
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'email string is required' })
      return
    }
    const emails = await addAllowedEmail(email)
    res.json({ emails })
  } catch (error) {
    console.error('[Admin] Add to allowlist error:', error)
    res.status(500).json({ error: 'Failed to add email to allowlist' })
  }
})

router.delete('/allowlist/:email', async (req, res) => {
  try {
    const { email } = req.params
    const emails = await removeAllowedEmail(decodeURIComponent(email))
    res.json({ emails })
  } catch (error) {
    console.error('[Admin] Remove from allowlist error:', error)
    res.status(500).json({ error: 'Failed to remove email from allowlist' })
  }
})

// ============================================
// SQL Runner
// ============================================

router.post('/sql', async (req, res) => {
  try {
    const { query } = req.body

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query string is required' })
      return
    }

    const result = await adminRunSQL(query)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SQL execution failed'
    console.error('[Admin] SQL error:', error)
    res.status(400).json({ error: message })
  }
})

export default router
