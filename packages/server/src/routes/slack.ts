/**
 * Slack Routes - API endpoints for Slack integration
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { slackService } from '../services/apps/slack/index.js'
import { getSlackToolInfo } from '../services/apps/slack/tools.js'
import {
  getSlackAgentConfig,
  upsertSlackAgentConfig,
  getAllSlackThreadMappings
} from '../services/apps/slack/config-store.js'
import { slackPoller } from '../services/apps/slack/poller.js'

const router = Router()

// Connect to Slack
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { token, teamId } = req.body
    if (!token || !teamId) {
      return res.status(400).json({ error: 'Token and Team ID are required' })
    }
    await slackService.connect(userId, token, teamId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Slack] Connect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect to Slack'
    res.status(500).json({ error: message })
  }
})

// Disconnect from Slack
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    await slackService.disconnect(userId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Slack] Disconnect error:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Get connection status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const status = await slackService.getConnectionStatus(userId)
    res.json(status)
  } catch (error) {
    console.error('[Slack] Status error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get status'
    res.status(500).json({ error: message })
  }
})

// Get available tools
router.get('/tools', requireAuth, async (_req, res) => {
  try {
    res.json(getSlackToolInfo())
  } catch (error) {
    console.error('[Slack] Get tools error:', error)
    res.status(500).json({ error: 'Failed to get tools' })
  }
})

// ============================================
// Agent Configuration Routes
// ============================================

// Get agent configuration
router.get('/agent/config', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const config = await getSlackAgentConfig(userId)
    res.json(config || {
      user_id: userId,
      enabled: 0,
      agent_id: null,
      poll_interval_seconds: 60,
      thread_timeout_seconds: 60
    })
  } catch (error) {
    console.error('[Slack] Get agent config error:', error)
    res.status(500).json({ error: 'Failed to get agent config' })
  }
})

// Update agent configuration
router.patch('/agent/config', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { enabled, agent_id, poll_interval_seconds, thread_timeout_seconds } = req.body

    const updates: Record<string, unknown> = {}
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0
    if (agent_id !== undefined) updates.agent_id = agent_id
    if (poll_interval_seconds !== undefined) updates.poll_interval_seconds = poll_interval_seconds
    if (thread_timeout_seconds !== undefined) updates.thread_timeout_seconds = thread_timeout_seconds

    const config = await upsertSlackAgentConfig(userId, updates)

    // Start or stop polling based on enabled state
    if (config.enabled && config.agent_id && slackService.isConnected(userId)) {
      await slackPoller.start(userId)
    } else {
      slackPoller.stop(userId)
    }

    res.json(config)
  } catch (error) {
    console.error('[Slack] Update agent config error:', error)
    res.status(500).json({ error: 'Failed to update agent config' })
  }
})

// Get thread mappings (for debugging)
router.get('/agent/mappings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const mappings = await getAllSlackThreadMappings(userId)
    res.json(mappings)
  } catch (error) {
    console.error('[Slack] Get thread mappings error:', error)
    res.status(500).json({ error: 'Failed to get thread mappings' })
  }
})

// ============================================
// Polling Control Routes
// ============================================

// Start polling manually
router.post('/polling/start', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId

    if (!slackService.isConnected(userId)) {
      return res.status(400).json({ error: 'Slack not connected' })
    }

    const config = await getSlackAgentConfig(userId)
    if (!config || !config.enabled || !config.agent_id) {
      return res.status(400).json({ error: 'Slack agent not configured' })
    }

    await slackPoller.start(userId)
    res.json({ success: true, polling: true })
  } catch (error) {
    console.error('[Slack] Start polling error:', error)
    res.status(500).json({ error: 'Failed to start polling' })
  }
})

// Stop polling manually
router.post('/polling/stop', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    slackPoller.stop(userId)
    res.json({ success: true, polling: false })
  } catch (error) {
    console.error('[Slack] Stop polling error:', error)
    res.status(500).json({ error: 'Failed to stop polling' })
  }
})

// Get polling status
router.get('/polling/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const polling = slackPoller.isPolling(userId)
    res.json({ polling })
  } catch (error) {
    console.error('[Slack] Get polling status error:', error)
    res.status(500).json({ error: 'Failed to get polling status' })
  }
})

export default router
