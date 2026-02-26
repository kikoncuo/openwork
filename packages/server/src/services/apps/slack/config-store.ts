/**
 * Slack Agent Configuration Store
 * Database CRUD operations for Slack agent config and thread mapping
 */

import { getSupabase } from '../../db/supabase-client.js'
import type { SlackAgentConfig, SlackThreadMapping } from '../../db/index.js'

// ============================================
// Slack Agent Configuration CRUD
// ============================================

/**
 * Get Slack agent configuration for a user.
 * Returns null if not configured.
 */
export async function getSlackAgentConfig(userId: string): Promise<SlackAgentConfig | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('slack_agent_config')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    return null
  }

  return data as SlackAgentConfig
}

/**
 * Create or update Slack agent configuration for a user.
 */
export async function upsertSlackAgentConfig(
  userId: string,
  updates: Partial<Omit<SlackAgentConfig, 'user_id' | 'created_at' | 'updated_at'>>
): Promise<SlackAgentConfig> {
  const supabase = getSupabase()
  const now = Date.now()
  const existing = await getSlackAgentConfig(userId)

  if (existing) {
    // Update existing config
    const updatePayload: Record<string, unknown> = { updated_at: now }

    if (updates.enabled !== undefined) {
      updatePayload.enabled = updates.enabled
    }
    if (updates.agent_id !== undefined) {
      updatePayload.agent_id = updates.agent_id
    }
    if (updates.poll_interval_seconds !== undefined) {
      updatePayload.poll_interval_seconds = updates.poll_interval_seconds
    }
    if (updates.thread_timeout_seconds !== undefined) {
      updatePayload.thread_timeout_seconds = updates.thread_timeout_seconds
    }

    const { error } = await supabase
      .from('slack_agent_config')
      .update(updatePayload)
      .eq('user_id', userId)
    if (error) throw error
  } else {
    // Create new config
    const { error } = await supabase.from('slack_agent_config').insert({
      user_id: userId,
      enabled: updates.enabled ?? 0,
      agent_id: updates.agent_id ?? null,
      poll_interval_seconds: updates.poll_interval_seconds ?? 60,
      thread_timeout_seconds: updates.thread_timeout_seconds ?? 60,
      created_at: now,
      updated_at: now
    })
    if (error) throw error
  }

  return (await getSlackAgentConfig(userId))!
}

/**
 * Delete Slack agent configuration for a user.
 */
export async function deleteSlackAgentConfig(userId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('slack_agent_config')
    .delete()
    .eq('user_id', userId)
  if (error) throw error
}

// ============================================
// Slack Thread Mapping CRUD
// ============================================

/**
 * Get thread mapping for a Slack channel.
 * Returns null if no mapping exists.
 */
export async function getThreadForSlackChannel(userId: string, slackChannelId: string): Promise<SlackThreadMapping | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('slack_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .eq('slack_channel_id', slackChannelId)
    .single()

  if (error || !data) {
    return null
  }

  return data as SlackThreadMapping
}

/**
 * Get thread mapping by thread ID.
 */
export async function getSlackThreadMappingByThreadId(threadId: string): Promise<SlackThreadMapping | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('slack_thread_mapping')
    .select('*')
    .eq('thread_id', threadId)
    .single()

  if (error || !data) {
    return null
  }

  return data as SlackThreadMapping
}

/**
 * Create or update thread mapping for a Slack channel.
 */
export async function updateSlackThreadMapping(
  userId: string,
  slackChannelId: string,
  threadId: string,
  lastProcessedTs?: string
): Promise<SlackThreadMapping> {
  const supabase = getSupabase()
  const now = Date.now()
  const existing = await getThreadForSlackChannel(userId, slackChannelId)

  if (existing) {
    // Update existing mapping
    const updatePayload: Record<string, unknown> = {
      thread_id: threadId,
      last_activity_at: now,
      deleted: 0
    }

    if (lastProcessedTs !== undefined) {
      updatePayload.last_processed_ts = lastProcessedTs
    }

    const { error } = await supabase
      .from('slack_thread_mapping')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('slack_channel_id', slackChannelId)
    if (error) throw error
  } else {
    // Create new mapping
    const { error } = await supabase.from('slack_thread_mapping').insert({
      user_id: userId,
      slack_channel_id: slackChannelId,
      thread_id: threadId,
      last_processed_ts: lastProcessedTs || null,
      last_activity_at: now,
      created_at: now,
      deleted: 0
    })
    if (error) throw error
  }

  return (await getThreadForSlackChannel(userId, slackChannelId))!
}

