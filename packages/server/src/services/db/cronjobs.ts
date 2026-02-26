/**
 * Cronjobs database CRUD operations (Supabase)
 */

import { v4 as uuidv4 } from 'uuid'
import { getSupabase } from './supabase-client.js'
import type { Cronjob, CronjobThreadMapping } from './index.js'

// Re-export types
export type { Cronjob, CronjobThreadMapping }

/**
 * Create a new cronjob record
 */
export async function createCronjob(input: {
  name: string
  cron_expression: string
  message: string
  agent_id: string
  thread_mode?: 'new' | 'reuse'
  thread_timeout_minutes?: number
  user_id: string
}): Promise<Cronjob> {
  const now = Date.now()
  const cronjobId = uuidv4()

  const cronjob: Cronjob = {
    cronjob_id: cronjobId,
    user_id: input.user_id,
    name: input.name,
    cron_expression: input.cron_expression,
    message: input.message,
    agent_id: input.agent_id,
    thread_mode: (input.thread_mode || 'new') as 'new' | 'reuse',
    thread_timeout_minutes: input.thread_timeout_minutes || 30,
    enabled: 0,
    last_run_at: null,
    next_run_at: null,
    created_at: now,
    updated_at: now,
  }

  const { error } = await getSupabase().from('cronjobs').insert(cronjob)
  if (error) throw new Error(`createCronjob: ${error.message}`)

  return cronjob
}

/**
 * Get a cronjob by ID
 */
export async function getCronjob(cronjobId: string): Promise<Cronjob | null> {
  const { data, error } = await getSupabase()
    .from('cronjobs')
    .select('*')
    .eq('cronjob_id', cronjobId)
    .single()
  if (error || !data) return null
  return data as unknown as Cronjob
}

/**
 * Get all cronjobs for a user
 */
export async function getCronjobsByUserId(userId: string): Promise<Cronjob[]> {
  const { data, error } = await getSupabase()
    .from('cronjobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`getCronjobsByUserId: ${error.message}`)
  return (data || []) as unknown as Cronjob[]
}

/**
 * Get all enabled cronjobs (for scheduling on startup)
 */
export async function getEnabledCronjobs(): Promise<Cronjob[]> {
  const { data, error } = await getSupabase()
    .from('cronjobs')
    .select('*')
    .eq('enabled', 1)
  if (error) throw new Error(`getEnabledCronjobs: ${error.message}`)
  return (data || []) as unknown as Cronjob[]
}

/**
 * Update a cronjob
 */
export async function updateCronjob(
  cronjobId: string,
  updates: Partial<Omit<Cronjob, 'cronjob_id' | 'user_id' | 'created_at'>>
): Promise<Cronjob | null> {
  const existing = await getCronjob(cronjobId)
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, string | number | null> = { updated_at: now }

  if (updates.name !== undefined) row.name = updates.name
  if (updates.cron_expression !== undefined) row.cron_expression = updates.cron_expression
  if (updates.message !== undefined) row.message = updates.message
  if (updates.agent_id !== undefined) row.agent_id = updates.agent_id
  if (updates.thread_mode !== undefined) row.thread_mode = updates.thread_mode
  if (updates.thread_timeout_minutes !== undefined) row.thread_timeout_minutes = updates.thread_timeout_minutes
  if (updates.enabled !== undefined) row.enabled = updates.enabled
  if (updates.last_run_at !== undefined) row.last_run_at = updates.last_run_at
  if (updates.next_run_at !== undefined) row.next_run_at = updates.next_run_at

  const { error } = await getSupabase()
    .from('cronjobs')
    .update(row)
    .eq('cronjob_id', cronjobId)
  if (error) throw new Error(`updateCronjob: ${error.message}`)

  return getCronjob(cronjobId)
}

/**
 * Delete a cronjob
 */
export async function deleteCronjob(cronjobId: string): Promise<boolean> {
  const existing = await getCronjob(cronjobId)
  if (!existing) return false

  const { error } = await getSupabase()
    .from('cronjobs')
    .delete()
    .eq('cronjob_id', cronjobId)
  if (error) throw new Error(`deleteCronjob: ${error.message}`)

  return true
}

/**
 * Update the last run time of a cronjob
 */
export async function updateCronjobLastRun(cronjobId: string, lastRunAt: number, nextRunAt: number | null): Promise<Cronjob | null> {
  return updateCronjob(cronjobId, { last_run_at: lastRunAt, next_run_at: nextRunAt })
}

// ============================================
// Thread Mapping Functions
// ============================================

/**
 * Get the thread mapping for a cronjob
 */
export async function getThreadForCronjob(userId: string, cronjobId: string): Promise<CronjobThreadMapping | null> {
  const { data, error } = await getSupabase()
    .from('cronjob_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .eq('cronjob_id', cronjobId)
    .single()
  if (error || !data) return null
  return data as unknown as CronjobThreadMapping
}

/**
 * Create or update a cronjob thread mapping
 */
export async function updateCronjobThreadMapping(userId: string, cronjobId: string, threadId: string): Promise<CronjobThreadMapping> {
  const now = Date.now()

  const { error } = await getSupabase()
    .from('cronjob_thread_mapping')
    .upsert(
      {
        user_id: userId,
        cronjob_id: cronjobId,
        thread_id: threadId,
        last_activity_at: now,
        created_at: now,
      },
      { onConflict: 'user_id,cronjob_id' }
    )
  if (error) throw new Error(`updateCronjobThreadMapping: ${error.message}`)

  const mapping = await getThreadForCronjob(userId, cronjobId)
  return mapping!
}

/**
 * Update only the last activity timestamp for a cronjob thread mapping
 */
export async function updateCronjobThreadMappingActivity(userId: string, cronjobId: string): Promise<void> {
  const now = Date.now()

  const { error } = await getSupabase()
    .from('cronjob_thread_mapping')
    .update({ last_activity_at: now })
    .eq('user_id', userId)
    .eq('cronjob_id', cronjobId)
  if (error) throw new Error(`updateCronjobThreadMappingActivity: ${error.message}`)
}

/**
 * Check if a cronjob thread mapping is still active (within timeout)
 */
export function isCronjobThreadMappingActive(mapping: CronjobThreadMapping, timeoutMinutes: number): boolean {
  const now = Date.now()
  const timeoutMs = timeoutMinutes * 60 * 1000
  return (now - mapping.last_activity_at) < timeoutMs
}

/**
 * Delete a cronjob thread mapping
 */
export async function deleteCronjobThreadMapping(userId: string, cronjobId: string): Promise<boolean> {
  const existing = await getThreadForCronjob(userId, cronjobId)
  if (!existing) return false

  const { error } = await getSupabase()
    .from('cronjob_thread_mapping')
    .delete()
    .eq('user_id', userId)
    .eq('cronjob_id', cronjobId)
  if (error) throw new Error(`deleteCronjobThreadMapping: ${error.message}`)

  return true
}
