import { Router } from 'express'
import { getToolConfigs, saveToolConfigs, type ToolConfig } from '../services/settings.js'

const router = Router()

// Get tool configs
router.get('/configs', async (_req, res) => {
  try {
    res.json(getToolConfigs())
  } catch (error) {
    console.error('[Tools] Get configs error:', error)
    res.status(500).json({ error: 'Failed to get tool configs' })
  }
})

// Save tool configs
router.put('/configs', async (req, res) => {
  try {
    const configs: ToolConfig[] = req.body
    saveToolConfigs(configs)
    res.json(configs)
  } catch (error) {
    console.error('[Tools] Save configs error:', error)
    res.status(500).json({ error: 'Failed to save tool configs' })
  }
})

export default router
