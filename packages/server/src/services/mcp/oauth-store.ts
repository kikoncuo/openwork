/**
 * MCP OAuth Auth Store - Supabase-based encrypted storage for OAuth tokens
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getSupabase } from '../db/supabase-client.js'
import { getOpenworkDir } from '../storage.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'mcp-oauth.key')

  if (existsSync(keyPath)) {
    const keyHex = readFileSync(keyPath, 'utf8').trim()
    return Buffer.from(keyHex, 'hex')
  }

  const key = randomBytes(32)
  const dir = dirname(keyPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(keyPath, key.toString('hex'), 'utf8')
  return key
}

function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH)
  const key = getEncryptionKey()
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()

  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted
}

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format')
  }

  const iv = Buffer.from(parts[0], 'hex')
  const tag = Buffer.from(parts[1], 'hex')
  const encrypted = parts[2]
  const key = getEncryptionKey()

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

export class McpOAuthStore {
  private tableName = 'mcp_oauth_auth' as const

  /**
   * Save a value for a server+key pair
   */
  async save(serverId: string, key: string, data: unknown): Promise<void> {
    const supabase = getSupabase()
    const now = Date.now()
    const encrypted = encrypt(JSON.stringify(data))

    const { error } = await supabase.from(this.tableName).upsert(
      { server_id: serverId, key, data: encrypted, updated_at: now },
      { onConflict: 'server_id,key' }
    )
    if (error) throw error
  }

  /**
   * Load a value for a server+key pair
   */
  async load<T>(serverId: string, key: string): Promise<T | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('server_id', serverId)
        .eq('key', key)
        .single()

      if (error || !data) {
        return null
      }

      try {
        const decrypted = decrypt(data.data)
        return JSON.parse(decrypted) as T
      } catch {
        return null
      }
    } catch {
      return null
    }
  }

  /**
   * Delete all data for a server
   */
  async clearServer(serverId: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('server_id', serverId)
    if (error) throw error
  }

  /**
   * Delete a specific key for a server
   */
  async deleteKey(serverId: string, key: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('server_id', serverId)
      .eq('key', key)
    if (error) throw error
  }
}

// Singleton instance
let storeInstance: McpOAuthStore | null = null

export function getMcpOAuthStore(): McpOAuthStore {
  if (!storeInstance) {
    storeInstance = new McpOAuthStore()
  }
  return storeInstance
}
