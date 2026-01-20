import { Router } from 'express'
import {
  getAllAgents,
  getAgent,
  getDefaultAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentConfig,
  updateAgentConfig,
  getAgentThreadCount,
  getAgentsByUserId,
  getDefaultAgentForUser,
  AGENT_ICONS,
  AGENT_COLORS,
  type CreateAgentInput,
  type UpdateAgentInput,
  type UpdateAgentConfigInput
} from '../services/db/agents.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Apply requireAuth to all routes
router.use(requireAuth)

// List all agents for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agents = getAgentsByUserId(userId)
    res.json(agents)
  } catch (error) {
    console.error('[Agents] List error:', error)
    res.status(500).json({ error: 'Failed to list agents' })
  }
})

// Get icons list
router.get('/icons', async (_req, res) => {
  res.json(AGENT_ICONS)
})

// Get colors list
router.get('/colors', async (_req, res) => {
  res.json(AGENT_COLORS)
})

// Get default agent for the authenticated user
router.get('/default', async (req, res) => {
  try {
    const userId = req.user!.userId
    let agent = getDefaultAgentForUser(userId)

    // If no default agent, create one
    if (!agent) {
      agent = createAgent({
        name: 'BUDDY',
        color: '#8B5CF6',
        icon: 'bot',
        is_default: true,
        user_id: userId
      })
    }

    res.json(agent)
  } catch (error) {
    console.error('[Agents] Get default error:', error)
    res.status(500).json({ error: 'Failed to get default agent' })
  }
})

// Get a single agent
router.get('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = getAgent(req.params.agentId)
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    // Check ownership
    if (agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    res.json(agent)
  } catch (error) {
    console.error('[Agents] Get error:', error)
    res.status(500).json({ error: 'Failed to get agent' })
  }
})

// Get agent thread count
router.get('/:agentId/thread-count', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const count = getAgentThreadCount(req.params.agentId)
    res.json({ count })
  } catch (error) {
    console.error('[Agents] Thread count error:', error)
    res.status(500).json({ error: 'Failed to get thread count' })
  }
})

// Get agent config
router.get('/:agentId/config', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const config = getAgentConfig(req.params.agentId)
    res.json(config)
  } catch (error) {
    console.error('[Agents] Get config error:', error)
    res.status(500).json({ error: 'Failed to get agent config' })
  }
})

// Update agent config
router.patch('/:agentId/config', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const updates: UpdateAgentConfigInput = req.body
    const config = updateAgentConfig(req.params.agentId, updates)
    res.json(config)
  } catch (error) {
    console.error('[Agents] Update config error:', error)
    res.status(500).json({ error: 'Failed to update agent config' })
  }
})

// Create a new agent
router.post('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const input: CreateAgentInput = {
      ...req.body,
      user_id: userId // Always set user_id from auth
    }
    const agent = createAgent(input)
    res.json(agent)
  } catch (error) {
    console.error('[Agents] Create error:', error)
    res.status(500).json({ error: 'Failed to create agent' })
  }
})

// Update an agent
router.patch('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const existing = getAgent(req.params.agentId)
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const updates: UpdateAgentInput = req.body
    const agent = updateAgent(req.params.agentId, updates)
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    res.json(agent)
  } catch (error) {
    console.error('[Agents] Update error:', error)
    res.status(500).json({ error: 'Failed to update agent' })
  }
})

// Delete an agent
router.delete('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const existing = getAgent(req.params.agentId)
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const result = deleteAgent(req.params.agentId)
    res.json(result)
  } catch (error) {
    console.error('[Agents] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete agent' })
  }
})

export default router
