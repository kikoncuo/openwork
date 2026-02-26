/**
 * Tier API routes for tier-based model management
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserTier } from '../services/db/tiers.js'

const router = Router()

/**
 * GET /api/user/tier
 * Get the current user's tier information
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const tier = await getUserTier(userId)

    res.json({
      tier_id: tier.tier_id,
      name: tier.name,
      display_name: tier.display_name,
      default_model: tier.default_model,
      available_models: tier.available_models,
      features: tier.features
    })
  } catch (error) {
    console.error('[Tiers API] Failed to get user tier:', error)
    res.status(500).json({ error: 'Failed to get user tier' })
  }
})

export default router
