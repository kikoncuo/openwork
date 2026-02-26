/**
 * Exa Auth Store - Supabase-based API key storage with encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getSupabase } from '../../db/supabase-client.js'
import { getOpenworkDir } from '../../storage.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get or create the encryption key for Exa auth data
 */
function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'exa.key')

  if (existsSync(keyPath)) {
    const keyHex = readFileSync(keyPath, 'utf8').trim()
    return Buffer.from(keyHex, 'hex')
  }

  // Generate new key
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

/**
 * Supabase-based auth store for Exa API keys
 */
export class ExaAuthStore {
  private tableName = 'exa_auth' as const

  /**
   * Save API key for a user
   */
  async saveApiKey(userId: string, apiKey: string): Promise<void> {
    try {
      const supabase = getSupabase()
      const now = Date.now()

      const encrypted = encrypt(apiKey)
      const { error: keyError } = await supabase.from(this.tableName).upsert(
        { key: 'api_key', user_id: userId, data: encrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (keyError) throw keyError

      const { error: tsError } = await supabase.from(this.tableName).upsert(
        { key: 'connected_at', user_id: userId, data: now.toString(), updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tsError) throw tsError

      console.log(`[Exa Auth Store] API key saved for user ${userId}`)
    } catch (error) {
      console.error('[Exa Auth Store] saveApiKey error:', error)
      throw error
    }
  }

  /**
   * Get API key for a user
   */
  async getApiKey(userId: string): Promise<string | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'api_key')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      try {
        return decrypt(data.data)
      } catch {
        console.warn(`[Exa Auth Store] Failed to decrypt API key for user ${userId}`)
        return null
      }
    } catch (error) {
      console.error('[Exa Auth Store] getApiKey error:', error)
      return null
    }
  }

  /**
   * Check if user has a valid stored API key
   */
  async hasValidKey(userId: string): Promise<boolean> {
    const apiKey = await this.getApiKey(userId)
    return apiKey !== null && apiKey.length > 0
  }

  /**
   * Clear stored API key for a user
   */
  async clearApiKey(userId: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('user_id', userId)
    if (error) {
      console.error('[Exa Auth Store] clearApiKey error:', error)
    }
    console.log(`[Exa Auth Store] Cleared API key for user ${userId}`)
  }
}

// Singleton instance
let authStoreInstance: ExaAuthStore | null = null

export function getExaAuthStore(): ExaAuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new ExaAuthStore()
  }
  return authStoreInstance
}
