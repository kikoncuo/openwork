/**
 * WhatsApp Auth Store - Supabase-based authentication state storage for Baileys
 * Adapted from SQLite version to use Supabase for persistence
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { AuthenticationCreds, SignalDataTypeMap } from 'baileys'
import { initAuthCreds, BufferJSON } from 'baileys'
import { getSupabase } from '../../db/supabase-client.js'
import { getOpenworkDir } from '../../storage.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get or create the encryption key for WhatsApp auth data
 */
function getEncryptionKey(): Buffer {
  const keyPath = join(getOpenworkDir(), 'whatsapp.key')

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

export interface SQLiteAuthState {
  creds: AuthenticationCreds
  keys: {
    get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => Promise<{ [id: string]: SignalDataTypeMap[T] | undefined }>
    set: (data: { [K in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[K] | null } }) => Promise<void>
  }
  saveCreds: () => Promise<void>
}

/**
 * SQLite-based auth store for Baileys (now backed by Supabase)
 */
export class SQLiteAuthStore {
  private tableName = 'whatsapp_auth_state'

  /**
   * Get the authentication state from Supabase for a specific user
   */
  async getAuthState(userId: string): Promise<SQLiteAuthState> {
    let creds: AuthenticationCreds

    const { data: row, error } = await getSupabase()
      .from(this.tableName)
      .select('*')
      .eq('key', 'creds')
      .eq('user_id', userId)
      .single()

    if (!error && row) {
      try {
        const decrypted = decrypt(row.data)
        creds = JSON.parse(decrypted, BufferJSON.reviver)
      } catch (e) {
        console.warn(`[WhatsApp Auth] Failed to decrypt creds for user ${userId}, creating new ones`)
        creds = initAuthCreds()
      }
    } else {
      creds = initAuthCreds()
    }

    const saveCreds = async (): Promise<void> => {
      const encrypted = encrypt(JSON.stringify(creds, BufferJSON.replacer))
      const now = Date.now()

      await getSupabase()
        .from(this.tableName)
        .upsert(
          { key: 'creds', user_id: userId, data: encrypted, updated_at: now },
          { onConflict: 'key,user_id' }
        )
    }

    const keys = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] | undefined }> => {
        const result: { [id: string]: SignalDataTypeMap[T] | undefined } = {}

        if (ids.length === 0) return result

        const keyNames = ids.map(id => `${type}-${id}`)

        const { data: rows, error: fetchError } = await getSupabase()
          .from(this.tableName)
          .select('key, data')
          .in('key', keyNames)
          .eq('user_id', userId)

        if (fetchError || !rows) return result

        for (const row of rows) {
          const id = row.key.replace(`${type}-`, '')
          try {
            const decrypted = decrypt(row.data)
            result[id] = JSON.parse(decrypted, BufferJSON.reviver)
          } catch (e) {
            console.warn(`[WhatsApp Auth] Failed to decrypt key ${row.key}`)
          }
        }

        return result
      },

      set: async (data: { [K in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[K] | null } }): Promise<void> => {
        const now = Date.now()

        for (const [type, entries] of Object.entries(data)) {
          if (!entries) continue

          for (const [id, value] of Object.entries(entries)) {
            const key = `${type}-${id}`
            if (value === null) {
              // Delete the key for this user
              await getSupabase()
                .from(this.tableName)
                .delete()
                .eq('key', key)
                .eq('user_id', userId)
            } else {
              // Upsert the key for this user
              const encrypted = encrypt(JSON.stringify(value, BufferJSON.replacer))
              await getSupabase()
                .from(this.tableName)
                .upsert(
                  { key, user_id: userId, data: encrypted, updated_at: now },
                  { onConflict: 'key,user_id' }
                )
            }
          }
        }
      },
    }

    return { creds, keys, saveCreds }
  }

  /**
   * Delete all authentication state for a user (logout)
   */
  async deleteAuthState(userId: string): Promise<void> {
    await getSupabase()
      .from(this.tableName)
      .delete()
      .eq('user_id', userId)
    console.log(`[WhatsApp Auth] Deleted auth state for user ${userId}`)
  }

  /**
   * Check if there's existing auth state for a user
   */
  async hasAuthState(userId: string): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from(this.tableName)
      .select('key')
      .eq('key', 'creds')
      .eq('user_id', userId)
      .single()

    return !error && !!data
  }

  /**
   * Get all user IDs that have authentication state
   */
  async getAllUserIds(): Promise<string[]> {
    const { data, error } = await getSupabase()
      .from(this.tableName)
      .select('user_id')

    if (error || !data) return []

    // Deduplicate user_ids
    const uniqueIds = [...new Set(data.map((row: { user_id: string }) => row.user_id))]
    return uniqueIds
  }
}

// Singleton instance
let authStoreInstance: SQLiteAuthStore | null = null

export function getAuthStore(): SQLiteAuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new SQLiteAuthStore()
  }
  return authStoreInstance
}
