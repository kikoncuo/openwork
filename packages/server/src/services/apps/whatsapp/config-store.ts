/**
 * WhatsApp Agent Configuration Store
 * Database CRUD operations for WhatsApp agent config and thread mapping
 */

import { getDb, saveToDisk } from '../../db/index.js'
import type { WhatsAppAgentConfig, WhatsAppThreadMapping } from '../../db/index.js'

// ============================================
// WhatsApp Agent Configuration CRUD
// ============================================

/**
 * Get WhatsApp agent configuration for a user.
 * Returns null if not configured.
 */
export function getWhatsAppAgentConfig(userId: string): WhatsAppAgentConfig | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM whatsapp_agent_config WHERE user_id = ?')
  stmt.bind([userId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const config = stmt.getAsObject() as unknown as WhatsAppAgentConfig
  stmt.free()
  return config
}

/**
 * Create or update WhatsApp agent configuration for a user.
 */
export function upsertWhatsAppAgentConfig(
  userId: string,
  updates: Partial<Omit<WhatsAppAgentConfig, 'user_id' | 'created_at' | 'updated_at'>>
): WhatsAppAgentConfig {
  const database = getDb()
  const now = Date.now()
  const existing = getWhatsAppAgentConfig(userId)

  if (existing) {
    // Update existing config
    const setClauses: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [now]

    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?')
      values.push(updates.enabled)
    }
    if (updates.agent_id !== undefined) {
      setClauses.push('agent_id = ?')
      values.push(updates.agent_id)
    }
    if (updates.thread_timeout_minutes !== undefined) {
      setClauses.push('thread_timeout_minutes = ?')
      values.push(updates.thread_timeout_minutes)
    }
    if (updates.workspace_path !== undefined) {
      setClauses.push('workspace_path = ?')
      values.push(updates.workspace_path)
    }

    values.push(userId)
    database.run(`UPDATE whatsapp_agent_config SET ${setClauses.join(', ')} WHERE user_id = ?`, values)
  } else {
    // Create new config
    database.run(
      `INSERT INTO whatsapp_agent_config (user_id, enabled, agent_id, thread_timeout_minutes, workspace_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        updates.enabled ?? 0,
        updates.agent_id ?? null,
        updates.thread_timeout_minutes ?? 30,
        updates.workspace_path ?? null,
        now,
        now
      ]
    )
  }

  saveToDisk()
  return getWhatsAppAgentConfig(userId)!
}

/**
 * Delete WhatsApp agent configuration for a user.
 */
export function deleteWhatsAppAgentConfig(userId: string): void {
  const database = getDb()
  database.run('DELETE FROM whatsapp_agent_config WHERE user_id = ?', [userId])
  saveToDisk()
}

// ============================================
// WhatsApp Thread Mapping CRUD
// ============================================

/**
 * Get thread mapping for a JID.
 * Returns null if no mapping exists.
 */
export function getThreadForJid(userId: string, jid: string): WhatsAppThreadMapping | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM whatsapp_thread_mapping WHERE user_id = ? AND jid = ?')
  stmt.bind([userId, jid])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const mapping = stmt.getAsObject() as unknown as WhatsAppThreadMapping
  stmt.free()
  return mapping
}

/**
 * Get thread mapping by thread ID.
 */
export function getThreadMappingByThreadId(threadId: string): WhatsAppThreadMapping | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM whatsapp_thread_mapping WHERE thread_id = ?')
  stmt.bind([threadId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const mapping = stmt.getAsObject() as unknown as WhatsAppThreadMapping
  stmt.free()
  return mapping
}

/**
 * Create or update thread mapping for a JID.
 */
export function updateThreadMapping(userId: string, jid: string, threadId: string): WhatsAppThreadMapping {
  const database = getDb()
  const now = Date.now()
  const existing = getThreadForJid(userId, jid)

  if (existing) {
    // Update existing mapping
    database.run(
      'UPDATE whatsapp_thread_mapping SET thread_id = ?, last_activity_at = ? WHERE user_id = ? AND jid = ?',
      [threadId, now, userId, jid]
    )
  } else {
    // Create new mapping
    database.run(
      `INSERT INTO whatsapp_thread_mapping (user_id, jid, thread_id, last_activity_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, jid, threadId, now, now]
    )
  }

  saveToDisk()
  return getThreadForJid(userId, jid)!
}

/**
 * Update the last activity timestamp for a thread mapping.
 */
export function updateThreadMappingActivity(userId: string, jid: string): void {
  const database = getDb()
  const now = Date.now()
  database.run(
    'UPDATE whatsapp_thread_mapping SET last_activity_at = ? WHERE user_id = ? AND jid = ?',
    [now, userId, jid]
  )
  saveToDisk()
}

/**
 * Delete thread mapping for a JID.
 */
export function deleteThreadMapping(userId: string, jid: string): void {
  const database = getDb()
  database.run('DELETE FROM whatsapp_thread_mapping WHERE user_id = ? AND jid = ?', [userId, jid])
  saveToDisk()
}

/**
 * Delete thread mapping by thread ID.
 */
export function deleteThreadMappingByThreadId(threadId: string): void {
  const database = getDb()
  database.run('DELETE FROM whatsapp_thread_mapping WHERE thread_id = ?', [threadId])
  saveToDisk()
}

/**
 * Get all thread mappings for a user.
 */
export function getAllThreadMappings(userId: string): WhatsAppThreadMapping[] {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM whatsapp_thread_mapping WHERE user_id = ? ORDER BY last_activity_at DESC')
  stmt.bind([userId])

  const mappings: WhatsAppThreadMapping[] = []
  while (stmt.step()) {
    mappings.push(stmt.getAsObject() as unknown as WhatsAppThreadMapping)
  }
  stmt.free()
  return mappings
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
