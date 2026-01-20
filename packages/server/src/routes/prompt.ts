import { Router } from 'express'
import { getCustomPrompt, setCustomPrompt } from '../services/storage.js'

const router = Router()

// Get base system prompt
router.get('/base', async (_req, res) => {
  try {
    const { BASE_SYSTEM_PROMPT } = await import('../services/agent/system-prompt.js')
    res.json({ prompt: BASE_SYSTEM_PROMPT })
  } catch (error) {
    console.error('[Prompt] Get base error:', error)
    res.status(500).json({ error: 'Failed to get base prompt' })
  }
})

// Get custom system prompt
router.get('/custom', async (_req, res) => {
  try {
    res.json({ prompt: getCustomPrompt() })
  } catch (error) {
    console.error('[Prompt] Get custom error:', error)
    res.status(500).json({ error: 'Failed to get custom prompt' })
  }
})

// Set custom system prompt
router.put('/custom', async (req, res) => {
  try {
    const { prompt } = req.body
    setCustomPrompt(prompt)
    res.json({ success: true })
  } catch (error) {
    console.error('[Prompt] Set custom error:', error)
    res.status(500).json({ error: 'Failed to set custom prompt' })
  }
})

export default router
