import { Router } from 'express'
import {
  getSandboxBackendConfig,
  setSandboxBackendConfig,
  type SandboxBackendConfig
} from '../services/settings.js'

const router = Router()

// Get sandbox backend config
router.get('/config', async (_req, res) => {
  try {
    res.json(getSandboxBackendConfig())
  } catch (error) {
    console.error('[Sandbox] Get config error:', error)
    res.status(500).json({ error: 'Failed to get sandbox config' })
  }
})

// Save sandbox backend config
router.put('/config', async (req, res) => {
  try {
    const config: SandboxBackendConfig = req.body
    setSandboxBackendConfig(config)
    res.json(config)
  } catch (error) {
    console.error('[Sandbox] Save config error:', error)
    res.status(500).json({ error: 'Failed to save sandbox config' })
  }
})

export default router
