import { Router } from 'express'
import { whatsappService } from '../services/apps/whatsapp/index.js'
import { getWhatsAppToolInfo } from '../services/apps/whatsapp/tools.js'
import {
  getWhatsAppAgentConfig,
  upsertWhatsAppAgentConfig,
  getAllThreadMappings
} from '../services/apps/whatsapp/config-store.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Connect to WhatsApp
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const qr = await whatsappService.connect(userId)
    res.json({ qr })
  } catch (error) {
    console.error('[WhatsApp] Connect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect to WhatsApp'
    res.status(500).json({ error: message })
  }
})

// Disconnect from WhatsApp
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    await whatsappService.disconnect(userId)
    res.json({ success: true })
  } catch (error) {
    console.error('[WhatsApp] Disconnect error:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Get connection status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    res.json(whatsappService.getConnectionStatus(userId))
  } catch (error) {
    console.error('[WhatsApp] Status error:', error)
    res.status(500).json({ error: 'Failed to get status' })
  }
})

// Get contacts
router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const query = req.query.query as string | undefined
    res.json(whatsappService.getContacts(userId, query))
  } catch (error) {
    console.error('[WhatsApp] Get contacts error:', error)
    res.status(500).json({ error: 'Failed to get contacts' })
  }
})

// Get chats
router.get('/chats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    res.json(whatsappService.getChats(userId, limit))
  } catch (error) {
    console.error('[WhatsApp] Get chats error:', error)
    res.status(500).json({ error: 'Failed to get chats' })
  }
})

// Search messages
router.get('/messages/search', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    // Handle query parameters - they can be string, string[], ParsedQs, or ParsedQs[]
    const queryParam = req.query.query
    const query = Array.isArray(queryParam) ? String(queryParam[0] || '') : String(queryParam || '')

    const chatJidParam = req.query.chatJid
    const chatJid = chatJidParam ? (Array.isArray(chatJidParam) ? String(chatJidParam[0]) : String(chatJidParam)) : undefined

    const limitParam = req.query.limit
    const limit = limitParam ? parseInt(Array.isArray(limitParam) ? String(limitParam[0]) : String(limitParam), 10) : undefined

    res.json(whatsappService.searchMessages(userId, query, chatJid, limit))
  } catch (error) {
    console.error('[WhatsApp] Search messages error:', error)
    res.status(500).json({ error: 'Failed to search messages' })
  }
})

// Get chat message history
router.get('/chats/:jid/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const jid = decodeURIComponent(String(req.params.jid))
    const limitParam = req.query.limit
    const limit = limitParam ? parseInt(Array.isArray(limitParam) ? String(limitParam[0]) : String(limitParam), 10) : undefined
    res.json(whatsappService.getMessageHistory(userId, jid, limit))
  } catch (error) {
    console.error('[WhatsApp] Get history error:', error)
    res.status(500).json({ error: 'Failed to get message history' })
  }
})

// Send message
router.post('/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { to, text } = req.body
    const result = await whatsappService.sendMessage(userId, to, text)
    res.json(result)
  } catch (error) {
    console.error('[WhatsApp] Send message error:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// Get tools info
router.get('/tools', requireAuth, async (req, res) => {
  try {
    res.json(getWhatsAppToolInfo())
  } catch (error) {
    console.error('[WhatsApp] Get tools error:', error)
    res.status(500).json({ error: 'Failed to get tools' })
  }
})

// ============================================
// WhatsApp Agent Configuration Routes
// ============================================

// Get agent configuration
router.get('/agent/config', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const config = getWhatsAppAgentConfig(userId)
    if (!config) {
      // Return default config if not set
      res.json({
        enabled: false,
        agent_id: null,
        thread_timeout_minutes: 30,
        workspace_path: null
      })
    } else {
      res.json({
        enabled: !!config.enabled,
        agent_id: config.agent_id,
        thread_timeout_minutes: config.thread_timeout_minutes,
        workspace_path: config.workspace_path
      })
    }
  } catch (error) {
    console.error('[WhatsApp] Get agent config error:', error)
    res.status(500).json({ error: 'Failed to get agent config' })
  }
})

// Update agent configuration
router.patch('/agent/config', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { enabled, agent_id, thread_timeout_minutes, workspace_path } = req.body

    const updates: {
      enabled?: number
      agent_id?: string | null
      thread_timeout_minutes?: number
      workspace_path?: string | null
    } = {}

    if (enabled !== undefined) {
      updates.enabled = enabled ? 1 : 0
    }
    if (agent_id !== undefined) {
      updates.agent_id = agent_id
    }
    if (thread_timeout_minutes !== undefined) {
      updates.thread_timeout_minutes = thread_timeout_minutes
    }
    if (workspace_path !== undefined) {
      updates.workspace_path = workspace_path
    }

    const config = upsertWhatsAppAgentConfig(userId, updates)
    res.json({
      enabled: !!config.enabled,
      agent_id: config.agent_id,
      thread_timeout_minutes: config.thread_timeout_minutes,
      workspace_path: config.workspace_path
    })
  } catch (error) {
    console.error('[WhatsApp] Update agent config error:', error)
    res.status(500).json({ error: 'Failed to update agent config' })
  }
})

// Get thread mappings (for debugging/admin purposes)
router.get('/agent/mappings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const mappings = getAllThreadMappings(userId)
    res.json(mappings)
  } catch (error) {
    console.error('[WhatsApp] Get thread mappings error:', error)
    res.status(500).json({ error: 'Failed to get thread mappings' })
  }
})

export default router
