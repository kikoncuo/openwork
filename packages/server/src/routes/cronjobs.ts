/**
 * Cronjobs API routes
 * Manages scheduled agent invocations
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  createCronjob,
  listCronjobs,
  getCronjobById,
  updateCronjob,
  deleteCronjob,
  toggleCronjob,
  triggerCronjob,
  testCronjobConfig,
  validateCron
} from '../services/cronjobs/index.js'

const router = Router()

// Apply requireAuth to all routes
router.use(requireAuth)

/**
 * GET /cronjobs
 * List all cronjobs for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const cronjobs = listCronjobs(userId)
    res.json(cronjobs)
  } catch (error) {
    console.error('[Cronjobs] List error:', error)
    res.status(500).json({ error: 'Failed to list cronjobs' })
  }
})

/**
 * POST /cronjobs
 * Create a new cronjob
 * Body: { name, cron_expression, message, agent_id, thread_mode?, thread_timeout_minutes? }
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { name, cron_expression, message, agent_id, thread_mode, thread_timeout_minutes } = req.body

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Name is required' })
      return
    }

    if (!cron_expression || typeof cron_expression !== 'string') {
      res.status(400).json({ error: 'Cron expression is required' })
      return
    }

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    if (!agent_id || typeof agent_id !== 'string') {
      res.status(400).json({ error: 'Agent ID is required' })
      return
    }

    const cronjob = createCronjob({
      name,
      cron_expression,
      message,
      agent_id,
      thread_mode,
      thread_timeout_minutes
    }, userId)

    res.json(cronjob)
  } catch (error) {
    console.error('[Cronjobs] Create error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create cronjob'
    res.status(400).json({ error: message })
  }
})

/**
 * GET /cronjobs/validate
 * Validate a cron expression
 * Query: expression
 */
router.get('/validate', async (req, res) => {
  try {
    const expression = req.query.expression as string

    if (!expression) {
      res.status(400).json({ error: 'Expression is required' })
      return
    }

    const result = validateCron(expression)
    res.json(result)
  } catch (error) {
    console.error('[Cronjobs] Validate error:', error)
    res.status(500).json({ error: 'Failed to validate expression' })
  }
})

/**
 * POST /cronjobs/test
 * Test a cronjob configuration without saving
 * Body: { agent_id, message, thread_mode?, thread_timeout_minutes? }
 */
router.post('/test', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { agent_id, message } = req.body

    if (!agent_id || typeof agent_id !== 'string') {
      res.status(400).json({ error: 'Agent ID is required' })
      return
    }

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    const result = await testCronjobConfig(userId, agent_id, message)
    res.json(result)
  } catch (error) {
    console.error('[Cronjobs] Test error:', error)
    res.status(500).json({ error: 'Failed to test cronjob' })
  }
})

/**
 * GET /cronjobs/:id
 * Get a cronjob by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user!.userId
    const cronjob = await getCronjobById(req.params.id)

    if (!cronjob) {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }

    if (cronjob.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.json(cronjob)
  } catch (error) {
    console.error('[Cronjobs] Get error:', error)
    res.status(500).json({ error: 'Failed to get cronjob' })
  }
})

/**
 * PATCH /cronjobs/:id
 * Update a cronjob
 * Body: { name?, cron_expression?, message?, agent_id?, thread_mode?, thread_timeout_minutes?, enabled? }
 */
router.patch('/:id', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { name, cron_expression, message, agent_id, thread_mode, thread_timeout_minutes, enabled } = req.body

    const cronjob = updateCronjob(req.params.id, {
      name,
      cron_expression,
      message,
      agent_id,
      thread_mode,
      thread_timeout_minutes,
      enabled
    }, userId)

    if (!cronjob) {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }

    res.json(cronjob)
  } catch (error) {
    console.error('[Cronjobs] Update error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update cronjob'
    res.status(400).json({ error: message })
  }
})

/**
 * DELETE /cronjobs/:id
 * Delete a cronjob
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user!.userId
    const deleted = deleteCronjob(req.params.id, userId)

    if (!deleted) {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Cronjobs] Delete error:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete cronjob'
    res.status(400).json({ error: message })
  }
})

/**
 * POST /cronjobs/:id/toggle
 * Toggle a cronjob's enabled state
 */
router.post('/:id/toggle', async (req, res) => {
  try {
    const userId = req.user!.userId
    const cronjob = toggleCronjob(req.params.id, userId)

    if (!cronjob) {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }

    res.json(cronjob)
  } catch (error) {
    console.error('[Cronjobs] Toggle error:', error)
    const message = error instanceof Error ? error.message : 'Failed to toggle cronjob'
    res.status(400).json({ error: message })
  }
})

/**
 * POST /cronjobs/:id/trigger
 * Manually trigger a cronjob execution
 */
router.post('/:id/trigger', async (req, res) => {
  try {
    const userId = req.user!.userId
    const result = await triggerCronjob(req.params.id, userId)

    if (!result.success && result.error === 'Cronjob not found') {
      res.status(404).json({ error: 'Cronjob not found' })
      return
    }

    res.json(result)
  } catch (error) {
    console.error('[Cronjobs] Trigger error:', error)
    res.status(500).json({ error: 'Failed to trigger cronjob' })
  }
})

export default router
