/**
 * Skills database CRUD operations (Supabase)
 */

import { v4 as uuidv4 } from 'uuid'
import { getSupabase } from './supabase-client.js'
import type { Skill } from './index.js'

// Re-export Skill type
export type { Skill }

/**
 * Create a new skill record
 */
export async function createSkill(input: {
  name: string
  description: string | null
  source_url: string
  folder_path: string
  file_count: number
  user_id: string
}): Promise<Skill> {
  const now = Date.now()
  const skillId = uuidv4()

  const skill: Skill = {
    skill_id: skillId,
    name: input.name,
    description: input.description,
    source_url: input.source_url,
    folder_path: input.folder_path,
    file_count: input.file_count,
    user_id: input.user_id,
    created_at: now,
    updated_at: now,
  }

  const { error } = await getSupabase().from('skills').insert(skill)
  if (error) throw new Error(`createSkill: ${error.message}`)

  return skill
}

/**
 * Get a skill by ID
 */
export async function getSkill(skillId: string): Promise<Skill | null> {
  const { data, error } = await getSupabase()
    .from('skills')
    .select('*')
    .eq('skill_id', skillId)
    .single()
  if (error || !data) return null
  return data as unknown as Skill
}

/**
 * Get a skill by source URL for a user (to prevent duplicates)
 */
export async function getSkillBySourceUrl(userId: string, sourceUrl: string): Promise<Skill | null> {
  const { data, error } = await getSupabase()
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .eq('source_url', sourceUrl)
    .single()
  if (error || !data) return null
  return data as unknown as Skill
}

/**
 * Get all skills for a user
 */
export async function getSkillsByUserId(userId: string): Promise<Skill[]> {
  const { data, error } = await getSupabase()
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`getSkillsByUserId: ${error.message}`)
  return (data || []) as unknown as Skill[]
}

/**
 * Update a skill
 */
export async function updateSkill(
  skillId: string,
  updates: Partial<Omit<Skill, 'skill_id' | 'user_id' | 'created_at'>>
): Promise<Skill | null> {
  const existing = await getSkill(skillId)
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, string | number | null> = { updated_at: now }

  if (updates.name !== undefined) row.name = updates.name
  if (updates.description !== undefined) row.description = updates.description
  if (updates.source_url !== undefined) row.source_url = updates.source_url
  if (updates.folder_path !== undefined) row.folder_path = updates.folder_path
  if (updates.file_count !== undefined) row.file_count = updates.file_count

  const { error } = await getSupabase()
    .from('skills')
    .update(row)
    .eq('skill_id', skillId)
  if (error) throw new Error(`updateSkill: ${error.message}`)

  return getSkill(skillId)
}

/**
 * Delete a skill
 */
export async function deleteSkill(skillId: string): Promise<boolean> {
  const existing = await getSkill(skillId)
  if (!existing) return false

  const { error } = await getSupabase()
    .from('skills')
    .delete()
    .eq('skill_id', skillId)
  if (error) throw new Error(`deleteSkill: ${error.message}`)

  return true
}

/**
 * Get skills by IDs (for loading enabled skills for an agent)
 */
export async function getSkillsByIds(skillIds: string[]): Promise<Skill[]> {
  if (skillIds.length === 0) return []

  const { data, error } = await getSupabase()
    .from('skills')
    .select('*')
    .in('skill_id', skillIds)
  if (error) throw new Error(`getSkillsByIds: ${error.message}`)
  return (data || []) as unknown as Skill[]
}
