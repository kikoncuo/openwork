/**
 * User database operations
 */

import { v4 as uuid } from 'uuid'
import { getDb, saveToDisk } from './index.js'
import type { User } from './index.js'

/**
 * Get a user by their ID
 */
export function getUserById(userId: string): User | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM users WHERE user_id = ?')
  stmt.bind([userId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const user = stmt.getAsObject() as unknown as User
  stmt.free()
  return user
}

/**
 * Get a user by their email address
 */
export function getUserByEmail(email: string): User | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM users WHERE email = ?')
  stmt.bind([email.toLowerCase()])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const user = stmt.getAsObject() as unknown as User
  stmt.free()
  return user
}

/**
 * Create a new user
 */
export interface CreateUserInput {
  email: string
  passwordHash: string
  name?: string
}

export function createUser(input: CreateUserInput): User {
  const database = getDb()
  const now = Date.now()
  const userId = uuid()

  database.run(
    `INSERT INTO users (user_id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, input.email.toLowerCase(), input.passwordHash, input.name || null, now, now]
  )

  saveToDisk()

  return {
    user_id: userId,
    email: input.email.toLowerCase(),
    password_hash: input.passwordHash,
    name: input.name || null,
    created_at: now,
    updated_at: now
  }
}

/**
 * Update a user
 */
export interface UpdateUserInput {
  name?: string
  passwordHash?: string
}

export function updateUser(userId: string, updates: UpdateUserInput): User | null {
  const database = getDb()
  const existing = getUserById(userId)

  if (!existing) return null

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.name !== undefined) {
    setClauses.push('name = ?')
    values.push(updates.name)
  }
  if (updates.passwordHash !== undefined) {
    setClauses.push('password_hash = ?')
    values.push(updates.passwordHash)
  }

  values.push(userId)

  database.run(`UPDATE users SET ${setClauses.join(', ')} WHERE user_id = ?`, values)

  saveToDisk()

  return getUserById(userId)
}

/**
 * Delete a user
 */
export function deleteUser(userId: string): boolean {
  const database = getDb()
  const existing = getUserById(userId)

  if (!existing) return false

  database.run('DELETE FROM users WHERE user_id = ?', [userId])
  saveToDisk()

  return true
}

/**
 * Check if an email is already registered
 */
export function isEmailTaken(email: string): boolean {
  return getUserByEmail(email) !== null
}
