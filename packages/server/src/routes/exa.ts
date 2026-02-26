/**
 * Exa Routes - Search and Datasets API endpoints
 */

import { Router } from 'express'
import { exaService } from '../services/apps/exa/index.js'
import { getExaToolInfo } from '../services/apps/exa/tools.js'
import { requireAuth } from '../middleware/auth.js'
import { createE2bFileAccess } from '../services/agent/sandbox-file-access.js'

const router = Router()

// ============================================
// Connection Management
// ============================================

// Connect to Exa
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { apiKey } = req.body || {}
    await exaService.connect(userId, apiKey)
    res.json({ success: true })
  } catch (error) {
    console.error('[Exa] Connect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect to Exa'
    res.status(500).json({ error: message })
  }
})

// Disconnect from Exa
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    await exaService.disconnect(userId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Exa] Disconnect error:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Get connection status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const status = await exaService.getConnectionStatus(userId)
    res.json(status)
  } catch (error) {
    console.error('[Exa] Status error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get status'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Search Routes
// ============================================

// Web search
router.post('/search', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { query, category, numResults, includeDomains, excludeDomains, useHighlights } = req.body

    if (!query) {
      return res.status(400).json({ error: 'Query is required' })
    }

    const results = await exaService.search(userId, {
      query,
      category,
      numResults,
      includeDomains,
      excludeDomains,
      useHighlights
    })

    res.json({ results })
  } catch (error) {
    console.error('[Exa] Search error:', error)
    const message = error instanceof Error ? error.message : 'Search failed'
    res.status(500).json({ error: message })
  }
})

// Export search results to CSV
router.post('/search/export', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { query, results, agentId } = req.body

    if (!query || !results || !agentId) {
      return res.status(400).json({ error: 'Query, results, and agentId are required' })
    }

    const fileAccess = createE2bFileAccess(agentId)
    const csvPath = await exaService.exportSearchResultsAsCSV(fileAccess, query, results)
    res.json({ csvPath })
  } catch (error) {
    console.error('[Exa] Export search results error:', error)
    const message = error instanceof Error ? error.message : 'Export failed'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Dataset Routes
// ============================================

// Create dataset
router.post('/datasets', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { query, count, enrichments } = req.body

    if (!query) {
      return res.status(400).json({ error: 'Query is required' })
    }

    const info = await exaService.createDataset(userId, { query, count, enrichments })
    res.json(info)
  } catch (error) {
    console.error('[Exa] Create dataset error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create dataset'
    res.status(500).json({ error: message })
  }
})

// Wait for dataset completion
router.post('/datasets/:datasetId/wait', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const datasetId = String(req.params.datasetId)
    const { timeout } = req.body

    const info = await exaService.waitForDataset(userId, datasetId, timeout)
    res.json(info)
  } catch (error) {
    console.error('[Exa] Wait for dataset error:', error)
    const message = error instanceof Error ? error.message : 'Failed to wait for dataset'
    res.status(500).json({ error: message })
  }
})

// Get dataset items
router.get('/datasets/:datasetId/items', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const datasetId = String(req.params.datasetId)

    const items = await exaService.getDatasetItems(userId, datasetId)
    res.json({ items })
  } catch (error) {
    console.error('[Exa] Get dataset items error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get dataset items'
    res.status(500).json({ error: message })
  }
})

// Add enrichments to dataset
router.post('/datasets/:datasetId/enrich', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const datasetId = String(req.params.datasetId)
    const { enrichments } = req.body

    if (!enrichments || !Array.isArray(enrichments)) {
      return res.status(400).json({ error: 'Enrichments array is required' })
    }

    const info = await exaService.enrichDataset(userId, datasetId, enrichments)
    res.json(info)
  } catch (error) {
    console.error('[Exa] Enrich dataset error:', error)
    const message = error instanceof Error ? error.message : 'Failed to enrich dataset'
    res.status(500).json({ error: message })
  }
})

// Export dataset to CSV
router.post('/datasets/:datasetId/export', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const datasetId = String(req.params.datasetId)
    const { agentId } = req.body

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' })
    }

    const fileAccess = createE2bFileAccess(agentId)
    const csvPath = await exaService.exportDatasetAsCSV(userId, fileAccess, datasetId)
    res.json({ csvPath })
  } catch (error) {
    console.error('[Exa] Export dataset error:', error)
    const message = error instanceof Error ? error.message : 'Failed to export dataset'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Tools Route
// ============================================

router.get('/tools', requireAuth, async (_req, res) => {
  try {
    res.json(getExaToolInfo())
  } catch (error) {
    console.error('[Exa] Get tools error:', error)
    res.status(500).json({ error: 'Failed to get tools' })
  }
})

export default router
