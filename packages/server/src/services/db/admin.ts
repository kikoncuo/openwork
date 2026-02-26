/**
 * Admin database operations - cross-user data access (no user_id filtering)
 */

import { getSupabase } from './supabase-client.js'
import type {
  User,
  UserTier,
  Thread,
  Agent,
  Skill,
  Cronjob,
  WhatsAppContact,
  WhatsAppChat,
  AppConnection
} from './index.js'

// ============================================
// Stats
// ============================================

export interface AdminStats {
  totalUsers: number
  totalThreads: number
  totalAgents: number
  totalSkills: number
  totalCronjobs: number
  totalWebhooks: number
  totalAppConnections: number
  totalWhatsAppContacts: number
  totalWhatsAppChats: number
  totalRuns: number
}

export async function adminGetStats(): Promise<AdminStats> {
  const sb = getSupabase()

  const count = async (table: string): Promise<number> => {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
    if (error) return 0
    return count || 0
  }

  const [
    totalUsers, totalThreads, totalAgents, totalSkills,
    totalCronjobs, totalWebhooks, totalAppConnections,
    totalWhatsAppContacts, totalWhatsAppChats, totalRuns
  ] = await Promise.all([
    count('users'), count('threads'), count('agents'), count('skills'),
    count('cronjobs'), count('webhooks'), count('app_connections'),
    count('whatsapp_contacts'), count('whatsapp_chats'), count('runs'),
  ])

  return {
    totalUsers, totalThreads, totalAgents, totalSkills,
    totalCronjobs, totalWebhooks, totalAppConnections,
    totalWhatsAppContacts, totalWhatsAppChats, totalRuns,
  }
}

// ============================================
// Users
// ============================================

export async function getAllUsers(limit = 50, offset = 0): Promise<User[]> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`getAllUsers: ${error.message}`)
  return (data || []) as unknown as User[]
}

export async function adminUpdateUser(
  userId: string,
  updates: { name?: string; tier_id?: number; is_admin?: number }
): Promise<User | null> {
  const { data: existing } = await getSupabase()
    .from('users')
    .select('user_id')
    .eq('user_id', userId)
    .single()
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }
  if (updates.name !== undefined) row.name = updates.name
  if (updates.tier_id !== undefined) row.tier_id = updates.tier_id
  if (updates.is_admin !== undefined) row.is_admin = updates.is_admin

  await getSupabase().from('users').update(row).eq('user_id', userId)

  const { data } = await getSupabase()
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single()
  return (data as unknown as User) || null
}

