import { Router } from 'express'
import {
  getLearnedInsights,
  saveLearnedInsights,
  addLearnedInsight,
  removeLearnedInsight,
  toggleLearnedInsight,
  type LearnedInsight
} from '../services/storage.js'

const router = Router()

// List insights
router.get('/', async (_req, res) => {
  try {
    res.json(getLearnedInsights())
  } catch (error) {
    console.error('[Insights] List error:', error)
    res.status(500).json({ error: 'Failed to list insights' })
  }
})

// Add insight
router.post('/', async (req, res) => {
  try {
    const { content, source } = req.body
    const insight = addLearnedInsight(content, source)
    res.json(insight)
  } catch (error) {
    console.error('[Insights] Add error:', error)
    res.status(500).json({ error: 'Failed to add insight' })
  }
})

// Save all insights
router.put('/', async (req, res) => {
  try {
    const insights: LearnedInsight[] = req.body
    saveLearnedInsights(insights)
    res.json({ success: true })
  } catch (error) {
    console.error('[Insights] Save error:', error)
    res.status(500).json({ error: 'Failed to save insights' })
  }
})

// Remove insight
router.delete('/:id', async (req, res) => {
  try {
    removeLearnedInsight(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('[Insights] Remove error:', error)
    res.status(500).json({ error: 'Failed to remove insight' })
  }
})

// Toggle insight
router.patch('/:id/toggle', async (req, res) => {
  try {
    toggleLearnedInsight(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('[Insights] Toggle error:', error)
    res.status(500).json({ error: 'Failed to toggle insight' })
  }
})

export default router
