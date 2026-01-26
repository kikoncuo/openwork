import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import {
  getAllThreads,
  getThread,
  createThread as dbCreateThread,
  updateThread as dbUpdateThread,
  deleteThread as dbDeleteThread,
  getThreadsByUserId
} from '../services/db/index.js'
import { getAgent, getDefaultAgent, getAgentsByUserId, getDefaultAgentForUser } from '../services/db/agents.js'
import { getCheckpointer, closeCheckpointer } from '../services/agent/runtime.js'
import { deleteThreadCheckpoint } from '../services/storage.js'
import { generateTitle } from '../services/misc/title-generator.js'
import { requireAuth } from '../middleware/auth.js'
import type { Thread } from '../services/types.js'

const router = Router()

// Apply requireAuth to all routes
router.use(requireAuth)

// List all threads for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const threads = getThreadsByUserId(userId)
    const result = threads.map((row) => ({
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread['status'],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title,
      agent_id: row.agent_id,
      user_id: row.user_id,
      e2b_sandbox_id: row.e2b_sandbox_id,
      source: row.source || 'chat',
      whatsapp_jid: row.whatsapp_jid || null,
      whatsapp_contact_name: row.whatsapp_contact_name || null
    }))
    res.json(result)
  } catch (error) {
    console.error('[Threads] List error:', error)
    res.status(500).json({ error: 'Failed to list threads' })
  }
})

// Get a single thread
router.get('/:threadId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const row = getThread(req.params.threadId)
    if (!row) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    // Check ownership
    if (row.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }
    res.json({
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread['status'],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title,
      agent_id: row.agent_id,
      user_id: row.user_id,
      e2b_sandbox_id: row.e2b_sandbox_id,
      source: row.source || 'chat',
      whatsapp_jid: row.whatsapp_jid || null,
      whatsapp_contact_name: row.whatsapp_contact_name || null
    })
  } catch (error) {
    console.error('[Threads] Get error:', error)
    res.status(500).json({ error: 'Failed to get thread' })
  }
})

// Create a new thread
router.post('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { metadata, agentId } = req.body
    const threadId = uuid()
    const title = (metadata?.title as string) || `Thread ${new Date().toLocaleDateString()}`

    // Get the agent (must belong to user)
    let agent = agentId ? getAgent(agentId) : null
    if (agent && agent.user_id !== userId) {
      res.status(403).json({ error: 'Cannot create thread with agent from another user' })
      return
    }
    if (!agent) {
      // Get user's default agent, or create one if none exists
      agent = getDefaultAgentForUser(userId)
      if (!agent) {
        // Create a default agent for this user
        const { createAgent: createAgentFn } = await import('../services/db/agents.js')
        agent = createAgentFn({
          name: 'BUDDY',
          color: '#8B5CF6',
          icon: 'bot',
          is_default: true,
          user_id: userId
        })
      }
    }

    // Thread metadata (no workspacePath needed - E2B sandbox handles files)
    const finalMetadata = {
      ...metadata,
      title
    }

    const thread = dbCreateThread(threadId, finalMetadata, agent?.agent_id, userId)

    res.json({
      thread_id: thread.thread_id,
      created_at: new Date(thread.created_at),
      updated_at: new Date(thread.updated_at),
      metadata: thread.metadata ? JSON.parse(thread.metadata) : undefined,
      status: thread.status as Thread['status'],
      thread_values: thread.thread_values ? JSON.parse(thread.thread_values) : undefined,
      title,
      agent_id: thread.agent_id,
      user_id: thread.user_id,
      e2b_sandbox_id: thread.e2b_sandbox_id,
      source: thread.source || 'chat',
      whatsapp_jid: thread.whatsapp_jid || null,
      whatsapp_contact_name: thread.whatsapp_contact_name || null
    })
  } catch (error) {
    console.error('[Threads] Create error:', error)
    res.status(500).json({ error: 'Failed to create thread' })
  }
})