export async function adminDeleteUser(userId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('users')
    .select('user_id')
    .eq('user_id', userId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('users').delete().eq('user_id', userId)
  if (error) throw new Error(`adminDeleteUser: ${error.message}`)
  return true
}

// ============================================
// Tiers
// ============================================

export interface ParsedUserTier {
  tier_id: number
  name: string
  display_name: string
  default_model: string
  available_models: string[]
  features: Record<string, boolean>
  created_at: number
  updated_at: number
}

function parseTier(raw: UserTier): ParsedUserTier {
  return {
    ...raw,
    available_models: JSON.parse(raw.available_models),
    features: JSON.parse(raw.features),
  }
}

export async function getAllTiers(limit = 50, offset = 0): Promise<ParsedUserTier[]> {
  const { data, error } = await getSupabase()
    .from('user_tiers')
    .select('*')
    .order('tier_id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`getAllTiers: ${error.message}`)
  return (data || []).map((t: unknown) => parseTier(t as UserTier))
}

export async function adminCreateTier(input: {
  name: string
  display_name: string
  default_model: string
  available_models: string[]
  features: Record<string, boolean>
}): Promise<ParsedUserTier> {
  const now = Date.now()

  const { data, error } = await getSupabase()
    .from('user_tiers')
    .insert({
      name: input.name,
      display_name: input.display_name,
      default_model: input.default_model,
      available_models: JSON.stringify(input.available_models),
      features: JSON.stringify(input.features),
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()
  if (error) throw new Error(`adminCreateTier: ${error.message}`)

  return parseTier(data as unknown as UserTier)
}

export async function adminUpdateTier(
  tierId: number,
  updates: {
    name?: string
    display_name?: string
    default_model?: string
    available_models?: string[]
    features?: Record<string, boolean>
  }
): Promise<ParsedUserTier | null> {
  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }

  if (updates.name !== undefined) row.name = updates.name
  if (updates.display_name !== undefined) row.display_name = updates.display_name
  if (updates.default_model !== undefined) row.default_model = updates.default_model
  if (updates.available_models !== undefined) row.available_models = JSON.stringify(updates.available_models)
  if (updates.features !== undefined) row.features = JSON.stringify(updates.features)

  await getSupabase().from('user_tiers').update(row).eq('tier_id', tierId)

  const { data, error } = await getSupabase()
    .from('user_tiers')
    .select('*')
    .eq('tier_id', tierId)
    .single()
  if (error || !data) return null
  return parseTier(data as unknown as UserTier)
}

// ============================================
// Threads
// ============================================

export async function adminGetAllThreads(limit = 50, offset = 0): Promise<Thread[]> {
  const { data, error } = await getSupabase()
    .from('threads')
    .select('*')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllThreads: ${error.message}`)
  return (data || []) as unknown as Thread[]
}

export async function adminDeleteThread(threadId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('threads')
    .select('thread_id')
    .eq('thread_id', threadId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('threads').delete().eq('thread_id', threadId)
  if (error) throw new Error(`adminDeleteThread: ${error.message}`)
  return true
}

// ============================================
// Agents
// ============================================

export async function adminGetAllAgents(limit = 50, offset = 0): Promise<Agent[]> {
  const { data, error } = await getSupabase()
    .from('agents')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllAgents: ${error.message}`)
  return (data || []) as unknown as Agent[]
}

export async function adminDeleteAgent(agentId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('agents')
    .select('agent_id')
    .eq('agent_id', agentId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('agents').delete().eq('agent_id', agentId)
  if (error) throw new Error(`adminDeleteAgent: ${error.message}`)
  return true
}

// ============================================
// Skills
// ============================================

export async function adminGetAllSkills(limit = 50, offset = 0): Promise<Skill[]> {
  const { data, error } = await getSupabase()
    .from('skills')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllSkills: ${error.message}`)
  return (data || []) as unknown as Skill[]
}

export async function adminDeleteSkill(skillId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('skills')
    .select('skill_id')
    .eq('skill_id', skillId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('skills').delete().eq('skill_id', skillId)
  if (error) throw new Error(`adminDeleteSkill: ${error.message}`)
  return true
}

// ============================================
// Cronjobs
// ============================================

export async function adminGetAllCronjobs(limit = 50, offset = 0): Promise<Cronjob[]> {
  const { data, error } = await getSupabase()
    .from('cronjobs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllCronjobs: ${error.message}`)
  return (data || []) as unknown as Cronjob[]
}

export async function adminDeleteCronjob(cronjobId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('cronjobs')
    .select('cronjob_id')
    .eq('cronjob_id', cronjobId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('cronjobs').delete().eq('cronjob_id', cronjobId)
  if (error) throw new Error(`adminDeleteCronjob: ${error.message}`)
  return true
}

// ============================================
// Webhooks
// ============================================

export interface Webhook {
  id: string
  user_id: string
  name: string
  url: string
  secret: string | null
  event_types: string
  enabled: number
  retry_count: number
  timeout_ms: number
  created_at: string
  updated_at: string
}

export async function adminGetAllWebhooks(limit = 50, offset = 0): Promise<Webhook[]> {
  const { data, error } = await getSupabase()
    .from('webhooks')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllWebhooks: ${error.message}`)
  return (data || []) as unknown as Webhook[]
}

export async function adminDeleteWebhook(webhookId: string): Promise<boolean> {
  const { data: existing } = await getSupabase()
    .from('webhooks')
    .select('id')
    .eq('id', webhookId)
    .single()
  if (!existing) return false

  const { error } = await getSupabase().from('webhooks').delete().eq('id', webhookId)
  if (error) throw new Error(`adminDeleteWebhook: ${error.message}`)
  return true
}

// ============================================
// App Connections
// ============================================

export async function adminGetAllAppConnections(limit = 50, offset = 0): Promise<AppConnection[]> {
  const { data, error } = await getSupabase()
    .from('app_connections')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllAppConnections: ${error.message}`)
  return (data || []) as unknown as AppConnection[]
}

// ============================================
// WhatsApp
// ============================================

export async function adminGetAllWhatsAppContacts(limit = 50, offset = 0): Promise<WhatsAppContact[]> {
  const { data, error } = await getSupabase()
    .from('whatsapp_contacts')
    .select('*')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllWhatsAppContacts: ${error.message}`)
  return (data || []) as unknown as WhatsAppContact[]
}

export async function adminGetAllWhatsAppChats(limit = 50, offset = 0): Promise<WhatsAppChat[]> {
  const { data, error } = await getSupabase()
    .from('whatsapp_chats')
    .select('*')
    .order('last_message_time', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllWhatsAppChats: ${error.message}`)
  return (data || []) as unknown as WhatsAppChat[]
}

// ============================================
// Runs
// ============================================

export interface Run {
  run_id: string
  thread_id: string
  assistant_id: string | null
  created_at: number
  updated_at: number
  status: string | null
  metadata: string | null
  kwargs: string | null
}

export async function adminGetAllRuns(limit = 50, offset = 0): Promise<Run[]> {
  const { data, error } = await getSupabase()
    .from('runs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`adminGetAllRuns: ${error.message}`)
  return (data || []) as unknown as Run[]
}

// ============================================
// System Settings
// ============================================

export async function getSystemSetting(key: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .single()
  if (error || !data) return null
  return data.value
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  const now = Date.now()
  const { error } = await getSupabase()
    .from('system_settings')
    .upsert({ key, value, updated_at: now }, { onConflict: 'key' })
  if (error) throw new Error(`setSystemSetting: ${error.message}`)
}

// ============================================
// Generic Record Update
// ============================================

const EDITABLE_TABLES: Record<string, { idColumn: string; allowed: string[] }> = {
  users:              { idColumn: 'user_id',    allowed: ['name', 'tier_id', 'is_admin'] },
  user_tiers:         { idColumn: 'tier_id',    allowed: ['name', 'display_name', 'default_model', 'available_models', 'features'] },
  threads:            { idColumn: 'thread_id',  allowed: ['title', 'status', 'source'] },
  agents:             { idColumn: 'agent_id',   allowed: ['name', 'color', 'icon', 'model_default', 'is_default'] },
  skills:             { idColumn: 'skill_id',   allowed: ['name', 'description'] },
  cronjobs:           { idColumn: 'cronjob_id', allowed: ['name', 'cron_expression', 'message', 'enabled', 'thread_mode'] },
  webhooks:           { idColumn: 'id',         allowed: ['name', 'url', 'event_types', 'enabled'] },
  app_connections:    { idColumn: 'id',         allowed: ['status', 'health_status'] },
  whatsapp_contacts:  { idColumn: 'jid',        allowed: ['name'] },
  whatsapp_chats:     { idColumn: 'jid',        allowed: ['name'] },
  system_settings:    { idColumn: 'key',        allowed: ['value'] },
}

export async function adminUpdateRecord(
  table: string,
  idValue: string | number,
  updates: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const config = EDITABLE_TABLES[table]
  if (!config) return null

  const sb = getSupabase()

  // Filter to allowed columns only
  const row: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(updates)) {
    if (config.allowed.includes(key)) {
      row[key] = val
    }
  }
  if (Object.keys(row).length === 0) return null

  // Check record exists
  const { data: existing } = await sb
    .from(table)
    .select(config.idColumn)
    .eq(config.idColumn, idValue)
    .single()
  if (!existing) return null

  await sb.from(table).update(row).eq(config.idColumn, idValue)

  const { data } = await sb
    .from(table)
    .select('*')
    .eq(config.idColumn, idValue)
    .single()
  return (data as Record<string, unknown>) || null
}

export function getEditableTables(): string[] {
  return Object.keys(EDITABLE_TABLES)
}

// ============================================
// SQL Runner
// ============================================

export async function adminRunSQL(query: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const trimmed = query.trim()

  // Only allow SELECT statements
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error('Only SELECT queries are allowed')
  }

  // Reject multi-statement queries
  const withoutStrings = trimmed.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
  if (withoutStrings.includes(';') && withoutStrings.indexOf(';') < withoutStrings.length - 1) {
    throw new Error('Multi-statement queries are not allowed')
  }

  // Use Supabase RPC or direct query via the REST API
  // Since Supabase JS client doesn't support raw SQL directly,
  // we'll use the rpc method or a workaround
  const sb = getSupabase()

  // Strip trailing semicolon for Postgres compatibility
  const cleanQuery = trimmed.replace(/;\s*$/, '')

  // Use Supabase's rpc to run raw SQL (requires a function)
  // Alternative: use the postgres connection directly
  // For now, we'll create a simple wrapper
  const { data, error } = await sb.rpc('admin_run_sql', { query_text: cleanQuery })

  if (error) {
    // If the RPC function doesn't exist, fall back to a simpler approach
    throw new Error(`SQL query failed: ${error.message}`)
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { columns: [], rows: [] }
  }

  const columns = Object.keys(data[0])
  const rows = data.slice(0, 1000).map((row: Record<string, unknown>) => columns.map(col => row[col]))

  return { columns, rows }
}
