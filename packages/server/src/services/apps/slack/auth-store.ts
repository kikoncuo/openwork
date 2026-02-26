/**
 * Slack Auth Store - Supabase-based token and team ID storage with encryption
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getSupabase } from '../../db/supabase-client.js'
import { getOpenworkDir } from '../../storage.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get or create the encryption key for Slack auth data
 */
function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'slack.key')

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

export interface SlackCredentials {
  token: string
  teamId: string
}

/**
 * Supabase-based auth store for Slack credentials
 */
export class SlackAuthStore {
  private tableName = 'slack_auth' as const

  /**
   * Save credentials for a user
   */
  async saveCredentials(userId: string, token: string, teamId: string): Promise<void> {
    try {
      const supabase = getSupabase()
      const now = Date.now()

      const encrypted = encrypt(JSON.stringify({ token, teamId }))
      const { error: credError } = await supabase.from(this.tableName).upsert(
        { key: 'credentials', user_id: userId, data: encrypted, updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (credError) throw credError

      const { error: tsError } = await supabase.from(this.tableName).upsert(
        { key: 'connected_at', user_id: userId, data: now.toString(), updated_at: now },
        { onConflict: 'key,user_id' }
      )
      if (tsError) throw tsError

      console.log(`[Slack Auth Store] Credentials saved for user ${userId}`)
    } catch (error) {
      console.error('[Slack Auth Store] saveCredentials error:', error)
      throw error
    }
  }

  /**
   * Get credentials for a user
   */
  async getCredentials(userId: string): Promise<SlackCredentials | null> {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from(this.tableName)
        .select('data')
        .eq('key', 'credentials')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      try {
        return JSON.parse(decrypt(data.data)) as SlackCredentials
      } catch {
        console.warn(`[Slack Auth Store] Failed to decrypt credentials for user ${userId}`)
        return null
      }
    } catch (error) {
      console.error('[Slack Auth Store] getCredentials error:', error)
      return null
    }
  }

  /**
   * Check if user has valid stored credentials
   */
  async hasValidCredentials(userId: string): Promise<boolean> {
    const creds = await this.getCredentials(userId)
    return creds !== null && !!creds.token && !!creds.teamId
  }

  /**
   * Clear stored credentials for a user
   */
  async clearCredentials(userId: string): Promise<void> {
    const supabase = getSupabase()
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('user_id', userId)
    if (error) {
      console.error('[Slack Auth Store] clearCredentials error:', error)
    }
    console.log(`[Slack Auth Store] Cleared credentials for user ${userId}`)
  }
}

// Singleton instance
let authStoreInstance: SlackAuthStore | null = null

export function getSlackAuthStore(): SlackAuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new SlackAuthStore()
  }
  return authStoreInstance
}
