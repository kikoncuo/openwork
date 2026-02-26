/**
 * WhatsApp Agent Configuration Store
 * Database CRUD operations for WhatsApp agent config and thread mapping
 * Uses Supabase for persistence
 */

import { getSupabase } from '../../db/supabase-client.js'
import type { WhatsAppAgentConfig, WhatsAppThreadMapping } from '../../db/index.js'

// ============================================
// WhatsApp Agent Configuration CRUD
// ============================================

/**
 * Get WhatsApp agent configuration for a user.
 * Returns null if not configured.
 */
export async function getWhatsAppAgentConfig(userId: string): Promise<WhatsAppAgentConfig | null> {
  const { data, error } = await getSupabase()
    .from('whatsapp_agent_config')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data as unknown as WhatsAppAgentConfig
}

/**
 * Create or update WhatsApp agent configuration for a user.
 */
export async function upsertWhatsAppAgentConfig(
  userId: string,
  updates: Partial<Omit<WhatsAppAgentConfig, 'user_id' | 'created_at' | 'updated_at'>>
): Promise<WhatsAppAgentConfig> {
  const now = Date.now()
  const existing = await getWhatsAppAgentConfig(userId)

  if (existing) {
    // Update existing config
    const row: Record<string, unknown> = { updated_at: now }

    if (updates.enabled !== undefined) row.enabled = updates.enabled
    if (updates.agent_id !== undefined) row.agent_id = updates.agent_id
    if (updates.thread_timeout_minutes !== undefined) row.thread_timeout_minutes = updates.thread_timeout_minutes

    await getSupabase()
      .from('whatsapp_agent_config')
      .update(row)
      .eq('user_id', userId)
  } else {
    // Create new config
    await getSupabase()
      .from('whatsapp_agent_config')
      .insert({
        user_id: userId,
        enabled: updates.enabled ?? 0,
        agent_id: updates.agent_id ?? null,
        thread_timeout_minutes: updates.thread_timeout_minutes ?? 30,
        created_at: now,
        updated_at: now
      })
  }

  return (await getWhatsAppAgentConfig(userId))!
}

/**
 * Delete WhatsApp agent configuration for a user.
 */
export async function deleteWhatsAppAgentConfig(userId: string): Promise<void> {
  await getSupabase()
    .from('whatsapp_agent_config')
    .delete()
    .eq('user_id', userId)
}

// ============================================
// WhatsApp Thread Mapping CRUD
// ============================================

/**
 * Get thread mapping for a JID.
 * Returns null if no mapping exists.
 */
export async function getThreadForJid(userId: string, jid: string): Promise<WhatsAppThreadMapping | null> {
  const { data, error } = await getSupabase()
    .from('whatsapp_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .eq('jid', jid)
    .single()

  if (error || !data) return null
  return data as unknown as WhatsAppThreadMapping
}

/**
 * Get thread mapping by thread ID.
 */
export async function getThreadMappingByThreadId(threadId: string): Promise<WhatsAppThreadMapping | null> {
  const { data, error } = await getSupabase()
    .from('whatsapp_thread_mapping')
    .select('*')
    .eq('thread_id', threadId)
    .single()

  if (error || !data) return null
  return data as unknown as WhatsAppThreadMapping
}

/**
 * Create or update thread mapping for a JID.
 */
export async function updateThreadMapping(userId: string, jid: string, threadId: string): Promise<WhatsAppThreadMapping> {
  const now = Date.now()

  await getSupabase()
    .from('whatsapp_thread_mapping')
    .upsert(
      {
        user_id: userId,
        jid,
        thread_id: threadId,
        last_activity_at: now,
        created_at: now
      },
      { onConflict: 'user_id,jid' }
    )

  return (await getThreadForJid(userId, jid))!
}

/**
 * Update the last activity timestamp for a thread mapping.
 */
export async function updateThreadMappingActivity(userId: string, jid: string): Promise<void> {
  const now = Date.now()
  await getSupabase()
    .from('whatsapp_thread_mapping')
    .update({ last_activity_at: now })
    .eq('user_id', userId)
    .eq('jid', jid)
}

/**
 * Delete thread mapping for a JID.
 */
export async function deleteThreadMapping(userId: string, jid: string): Promise<void> {
  await getSupabase()
    .from('whatsapp_thread_mapping')
    .delete()
    .eq('user_id', userId)
    .eq('jid', jid)
}

/**
 * Delete thread mapping by thread ID.
 */
export async function deleteThreadMappingByThreadId(threadId: string): Promise<void> {
  await getSupabase()
    .from('whatsapp_thread_mapping')
    .delete()
    .eq('thread_id', threadId)
}

/**
 * Get all thread mappings for a user.
 */
export async function getAllThreadMappings(userId: string): Promise<WhatsAppThreadMapping[]> {
  const { data, error } = await getSupabase()
    .from('whatsapp_thread_mapping')
    .select('*')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false })

  if (error || !data) return []
  return data as unknown as WhatsAppThreadMapping[]
}

/**
 * Check if a thread mapping is within the timeout window.
 * @param mapping - The thread mapping to check
 * @param timeoutMinutes - The timeout in minutes
 * @returns true if the mapping is still active (within timeout)
 */
export function isThreadMappingActive(mapping: WhatsAppThreadMapping, timeoutMinutes: number): boolean {
  const now = Date.now()
  const timeoutMs = timeoutMinutes * 60 * 1000
  return (now - mapping.last_activity_at) < timeoutMs
}