// Update a thread
router.patch('/:threadId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { threadId } = req.params
    const updates = req.body

    // Check ownership first
    const existing = getThread(threadId)
    if (!existing) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const updateData: Parameters<typeof dbUpdateThread>[1] = {}

    if (updates.title !== undefined) updateData.title = updates.title
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata)
    if (updates.thread_values !== undefined) updateData.thread_values = JSON.stringify(updates.thread_values)
    if (updates.agent_id !== undefined) updateData.agent_id = updates.agent_id
    if (updates.e2b_sandbox_id !== undefined) updateData.e2b_sandbox_id = updates.e2b_sandbox_id

    const row = dbUpdateThread(threadId, updateData)
    if (!row) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }

    res.json({
      thread_id: row.thread_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      status: row.status as Thread['status'],
      thread_values: row.thread_values ? JSON.parse(row.thread_values) : undefined,
      title: row.title,
      agent_id: row.agent_id,
      user_id: row.user_id,
      e2b_sandbox_id: row.e2b_sandbox_id,
      source: row.source || 'chat',
      whatsapp_jid: row.whatsapp_jid || null,
      whatsapp_contact_name: row.whatsapp_contact_name || null
    })
  } catch (error) {
    console.error('[Threads] Update error:', error)
    res.status(500).json({ error: 'Failed to update thread' })
  }
})

// Delete a thread
router.delete('/:threadId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { threadId } = req.params
    console.log('[Threads] Deleting thread:', threadId)

    // Check ownership first
    const existing = getThread(threadId)
    if (!existing) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    // Delete from our metadata store
    dbDeleteThread(threadId)
    console.log('[Threads] Deleted from metadata store')

    // Close any open checkpointer for this thread
    try {
      await closeCheckpointer(threadId)
      console.log('[Threads] Closed checkpointer')
    } catch (e) {
      console.warn('[Threads] Failed to close checkpointer:', e)
    }

    // Delete the thread's checkpoint file
    try {
      deleteThreadCheckpoint(threadId)
      console.log('[Threads] Deleted checkpoint file')
    } catch (e) {
      console.warn('[Threads] Failed to delete checkpoint file:', e)
    }

    res.status(204).send()
  } catch (error) {
    console.error('[Threads] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete thread' })
  }
})

// Get thread history (checkpoints)
router.get('/:threadId/history', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { threadId } = req.params

    // Check ownership
    const existing = getThread(threadId)
    if (!existing) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const checkpointer = await getCheckpointer(threadId)

    const history: unknown[] = []
    const config = { configurable: { thread_id: threadId } }

    for await (const checkpoint of checkpointer.list(config, { limit: 50 })) {
      history.push(checkpoint)
    }

    res.json(history)
  } catch (e) {
    console.warn('Failed to get thread history:', e)
    res.json([])
  }
})

// Get thread state (messages, todos, etc.) from the latest checkpoint
router.get('/:threadId/state', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { threadId } = req.params

    // Check ownership
    const existing = getThread(threadId)
    if (!existing) {
      res.status(404).json({ error: 'Thread not found' })
      return
    }
    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const checkpointer = await getCheckpointer(threadId)
    const config = { configurable: { thread_id: threadId } }

    // Get the latest checkpoint tuple
    const checkpointTuple = await checkpointer.getTuple(config)

    if (!checkpointTuple?.checkpoint?.channel_values) {
      res.json({ messages: [], todos: [] })
      return
    }

    const channelValues = checkpointTuple.checkpoint.channel_values as Record<string, unknown>

    // Extract messages and todos from the channel values
    const messages = channelValues.messages || []
    const todos = channelValues.todos || []

    res.json({ messages, todos })
  } catch (e) {
    console.warn('Failed to get thread state:', e)
    res.json({ messages: [], todos: [] })
  }
})

// Generate a title from a message
router.post('/generate-title', async (req, res) => {
  try {
    const { message } = req.body
    const title = await generateTitle(message)
    res.json({ title })
  } catch (error) {
    console.error('[Threads] Generate title error:', error)
    res.status(500).json({ error: 'Failed to generate title' })
  }
})

export default router
