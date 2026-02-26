/**
 * Skills API routes
 * Manages the skills library and per-agent skill assignments
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  downloadSkill,
  listSkills,
  getSkillById,
  getSkillFiles,
  removeSkill
} from '../services/skills/index.js'

const router = Router()

// Apply requireAuth to all routes
router.use(requireAuth)

/**
 * GET /skills
 * List all skills for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const skills = listSkills(userId)
    res.json(skills)
  } catch (error) {
    console.error('[Skills] List error:', error)
    res.status(500).json({ error: 'Failed to list skills' })
  }
})

/**
 * POST /skills
 * Download a new skill from GitHub
 * Body: { url: string }
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user!.userId
    const { url } = req.body

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL is required' })
      return
    }

    const skill = await downloadSkill(url, userId)
    res.json(skill)
  } catch (error) {
    console.error('[Skills] Download error:', error)
    const message = error instanceof Error ? error.message : 'Failed to download skill'
    res.status(400).json({ error: message })
  }
})

/**
 * GET /skills/:skillId
 * Get a skill by ID
 */
router.get('/:skillId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const skill = await getSkillById(req.params.skillId)

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }

    if (skill.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.json(skill)
  } catch (error) {
    console.error('[Skills] Get error:', error)
    res.status(500).json({ error: 'Failed to get skill' })
  }
})

/**
 * GET /skills/:skillId/files
 * Get skill files (for preview)
 */
router.get('/:skillId/files', async (req, res) => {
  try {
    const userId = req.user!.userId
    const skill = await getSkillById(req.params.skillId)

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }

    if (skill.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const files = await getSkillFiles(req.params.skillId, userId)
    res.json(files)
  } catch (error) {
    console.error('[Skills] Get files error:', error)
    res.status(500).json({ error: 'Failed to get skill files' })
  }
})

/**
 * DELETE /skills/:skillId
 * Delete a skill
 */
router.delete('/:skillId', async (req, res) => {
  try {
    const userId = req.user!.userId
    const skill = await getSkillById(req.params.skillId)

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }

    if (skill.user_id !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const deleted = await removeSkill(req.params.skillId, userId)
    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete skill' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[Skills] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete skill' })
  }
})

export default router
