/**
 * WhatsApp Auth Store - SQLite-based authentication state storage for Baileys
 * Adapted from whatsapp-rest/auth-store.ts to use local SQLite instead of Supabase
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { AuthenticationCreds, SignalDataTypeMap } from 'baileys'
import { initAuthCreds, BufferJSON } from 'baileys'
import { getDb, saveToDisk } from '../../db/index.js'
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
 * SQLite-based auth store for Baileys
 * Since this is a local desktop app, we don't need userId - there's only one user
 */
export class SQLiteAuthStore {
  private tableName = 'whatsapp_auth_state'

  /**
   * Get the authentication state from SQLite for a specific user
   */
  async getAuthState(userId: string): Promise<SQLiteAuthState> {
    let creds: AuthenticationCreds

    const db = getDb()
    const stmt = db.prepare(`SELECT data FROM ${this.tableName} WHERE key = ? AND user_id = ?`)
    stmt.bind(['creds', userId])

    if (stmt.step()) {
      const row = stmt.getAsObject() as { data: string }
      stmt.free()
      try {
        const decrypted = decrypt(row.data)
        creds = JSON.parse(decrypted, BufferJSON.reviver)
      } catch (e) {
        console.warn(`[WhatsApp Auth] Failed to decrypt creds for user ${userId}, creating new ones`)
        creds = initAuthCreds()
      }
    } else {
      stmt.free()
      creds = initAuthCreds()
    }

    const saveCreds = async (): Promise<void> => {
      const encrypted = encrypt(JSON.stringify(creds, BufferJSON.replacer))
      const now = Date.now()

      const database = getDb()
      database.run(
        `INSERT OR REPLACE INTO ${this.tableName} (key, user_id, data, updated_at) VALUES (?, ?, ?, ?)`,
        ['creds', userId, encrypted, now]
      )
      saveToDisk()
    }

    const keys = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] | undefined }> => {
        const result: { [id: string]: SignalDataTypeMap[T] | undefined } = {}

        if (ids.length === 0) return result

        const database = getDb()
        const keyNames = ids.map(id => `${type}-${id}`)

        // We can't bind array for IN clause easily in sql.js, so we construct placeholders
        // But we ALSO need to filter by user_id for EACH key potentially, or just WHERE key IN (...) AND user_id = ?
        // Since (key, user_id) is PK, this is safe.
        const placeholders = keyNames.map(() => '?').join(',')

        const stmt = database.prepare(
          `SELECT key, data FROM ${this.tableName} WHERE key IN (${placeholders}) AND user_id = ?`
        )
        stmt.bind([...keyNames, userId])

        while (stmt.step()) {
          const row = stmt.getAsObject() as { key: string; data: string }
          const id = row.key.replace(`${type}-`, '')
          try {
            const decrypted = decrypt(row.data)
            result[id] = JSON.parse(decrypted, BufferJSON.reviver)
          } catch (e) {
            console.warn(`[WhatsApp Auth] Failed to decrypt key ${row.key}`)
          }
        }
        stmt.free()

        return result
      },

      set: async (data: { [K in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[K] | null } }): Promise<void> => {
        const database = getDb()
        const now = Date.now()

        for (const [type, entries] of Object.entries(data)) {
          if (!entries) continue

          for (const [id, value] of Object.entries(entries)) {
            const key = `${type}-${id}`
            if (value === null) {
              // Delete the key for this user
              database.run(`DELETE FROM ${this.tableName} WHERE key = ? AND user_id = ?`, [key, userId])
            } else {
              // Upsert the key for this user
              const encrypted = encrypt(JSON.stringify(value, BufferJSON.replacer))
              database.run(
                `INSERT OR REPLACE INTO ${this.tableName} (key, user_id, data, updated_at) VALUES (?, ?, ?, ?)`,
                [key, userId, encrypted, now]
              )
            }
          }
        }

        saveToDisk()
      },
    }

    return { creds, keys, saveCreds }
  }

  /**
   * Delete all authentication state for a user (logout)
   */
  async deleteAuthState(userId: string): Promise<void> {
    const db = getDb()
    db.run(`DELETE FROM ${this.tableName} WHERE user_id = ?`, [userId])
    saveToDisk()
    console.log(`[WhatsApp Auth] Deleted auth state for user ${userId}`)
  }

  /**
   * Check if there's existing auth state for a user
   */
  async hasAuthState(userId: string): Promise<boolean> {
    const db = getDb()
    const stmt = db.prepare(`SELECT key FROM ${this.tableName} WHERE key = ? AND user_id = ?`)
    stmt.bind(['creds', userId])
    const hasData = stmt.step()
    stmt.free()
    return hasData
  }

  /**
   * Get all user IDs that have authentication state
   */
  async getAllUserIds(): Promise<string[]> {
    const db = getDb()
    const stmt = db.prepare(`SELECT DISTINCT user_id FROM ${this.tableName}`)
    const userIds: string[] = []

    while (stmt.step()) {
      const row = stmt.getAsObject() as { user_id: string }
      userIds.push(row.user_id)
    }
    stmt.free()

    return userIds
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
