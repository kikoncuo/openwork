/**
 * Microsoft Teams Auth Store - Supabase-based OAuth token storage with encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getSupabase } from '../../db/supabase-client.js'
import { getOpenworkDir } from '../../storage.js'
import type { MicrosoftTokens } from './types.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get or create the encryption key for Microsoft Teams auth data
 */
function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'microsoft-teams.key')

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
 * Supabase-based auth store for Microsoft Teams OAuth tokens
 */
export class TeamsAuthStore {
  private tableName = 'microsoft_teams_auth' as const

  /**
   * Save OAuth tokens for a user
   */
  async saveTokens(userId: string, tokens: MicrosoftTokens, email: string, displayName: string): Promise<void> {
    console.log('[Teams Auth Store] saveTokens called for user:', userId, 'email:', email)
    try {
      const supabase = getSupabase()
      const now = Date.now()

      // Save tokens
      const tokensEncrypted = encrypt(JSON.stringify(tokens))
      const { error: tokensError } = await supabase.from(this.tableName).upsert(
        { key: 'tokens', user_id: userId, data: tokensEncrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tokensError) throw tokensError

      // Save email
      const emailEncrypted = encrypt(email)
      const { error: emailError } = await supabase.from(this.tableName).upsert(
        { key: 'email', user_id: userId, data: emailEncrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (emailError) throw emailError

      // Save display name
      const nameEncrypted = encrypt(displayName)
      const { error: nameError } = await supabase.from(this.tableName).upsert(
        { key: 'display_name', user_id: userId, data: nameEncrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (nameError) throw nameError

      // Save connected_at timestamp
      const { error: tsError } = await supabase.from(this.tableName).upsert(
        { key: 'connected_at', user_id: userId, data: now.toString(), updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tsError) throw tsError

      console.log(`[Teams Auth Store] All data saved for user ${userId}`)
    } catch (error) {
      console.error('[Teams Auth Store] saveTokens error:', error)
      throw error
    }
  }

  /**
   * Get OAuth tokens for a user
   */
  async getTokens(userId: string): Promise<MicrosoftTokens | null> {
    try {
      const supabase = getSupabase()

      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'tokens')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      try {
        const decrypted = decrypt(data.data)
        return JSON.parse(decrypted) as MicrosoftTokens
      } catch (e) {
        console.warn(`[Teams Auth Store] Failed to decrypt tokens for user ${userId}:`, e)
        return null
      }
    } catch (error) {
      console.error('[Teams Auth Store] getTokens error:', error)
      return null
    }
  }

  /**
   * Update tokens (for token refresh)
   */
  async updateTokens(userId: string, updates: Partial<MicrosoftTokens>): Promise<void> {
    const existing = await this.getTokens(userId)
    if (!existing) return

    const updated = { ...existing, ...updates }
    const supabase = getSupabase()
    const now = Date.now()
    const encrypted = encrypt(JSON.stringify(updated))

    const { error } = await supabase
      .from(this.tableName)
      .update({ data: encrypted, updated_at: now })
      .eq('key', 'tokens')
      .eq('user_id', userId)
    if (error) throw error

    console.log(`[Teams Auth Store] Updated tokens for user ${userId}`)
  }

  /**
   * Get email for a user
   */
  async getEmail(userId: string): Promise<string | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'email')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      try {
        return decrypt(data.data)
      } catch {
        return null
      }
    } catch {
      return null
    }
  }

  /**
   * Get display name for a user
   */
  async getDisplayName(userId: string): Promise<string | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'display_name')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      try {
        return decrypt(data.data)
      } catch {
        return null
      }
    } catch {
      return null
    }
  }

  /**
   * Get connected_at timestamp for a user
   */
  async getConnectedAt(userId: string): Promise<number | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'connected_at')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      return parseInt(data.data, 10) || null
    } catch {
      return null
    }
  }

  /**
   * Check if user has valid tokens
   */
  async hasValidTokens(userId: string): Promise<boolean> {
    try {
      const tokens = await this.getTokens(userId)
      return tokens !== null && !!tokens.access_token
    } catch {
      return false
    }
  }

  /**
   * Clear all auth data for a user
   */
  async clearTokens(userId: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('user_id', userId)
    if (error) {
      console.error('[Teams Auth Store] clearTokens error:', error)
    }
    console.log(`[Teams Auth Store] Cleared tokens for user ${userId}`)
  }
}

// Singleton instance
let authStoreInstance: TeamsAuthStore | null = null

export function getTeamsAuthStore(): TeamsAuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new TeamsAuthStore()
  }
  return authStoreInstance
}