/**
 * Update the last processed timestamp for a Slack channel mapping.
 * Creates a new mapping if none exists (with empty thread_id for tracking purposes).
 */
export async function updateSlackLastProcessedTs(userId: string, slackChannelId: string, ts: string): Promise<void> {
  const supabase = getSupabase()
  const now = Date.now()
  const existing = await getThreadForSlackChannel(userId, slackChannelId)

  if (existing) {
    // Update existing mapping
    const { error } = await supabase
      .from('slack_thread_mapping')
      .update({ last_processed_ts: ts, last_activity_at: now })
      .eq('user_id', userId)
      .eq('slack_channel_id', slackChannelId)
    if (error) throw error
  } else {
    // Create new mapping for tracking (thread_id will be set later when a thread is created)
    const { error } = await supabase.from('slack_thread_mapping').insert({
      user_id: userId,
      slack_channel_id: slackChannelId,
      thread_id: '',
      last_processed_ts: ts,
      last_activity_at: now,
      created_at: now,
      deleted: 0
    })
    if (error) throw error
  }
}

/**
 * Update the last activity timestamp for a thread mapping.
 */
export async function updateSlackThreadMappingActivity(userId: string, slackChannelId: string): Promise<void> {
  const supabase = getSupabase()
  const now = Date.now()
  const { error } = await supabase
    .from('slack_thread_mapping')
    .update({ last_activity_at: now })
    .eq('user_id', userId)
    .eq('slack_channel_id', slackChannelId)
  if (error) throw error
}

/**
 * Mark a thread mapping as deleted (when user deletes the thread).
 * This prevents future messages from that channel from being received until timeout.
 * We also update last_activity_at to track when it was deleted.
 */
export async function markSlackThreadMappingDeleted(threadId: string): Promise<void> {
  const supabase = getSupabase()
  const now = Date.now()
  const { error } = await supabase
    .from('slack_thread_mapping')
    .update({ deleted: 1, last_activity_at: now })
    .eq('thread_id', threadId)
  if (error) throw error
}

/**
 * Reset a deleted mapping so it can receive messages again.
 * Called when timeout has passed since deletion.
 */
export async function resetSlackThreadMapping(userId: string, slackChannelId: string): Promise<void> {
  const supabase = getSupabase()
  const now = Date.now()
  const { error } = await supabase
    .from('slack_thread_mapping')
    .update({ deleted: 0, thread_id: '', last_activity_at: now })
    .eq('user_id', userId)
    .eq('slack_channel_id', slackChannelId)
  if (error) throw error
}

/**
 * Delete thread mapping for a Slack channel.
 */
export async function deleteSlackThreadMapping(userId: string, slackChannelId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('slack_thread_mapping')
    .delete()
    .eq('user_id', userId)
    .eq('slack_channel_id', slackChannelId)
  if (error) throw error
}

/**
 * Delete thread mapping by thread ID.
 */
export async function deleteSlackThreadMappingByThreadId(threadId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('slack_thread_mapping')
    .delete()
    .eq('thread_id', threadId)
  if (error) throw error
}

/**
 * Get all active (non-deleted) thread mappings for a user.
 */
export async function getActiveSlackThreadMappings(userId: string): Promise<SlackThreadMapping[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('slack_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', 0)
    .order('last_activity_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as SlackThreadMapping[]
}

/**
 * Get all thread mappings for a user (including deleted).
 */
export async function getAllSlackThreadMappings(userId: string): Promise<SlackThreadMapping[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('slack_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as SlackThreadMapping[]
}

/**
 * Check if a thread mapping is within the timeout window.
 * @param mapping - The thread mapping to check
 * @param timeoutSeconds - The timeout in seconds
 * @returns true if the mapping is still active (within timeout)
 */
export function isSlackThreadMappingActive(mapping: SlackThreadMapping, timeoutSeconds: number): boolean {
  const now = Date.now()
  const timeoutMs = timeoutSeconds * 1000
  return (now - mapping.last_activity_at) < timeoutMs
}

/**
 * Check if a thread mapping is deleted.
 */
export function isSlackThreadMappingDeleted(mapping: SlackThreadMapping): boolean {
  return mapping.deleted === 1
}
