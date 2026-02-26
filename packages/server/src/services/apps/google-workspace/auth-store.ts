/**
 * Google Workspace Auth Store - Supabase-based OAuth token storage with encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getSupabase } from '../../db/supabase-client.js'
import { getOpenworkDir } from '../../storage.js'
import type { GoogleTokens } from './types.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get or create the encryption key for Google Workspace auth data
 */
function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'google-workspace.key')

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
 * Supabase-based auth store for Google Workspace OAuth tokens
 */
export class GoogleAuthStore {
  private tableName = 'google_workspace_auth' as const

  /**
   * Save OAuth tokens for a user
   */
  async saveTokens(userId: string, tokens: GoogleTokens, email: string): Promise<void> {
    console.log('[Google Auth Store] saveTokens called for user:', userId, 'email:', email)
    try {
      const supabase = getSupabase()
      const now = Date.now()

      // Save tokens
      console.log('[Google Auth Store] Encrypting and saving tokens...')
      const tokensEncrypted = encrypt(JSON.stringify(tokens))
      const { error: tokensError } = await supabase.from(this.tableName).upsert(
        { key: 'tokens', user_id: userId, data: tokensEncrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tokensError) throw tokensError
      console.log('[Google Auth Store] Tokens saved')

      // Save email
      console.log('[Google Auth Store] Encrypting and saving email...')
      const emailEncrypted = encrypt(email)
      const { error: emailError } = await supabase.from(this.tableName).upsert(
        { key: 'email', user_id: userId, data: emailEncrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (emailError) throw emailError
      console.log('[Google Auth Store] Email saved')

      // Save connected_at timestamp
      console.log('[Google Auth Store] Saving connected_at timestamp...')
      const { error: tsError } = await supabase.from(this.tableName).upsert(
        { key: 'connected_at', user_id: userId, data: now.toString(), updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tsError) throw tsError
      console.log('[Google Auth Store] Timestamp saved')

      console.log(`[Google Auth Store] All data saved for user ${userId}`)
    } catch (error) {
      console.error('[Google Auth Store] saveTokens error:', error)
      throw error
    }
  }

  /**
   * Get OAuth tokens for a user
   */
  async getTokens(userId: string): Promise<GoogleTokens | null> {
    console.log('[Google Auth Store] getTokens called for user:', userId)
    try {
      const supabase = getSupabase()

      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'tokens')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        console.log('[Google Auth Store] No tokens found')
        return null
      }

      console.log('[Google Auth Store] Found token row')

      try {
        const decrypted = decrypt(data.data)
        return JSON.parse(decrypted) as GoogleTokens
      } catch (e) {
        console.warn(`[Google Auth Store] Failed to decrypt tokens for user ${userId}:`, e)
        return null
      }
    } catch (error) {
      console.error('[Google Auth Store] getTokens error:', error)
      console.error('[Google Auth Store] Error stack:', error instanceof Error ? error.stack : 'no stack')
      throw error
    }
  }

  /**
   * Update tokens (for token refresh)
   */
  async updateTokens(userId: string, updates: Partial<GoogleTokens>): Promise<void> {
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

    console.log(`[Google Auth Store] Updated tokens for user ${userId}`)
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
    } catch (error) {
      console.error('[Google Auth Store] getEmail error:', error)
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
    } catch (error) {
      console.error('[Google Auth Store] getConnectedAt error:', error)
      return null
    }
  }

  /**
   * Check if user has valid tokens
   */
  async hasValidTokens(userId: string): Promise<boolean> {
    console.log('[Google Auth Store] Checking hasValidTokens for user:', userId)
    try {
      const tokens = await this.getTokens(userId)
      const result = tokens !== null && !!tokens.access_token
      console.log('[Google Auth Store] hasValidTokens result:', result)
      return result
    } catch (error) {
      console.error('[Google Auth Store] hasValidTokens error:', error)
      // Return false instead of throwing - treat errors as "no valid tokens"
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
      console.error('[Google Auth Store] clearTokens error:', error)
    }
    console.log(`[Google Auth Store] Cleared tokens for user ${userId}`)
  }
}

// Singleton instance
let authStoreInstance: GoogleAuthStore | null = null

export function getGoogleAuthStore(): GoogleAuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new GoogleAuthStore()
  }
  return authStoreInstance
}
