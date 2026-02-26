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
  getAgentToolConfigs,
  saveAgentToolConfigs,
  AGENT_ICONS,
  AGENT_COLORS,
  type CreateAgentInput,
  type UpdateAgentInput,
  type UpdateAgentConfigInput,
  type ToolConfigInput
} from '../services/db/agents.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Apply requireAuth to all routes
router.use(requireAuth)

// List all agents for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agents = await getAgentsByUserId(userId)
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
    let agent = await getDefaultAgentForUser(userId)

    // If no default agent, create one
    if (!agent) {
      agent = await createAgent({
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
    const agent = await getAgent(req.params.agentId)
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
    const agent = await getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const count = await getAgentThreadCount(req.params.agentId)
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
    const agent = await getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const config = await getAgentConfig(req.params.agentId)
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
    const agent = await getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const updates: UpdateAgentConfigInput = req.body
    const config = await updateAgentConfig(req.params.agentId, updates)
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
    const agent = await createAgent(input)
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
    const existing = await getAgent(req.params.agentId)
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const updates: UpdateAgentInput = req.body
    const agent = await updateAgent(req.params.agentId, updates)
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
    const existing = await getAgent(req.params.agentId)
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const result = await deleteAgent(req.params.agentId)
    res.json(result)
  } catch (error) {
    console.error('[Agents] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete agent' })
  }
})

// Get agent tool configs
router.get('/:agentId/tools', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = await getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    const configs = await getAgentToolConfigs(req.params.agentId)
    // Convert to a simpler format for frontend
    res.json(configs.map(c => ({
      id: c.tool_id,
      enabled: c.enabled === 1,
      requireApproval: c.require_approval === 1
    })))
  } catch (error) {
    console.error('[Agents] Get tool configs error:', error)
    res.status(500).json({ error: 'Failed to get tool configs' })
  }
})

// Save agent tool configs (bulk update)
router.put('/:agentId/tools', async (req, res) => {
  try {
    const userId = req.user!.userId
    const agent = await getAgent(req.params.agentId)
    if (!agent || agent.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Expected format: Array<{ id: string; enabled: boolean; requireApproval?: boolean }>
    const configs = req.body as Array<{ id: string; enabled: boolean; requireApproval?: boolean }>
    const toolConfigs: ToolConfigInput[] = configs.map(c => ({
      tool_id: c.id,
      enabled: c.enabled,
      require_approval: c.requireApproval ?? false
    }))

    const saved = await saveAgentToolConfigs(req.params.agentId, toolConfigs)

    // Return in frontend-friendly format
    res.json(saved.map(c => ({
      id: c.tool_id,
      enabled: c.enabled === 1,
      requireApproval: c.require_approval === 1
    })))
  } catch (error) {
    console.error('[Agents] Save tool configs error:', error)
    res.status(500).json({ error: 'Failed to save tool configs' })
  }
})

export default router
