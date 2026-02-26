/**
 * User database operations (Supabase)
 */

import { v4 as uuid } from 'uuid'
import { getSupabase } from './supabase-client.js'
import type { User } from './index.js'

/**
 * Get a user by their ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data as unknown as User
}

/**
 * Get a user by their email address
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single()

  if (error || !data) return null
  return data as unknown as User
}

/**
 * Create a new user
 */
export interface CreateUserInput {
  email: string
  passwordHash: string
  name?: string
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const now = Date.now()
  const userId = uuid()

  const user: User = {
    user_id: userId,
    email: input.email.toLowerCase(),
    password_hash: input.passwordHash,
    name: input.name || null,
    tier_id: 1, // Default to Tier 1 (Free)
    is_admin: 0,
    created_at: now,
    updated_at: now
  }

  const { error } = await getSupabase()
    .from('users')
    .insert(user)

  if (error) throw new Error(`createUser: ${error.message}`)

  return user
}

/**
 * Update a user
 */
export interface UpdateUserInput {
  name?: string
  passwordHash?: string
}

export async function updateUser(userId: string, updates: UpdateUserInput): Promise<User | null> {
  const existing = await getUserById(userId)
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }

  if (updates.name !== undefined) {
    row.name = updates.name
  }
  if (updates.passwordHash !== undefined) {
    row.password_hash = updates.passwordHash
  }

  const { error } = await getSupabase()
    .from('users')
    .update(row)
    .eq('user_id', userId)

  if (error) throw new Error(`updateUser: ${error.message}`)

  return getUserById(userId)
}

/**
 * Delete a user
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const existing = await getUserById(userId)
  if (!existing) return false

  const { error } = await getSupabase()
    .from('users')
    .delete()
    .eq('user_id', userId)

  if (error) throw new Error(`deleteUser: ${error.message}`)

  return true
}

/**
 * Check if an email is already registered
 */
export async function isEmailTaken(email: string): Promise<boolean> {
  const user = await getUserByEmail(email)
  return user !== null
}
