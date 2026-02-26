/**
 * Tier database operations for tier-based model management
 */

import { getSupabase } from './supabase-client.js'
import type { UserTier } from './index.js'

export interface ParsedUserTier {
  tier_id: number
  name: string
  display_name: string
  default_model: string
  available_models: string[]
  features: { model_selection: boolean; custom_providers: boolean }
  created_at: number
  updated_at: number
}

/**
 * Parse raw UserTier from database into typed structure
 */
function parseTier(tier: UserTier): ParsedUserTier {
  return {
    tier_id: tier.tier_id,
    name: tier.name,
    display_name: tier.display_name,
    default_model: tier.default_model,
    available_models: JSON.parse(tier.available_models),
    features: JSON.parse(tier.features),
    created_at: tier.created_at,
    updated_at: tier.updated_at
  }
}

/**
 * Get a tier by its ID
 */
export async function getTierById(tierId: number): Promise<ParsedUserTier | null> {
  const { data, error } = await getSupabase()
    .from('user_tiers')
    .select('*')
    .eq('tier_id', tierId)
    .single()

  if (error || !data) return null
  return parseTier(data as unknown as UserTier)
}

/**
 * Get the tier for a specific user
 * Returns the user's tier, defaulting to Tier 1 (Free) if not set
 */
export async function getUserTier(userId: string): Promise<ParsedUserTier> {
  // Get user's tier_id
  const { data: userData, error: userError } = await getSupabase()
    .from('users')
    .select('tier_id')
    .eq('user_id', userId)
    .single()

  let tierId = 1 // Default to Tier 1
  if (!userError && userData) {
    const user = userData as { tier_id: number | null }
    tierId = user.tier_id ?? 1
  }

  // Get the tier details
  const tier = await getTierById(tierId)
  if (!tier) {
    // Fall back to Tier 1 if tier not found
    const fallbackTier = await getTierById(1)
    if (!fallbackTier) {
      // Should never happen, but provide a safe fallback
      return {
        tier_id: 1,
        name: 'free',
        display_name: 'Free',
        default_model: 'claude-opus-4-5-20251101',
        available_models: ['claude-opus-4-5-20251101'],
        features: { model_selection: false, custom_providers: false },
        created_at: Date.now(),
        updated_at: Date.now()
      }
    }
    return fallbackTier
  }

  return tier
}

/**
 * Get the default model for a user based on their tier
 */
export async function getDefaultModelForUser(userId: string): Promise<string> {
  const tier = await getUserTier(userId)
  return tier.default_model
}

/**
 * Check if a user can select models (based on tier)
 */
export async function canUserSelectModel(userId: string): Promise<boolean> {
  const tier = await getUserTier(userId)
  return tier.features.model_selection
}

/**
 * Check if a model is available for a user's tier
 */
export async function isModelAvailableForUser(userId: string, modelId: string): Promise<boolean> {
  const tier = await getUserTier(userId)
  return tier.available_models.includes(modelId)
}

/**
 * Get all tiers
 */
export async function getAllTiers(): Promise<ParsedUserTier[]> {
  const { data, error } = await getSupabase()
    .from('user_tiers')
    .select('*')
    .order('tier_id', { ascending: true })

  if (error) throw new Error(`getAllTiers: ${error.message}`)
  if (!data) return []

  return (data as unknown as UserTier[]).map(parseTier)
}

/**
 * Update a user's tier
 */
export async function updateUserTier(userId: string, tierId: number): Promise<boolean> {
  // Verify tier exists
  const tier = await getTierById(tierId)
  if (!tier) return false

  const now = Date.now()
  const { error } = await getSupabase()
    .from('users')
    .update({ tier_id: tierId, updated_at: now })
    .eq('user_id', userId)

  if (error) throw new Error(`updateUserTier: ${error.message}`)
  return true
}
