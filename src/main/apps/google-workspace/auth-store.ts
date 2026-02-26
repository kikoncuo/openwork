/**
 * Google Workspace Auth Store - SQLite-based OAuth token storage
 * Adapted from WhatsApp auth-store.ts to use encrypted token storage
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getDb, saveToDisk } from '../../db'
import { getOpenworkDir } from '../../storage'
import type { GoogleTokens } from './types'

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
 * SQLite-based auth store for Google Workspace OAuth tokens
 */
export class GoogleAuthStore {
  private tableName = 'google_workspace_auth'

  /**
   * Save OAuth tokens
   */
  async saveTokens(tokens: GoogleTokens, email: string): Promise<void> {
    const db = getDb()
    const now = Date.now()

    // Save tokens (encrypted)
    const tokenData = encrypt(JSON.stringify(tokens))
    db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (key, data, updated_at) VALUES (?, ?, ?)`,
      ['tokens', tokenData, now]
    )

    // Save email (not encrypted - needed for display)
    db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (key, data, updated_at) VALUES (?, ?, ?)`,
      ['email', email, now]
    )

    // Save connected timestamp
    db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (key, data, updated_at) VALUES (?, ?, ?)`,
      ['connectedAt', String(now), now]
    )

    saveToDisk()
    console.log('[Google Auth] Saved tokens for:', email)
  }

  /**
   * Get stored OAuth tokens
   */
  async getTokens(): Promise<GoogleTokens | null> {
    const db = getDb()
    const stmt = db.prepare(`SELECT data FROM ${this.tableName} WHERE key = ?`)
    stmt.bind(['tokens'])

    if (stmt.step()) {
      const row = stmt.getAsObject() as { data: string }
      stmt.free()
      try {
        const decrypted = decrypt(row.data)
        return JSON.parse(decrypted) as GoogleTokens
      } catch (e) {
        console.warn('[Google Auth] Failed to decrypt tokens')
        return null
      }
    }

    stmt.free()
    return null
  }

  /**
   * Get stored email
   */
  async getEmail(): Promise<string | null> {
    const db = getDb()
    const stmt = db.prepare(`SELECT data FROM ${this.tableName} WHERE key = ?`)
    stmt.bind(['email'])

    if (stmt.step()) {
      const row = stmt.getAsObject() as { data: string }
      stmt.free()
      return row.data
    }

    stmt.free()
    return null
  }

  /**
   * Get connected timestamp
   */
  async getConnectedAt(): Promise<number | null> {
    const db = getDb()
    const stmt = db.prepare(`SELECT data FROM ${this.tableName} WHERE key = ?`)
    stmt.bind(['connectedAt'])

    if (stmt.step()) {
      const row = stmt.getAsObject() as { data: string }
      stmt.free()
      return parseInt(row.data, 10)
    }

    stmt.free()
    return null
  }

  /**
   * Check if tokens exist and are valid
   */
  async hasValidTokens(): Promise<boolean> {
    const tokens = await this.getTokens()
    if (!tokens) return false

    // Check if tokens are expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      // Tokens expired but we have refresh_token, so still valid for refresh
      return !!tokens.refresh_token
    }

    return true
  }

  /**
   * Clear all auth state (logout)
   */
  async clearTokens(): Promise<void> {
    const db = getDb()
    db.run(`DELETE FROM ${this.tableName}`)
    saveToDisk()
    console.log('[Google Auth] Cleared all auth state')
  }

  /**
   * Update tokens after refresh
   */
  async updateTokens(tokens: Partial<GoogleTokens>): Promise<void> {
    const currentTokens = await this.getTokens()
    if (!currentTokens) {
      throw new Error('No existing tokens to update')
    }

    const updatedTokens: GoogleTokens = {
      ...currentTokens,
      ...tokens
    }

    const db = getDb()
    const now = Date.now()
    const tokenData = encrypt(JSON.stringify(updatedTokens))
    db.run(
      `INSERT OR REPLACE INTO ${this.tableName} (key, data, updated_at) VALUES (?, ?, ?)`,
      ['tokens', tokenData, now]
    )
    saveToDisk()
    console.log('[Google Auth] Updated tokens')
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
