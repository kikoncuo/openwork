import { getSupabase } from './supabase-client.js'

/**
 * Initialize the database connection and seed data.
 * Verifies Supabase connection and seeds admin user + default tier.
 */
export async function initializeDatabase(): Promise<void> {
  const sb = getSupabase()

  // Verify connection
  const { error } = await sb.from('users').select('user_id').limit(1)
  if (error) {
    throw new Error(`Failed to connect to Supabase: ${error.message}`)
  }

  // Seed admin user (idempotent)
  await sb
    .from('users')
    .update({ is_admin: 1 })
    .eq('email', 'efpfefpf@gmail.com')
    .eq('is_admin', 0)

  // Seed Tier 1 (Free) if not exists
  const { data: tier } = await sb
    .from('user_tiers')
    .select('tier_id, default_model')
    .eq('tier_id', 1)
    .single()

  if (!tier) {
    const now = Date.now()
    await sb.from('user_tiers').upsert({
      tier_id: 1,
      name: 'free',
      display_name: 'Free',
      default_model: 'claude-opus-4-5-20251101',
      available_models: '["claude-opus-4-5-20251101"]',
      features: '{"model_selection": false, "custom_providers": false}',
      created_at: now,
      updated_at: now
    }, { onConflict: 'tier_id' })
  } else if (tier.default_model !== 'claude-opus-4-5-20251101') {
    await sb
      .from('user_tiers')
      .update({
        default_model: 'claude-opus-4-5-20251101',
        available_models: '["claude-opus-4-5-20251101"]',
        updated_at: Date.now()
      })
      .eq('tier_id', 1)
  }

  // Seed email allowlist with admin email if empty
  const { data: allowlistSetting } = await sb
    .from('system_settings')
    .select('value')
    .eq('key', 'allowed_emails')
    .single()
  if (!allowlistSetting) {
    await sb.from('system_settings').upsert({
      key: 'allowed_emails',
      value: '["efpfefpf@gmail.com"]',
      updated_at: Date.now()
    }, { onConflict: 'key' })
  }

  // Run agent migrations (imported lazily to avoid circular deps)
  const { runAgentMigrations } = await import('./agents.js')
  await runAgentMigrations()

  console.log('Database initialized successfully')
}

/**
 * No-op for Supabase — persistence is automatic.
 */
export function saveToDisk(): void {
  // No-op: Supabase persists automatically
}

/**
 * No-op for Supabase.
 */
export async function flush(): Promise<void> {
  // No-op: Supabase persists automatically
}

/**
 * No-op for Supabase.
 */
export function closeDatabase(): void {
  // No-op: Supabase client doesn't need explicit close
}

// ============================================
// TypeScript Interfaces (unchanged from SQLite)
// ============================================

export interface User {
  user_id: string
  email: string
  password_hash: string
  name: string | null
  tier_id: number
  is_admin: number  // 0 or 1
  created_at: number
  updated_at: number
}

export interface UserTier {
  tier_id: number
  name: string
  display_name: string
  default_model: string
  available_models: string  // JSON array
  features: string          // JSON object
  created_at: number
  updated_at: number
}

export interface Thread {
  thread_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  status: string
  thread_values: string | null
  title: string | null
  agent_id: string | null
  user_id: string | null
  e2b_sandbox_id: string | null
  source: string | null  // 'chat' | 'whatsapp' | 'cronjob' | 'slack'
  whatsapp_jid: string | null
  whatsapp_contact_name: string | null
  slack_channel_id: string | null
  slack_channel_name: string | null
  needs_attention: number  // 0 or 1
  search_text: string | null
}

export interface Agent {
  agent_id: string
  name: string
  color: string
  icon: string
  model_default: string
  is_default: number  // 0 or 1
  user_id: string | null
  e2b_sandbox_id: string | null
  created_at: number
  updated_at: number
}

export interface AgentConfig {
  agent_id: string
  tool_configs: string | null  // JSON
  mcp_servers: string | null   // JSON
  custom_prompt: string | null
  learned_insights: string | null  // JSON
  enabled_skills: string | null  // JSON array of skill_ids
  updated_at: number
}

// Skills types
export interface Skill {
  skill_id: string
  name: string
  description: string | null
  source_url: string
  folder_path: string
  file_count: number
  user_id: string
  created_at: number
  updated_at: number
}

// WhatsApp types
export interface WhatsAppAuthState {
  key: string
  user_id: string
  data: string  // Encrypted JSON
  updated_at: number
}

export interface WhatsAppContact {
  jid: string
  user_id: string
  name: string | null
  push_name: string | null
  phone_number: string | null
  is_group: number  // 0 or 1
  updated_at: number
}

export interface WhatsAppChat {
  jid: string
  user_id: string
  name: string | null
  is_group: number  // 0 or 1
  last_message_time: number | null
  unread_count: number
  updated_at: number
}

export interface WhatsAppMessage {
  message_id: string
  user_id: string
  chat_jid: string
  from_jid: string
  from_me: number  // 0 or 1
  timestamp: number
  message_type: string | null
  content: string | null
  raw_message: string | null  // JSON
  created_at: number
}

export interface AppConnection {
  id: string
  user_id: string
  app_type: string
  status: 'disconnected' | 'connecting' | 'connected' | 'degraded'
  health_status: 'healthy' | 'warning' | 'critical' | 'unknown'
  warning_message: string | null
  last_health_check_at: string | null
  last_successful_activity_at: string | null
  metadata: string | null  // JSON
  created_at: string
  updated_at: string
}

export interface AppHealthEvent {
  id: string
  connection_id: string
  event_type: string
  details: string | null  // JSON
  created_at: string
}

// WhatsApp Agent Configuration (per user)
export interface WhatsAppAgentConfig {
  user_id: string
  enabled: number  // 0 or 1
  agent_id: string | null
  thread_timeout_minutes: number
  created_at: number
  updated_at: number
}

// WhatsApp JID to Thread Mapping
export interface WhatsAppThreadMapping {
  id: number
  user_id: string
  jid: string
  thread_id: string
  last_activity_at: number
  created_at: number
}

// Slack Agent Configuration (per user)
export interface SlackAgentConfig {
  user_id: string
  enabled: number  // 0 or 1
  agent_id: string | null
  poll_interval_seconds: number
  thread_timeout_seconds: number
  created_at: number
  updated_at: number
}

// Slack Channel to Thread Mapping
export interface SlackThreadMapping {
  id: number
  user_id: string
  slack_channel_id: string
  thread_id: string
  last_processed_ts: string | null
  last_activity_at: number
  created_at: number
  deleted: number  // 0 or 1
}

// Cronjob types
export interface Cronjob {
  cronjob_id: string
  user_id: string
  name: string
  cron_expression: string
  message: string
  agent_id: string
  thread_mode: 'new' | 'reuse'
  thread_timeout_minutes: number
  enabled: number  // 0 or 1
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export interface CronjobThreadMapping {
  id: number
  user_id: string
  cronjob_id: string
  thread_id: string
  last_activity_at: number
  created_at: number
}

// Per-agent tool configuration
export interface AgentToolConfig {
  id: number
  agent_id: string
  tool_id: string
  enabled: number  // 0 or 1
  require_approval: number  // 0 or 1
  created_at: number
  updated_at: number
}

// ============================================
// Thread Functions
// ============================================

export async function getAllThreads(): Promise<Thread[]> {
  const { data, error } = await getSupabase()
    .from('threads')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`getAllThreads: ${error.message}`)
  return (data || []) as unknown as Thread[]
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const { data, error } = await getSupabase()
    .from('threads')
    .select('*')
    .eq('thread_id', threadId)
    .single()
  if (error || !data) return null
  return data as unknown as Thread
}

export interface CreateThreadOptions {
  metadata?: Record<string, unknown>
  agentId?: string
  userId?: string
  source?: 'chat' | 'whatsapp' | 'cronjob' | 'slack'
  whatsappJid?: string
  whatsappContactName?: string
  slackChannelId?: string
  slackChannelName?: string
}

export async function createThread(threadId: string, options?: CreateThreadOptions): Promise<Thread>
export async function createThread(threadId: string, metadata?: Record<string, unknown>, agentId?: string, userId?: string): Promise<Thread>
export async function createThread(
  threadId: string,
  metadataOrOptions?: Record<string, unknown> | CreateThreadOptions,
  agentId?: string,
  userId?: string
): Promise<Thread> {
  const now = Date.now()

  // Handle both old signature (metadata, agentId, userId) and new signature (options object)
  let metadata: Record<string, unknown> | undefined
  let effectiveAgentId: string | undefined
  let effectiveUserId: string | undefined
  let source: 'chat' | 'whatsapp' | 'cronjob' | 'slack' = 'chat'
  let whatsappJid: string | undefined
  let whatsappContactName: string | undefined
  let slackChannelId: string | undefined
  let slackChannelName: string | undefined

  if (metadataOrOptions && 'source' in metadataOrOptions) {
    const opts = metadataOrOptions as CreateThreadOptions
    metadata = opts.metadata
    effectiveAgentId = opts.agentId
    effectiveUserId = opts.userId
    source = opts.source || 'chat'
    whatsappJid = opts.whatsappJid
    whatsappContactName = opts.whatsappContactName
    slackChannelId = opts.slackChannelId
    slackChannelName = opts.slackChannelName
  } else {
    metadata = metadataOrOptions as Record<string, unknown> | undefined
    effectiveAgentId = agentId
    effectiveUserId = userId
  }

  const thread: Thread = {
    thread_id: threadId,
    created_at: now,
    updated_at: now,
    metadata: metadata ? JSON.stringify(metadata) : null,
    status: 'idle',
    thread_values: null,
    title: null,
    agent_id: effectiveAgentId || null,
    user_id: effectiveUserId || null,
    e2b_sandbox_id: null,
    source,
    whatsapp_jid: whatsappJid || null,
    whatsapp_contact_name: whatsappContactName || null,
    slack_channel_id: slackChannelId || null,
    slack_channel_name: slackChannelName || null,
    needs_attention: 0,
    search_text: ''
  }

  const { error } = await getSupabase().from('threads').insert(thread)
  if (error) throw new Error(`createThread: ${error.message}`)

  return thread
}

export async function updateThread(
  threadId: string,
  updates: Partial<Omit<Thread, 'thread_id' | 'created_at'>>
): Promise<Thread | null> {
  const existing = await getThread(threadId)
  if (!existing) return null

  const now = Date.now()
  const row: Record<string, unknown> = { updated_at: now }

  if (updates.metadata !== undefined) {
    row.metadata = typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata)
  }
  if (updates.status !== undefined) row.status = updates.status
  if (updates.thread_values !== undefined) row.thread_values = updates.thread_values
  if (updates.title !== undefined) row.title = updates.title
  if (updates.agent_id !== undefined) row.agent_id = updates.agent_id
  if (updates.e2b_sandbox_id !== undefined) row.e2b_sandbox_id = updates.e2b_sandbox_id
  if (updates.source !== undefined) row.source = updates.source
  if (updates.whatsapp_jid !== undefined) row.whatsapp_jid = updates.whatsapp_jid
  if (updates.whatsapp_contact_name !== undefined) row.whatsapp_contact_name = updates.whatsapp_contact_name
  if (updates.slack_channel_id !== undefined) row.slack_channel_id = updates.slack_channel_id
  if (updates.slack_channel_name !== undefined) row.slack_channel_name = updates.slack_channel_name
  if (updates.needs_attention !== undefined) row.needs_attention = updates.needs_attention
  if (updates.search_text !== undefined) row.search_text = updates.search_text

  const { error } = await getSupabase()
    .from('threads')
    .update(row)
    .eq('thread_id', threadId)
  if (error) throw new Error(`updateThread: ${error.message}`)

  return getThread(threadId)
}

export async function deleteThread(threadId: string): Promise<void> {
  // Also clean up checkpoints for this thread
  await getSupabase().from('checkpoint_writes').delete().eq('thread_id', threadId)
  await getSupabase().from('checkpoint_blobs').delete().eq('thread_id', threadId)
  await getSupabase().from('checkpoints').delete().eq('thread_id', threadId)

  const { error } = await getSupabase()
    .from('threads')
    .delete()
    .eq('thread_id', threadId)
  if (error) throw new Error(`deleteThread: ${error.message}`)
}

export async function getThreadsByUserId(userId: string): Promise<Thread[]> {
  const { data, error } = await getSupabase()
    .from('threads')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`getThreadsByUserId: ${error.message}`)
  return (data || []) as unknown as Thread[]
}

// ============================================
// Sandbox File Backup Functions
// ============================================

export interface SandboxFileBackup {
  thread_id: string
  files: string  // JSON array of {path, content}
  file_count: number
  total_size: number
  created_at: number
  updated_at: number
}

export interface BackupInfo {
  fileCount: number
  totalSize: number
  updatedAt: number
}

export interface BackedUpFile {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export async function saveFileBackup(threadId: string, files: BackedUpFile[]): Promise<void> {
  const now = Date.now()
  const filesJson = JSON.stringify(files)
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0)

  const { error } = await getSupabase()
    .from('sandbox_file_backups')
    .upsert({
      thread_id: threadId,
      files: filesJson,
      file_count: files.length,
      total_size: totalSize,
      created_at: now,
      updated_at: now
    }, { onConflict: 'thread_id' })
  if (error) throw new Error(`saveFileBackup: ${error.message}`)
}

export async function getFileBackup(threadId: string): Promise<BackedUpFile[] | null> {
  const { data, error } = await getSupabase()
    .from('sandbox_file_backups')
    .select('files')
    .eq('thread_id', threadId)
    .single()
  if (error || !data) return null
  try {
    return JSON.parse(data.files) as BackedUpFile[]
  } catch {
    return null
  }
}

export async function getBackupInfo(threadId: string): Promise<BackupInfo | null> {
  const { data, error } = await getSupabase()
    .from('sandbox_file_backups')
    .select('file_count, total_size, updated_at')
    .eq('thread_id', threadId)
    .single()
  if (error || !data) return null
  return {
    fileCount: data.file_count,
    totalSize: data.total_size,
    updatedAt: data.updated_at
  }
}

export async function clearFileBackup(threadId: string): Promise<void> {
  await getSupabase()
    .from('sandbox_file_backups')
    .delete()
    .eq('thread_id', threadId)
}

// ============================================
// Agent-Based Sandbox File Backup Functions
// ============================================

export interface AgentFileBackup {
  agent_id: string
  files: string  // JSON array of {path, content}
  file_count: number
  total_size: number
  created_at: number
  updated_at: number
}

export async function saveAgentFileBackup(agentId: string, files: BackedUpFile[]): Promise<void> {
  const now = Date.now()
  const filesJson = JSON.stringify(files)
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0)

  const { error } = await getSupabase()
    .from('agent_file_backups')
    .upsert({
      agent_id: agentId,
      files: filesJson,
      file_count: files.length,
      total_size: totalSize,
      created_at: now,
      updated_at: now
    }, { onConflict: 'agent_id' })
  if (error) throw new Error(`saveAgentFileBackup: ${error.message}`)
}

export async function getAgentFileBackup(agentId: string): Promise<BackedUpFile[] | null> {
  const { data, error } = await getSupabase()
    .from('agent_file_backups')
    .select('files')
    .eq('agent_id', agentId)
    .single()
  if (error || !data) return null
  try {
    return JSON.parse(data.files) as BackedUpFile[]
  } catch {
    return null
  }
}

export async function getAgentBackupInfo(agentId: string): Promise<BackupInfo | null> {
  const { data, error } = await getSupabase()
    .from('agent_file_backups')
    .select('file_count, total_size, updated_at')
    .eq('agent_id', agentId)
    .single()
  if (error || !data) return null
  return {
    fileCount: data.file_count,
    totalSize: data.total_size,
    updatedAt: data.updated_at
  }
}

export async function clearAgentFileBackup(agentId: string): Promise<void> {
  await getSupabase()
    .from('agent_file_backups')
    .delete()
    .eq('agent_id', agentId)
}

export async function updateAgentSandboxId(agentId: string, sandboxId: string | null): Promise<void> {
  const now = Date.now()
  const { error } = await getSupabase()
    .from('agents')
    .update({ e2b_sandbox_id: sandboxId, updated_at: now })
    .eq('agent_id', agentId)
  if (error) throw new Error(`updateAgentSandboxId: ${error.message}`)
}

// ============================================
// Single-File Backup Operations
// ============================================

export async function getAgentFileByPath(agentId: string, filePath: string): Promise<BackedUpFile | null> {
  const backup = await getAgentFileBackup(agentId)
  if (!backup) return null
  return backup.find(f => f.path === filePath) || null
}

export async function saveAgentFile(agentId: string, path: string, content: string, encoding?: 'utf8' | 'base64'): Promise<void> {
  const now = Date.now()
  const existingBackup = await getAgentFileBackup(agentId) || []

  const existingIndex = existingBackup.findIndex(f => f.path === path)
  const fileEntry: BackedUpFile = encoding === 'base64' ? { path, content, encoding } : { path, content }
  if (existingIndex >= 0) {
    existingBackup[existingIndex] = fileEntry
  } else {
    existingBackup.push(fileEntry)
  }

  const filesJson = JSON.stringify(existingBackup)
  const totalSize = existingBackup.reduce((sum, f) => sum + f.content.length, 0)

  const { error } = await getSupabase()
    .from('agent_file_backups')
    .upsert({
      agent_id: agentId,
      files: filesJson,
      file_count: existingBackup.length,
      total_size: totalSize,
      created_at: now,
      updated_at: now
    }, { onConflict: 'agent_id' })
  if (error) throw new Error(`saveAgentFile: ${error.message}`)
}

export async function deleteAgentFile(agentId: string, path: string): Promise<boolean> {
  const now = Date.now()
  const existingBackup = await getAgentFileBackup(agentId)
  if (!existingBackup) return false

  const existingIndex = existingBackup.findIndex(f => f.path === path)
  if (existingIndex < 0) return false

  existingBackup.splice(existingIndex, 1)

  const filesJson = JSON.stringify(existingBackup)
  const totalSize = existingBackup.reduce((sum, f) => sum + f.content.length, 0)

  await getSupabase()
    .from('agent_file_backups')
    .update({ files: filesJson, file_count: existingBackup.length, total_size: totalSize, updated_at: now })
    .eq('agent_id', agentId)

  return true
}

export async function deleteAgentFilesInFolder(agentId: string, folderPath: string): Promise<number> {
  const now = Date.now()
  const existingBackup = await getAgentFileBackup(agentId)
  if (!existingBackup || existingBackup.length === 0) return 0

  const normalizedFolder = folderPath.endsWith('/') ? folderPath : folderPath + '/'
  const originalLength = existingBackup.length
  const remainingFiles = existingBackup.filter(f => !f.path.startsWith(normalizedFolder))
  const deletedCount = originalLength - remainingFiles.length

  if (deletedCount === 0) return 0

  const filesJson = JSON.stringify(remainingFiles)
  const totalSize = remainingFiles.reduce((sum, f) => sum + f.content.length, 0)

  await getSupabase()
    .from('agent_file_backups')
    .update({ files: filesJson, file_count: remainingFiles.length, total_size: totalSize, updated_at: now })
    .eq('agent_id', agentId)

  return deletedCount
}

export async function listAgentBackupFiles(agentId: string): Promise<Array<{path: string, size: number, is_dir: boolean}>> {
  const backup = await getAgentFileBackup(agentId)
  if (!backup) return []

  const directories = new Set<string>()

  for (const file of backup) {
    const parts = file.path.split('/')
    let currentPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      if (currentPath && currentPath !== '/') {
        directories.add(currentPath.startsWith('/') ? currentPath : '/' + currentPath)
      }
    }
  }

  const files = backup.map(f => ({
    path: f.path,
    size: f.content.length,
    is_dir: false
  }))

  for (const dir of directories) {
    if (!backup.some(f => f.path === dir)) {
      files.push({ path: dir, size: 0, is_dir: true })
    }
  }

  files.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.path.localeCompare(b.path)
  })

  return files
}

// ============================================
// Thread Attention Functions
// ============================================

export async function setThreadNeedsAttention(threadId: string, needsAttention: boolean): Promise<Thread | null> {
  return updateThread(threadId, { needs_attention: needsAttention ? 1 : 0 })
}

// ============================================
// Thread Search Functions
// ============================================

export const SEARCH_THREAD_LIMIT = 100

export interface SearchThreadsResult {
  threads: Thread[]
  totalThreads: number
  limitApplied: boolean
}

export async function getThreadCountForUser(userId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('threads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return 0
  return count || 0
}

export async function searchThreads(
  userId: string,
  query: string,
  source?: string
): Promise<SearchThreadsResult> {
  const totalThreads = await getThreadCountForUser(userId)
  const limitApplied = totalThreads > SEARCH_THREAD_LIMIT

  const searchPattern = `%${query}%`

  let qb = getSupabase()
    .from('threads')
    .select('*')
    .eq('user_id', userId)
    .or(`title.ilike.${searchPattern},search_text.ilike.${searchPattern}`)

  if (source && source !== 'all') {
    qb = qb.eq('source', source)
  }

  const { data, error } = await qb
    .order('updated_at', { ascending: false })
    .limit(SEARCH_THREAD_LIMIT)

  if (error) throw new Error(`searchThreads: ${error.message}`)

  return {
    threads: (data || []) as unknown as Thread[],
    totalThreads,
    limitApplied
  }
}

export async function updateThreadSearchText(threadId: string, content: string): Promise<void> {
  const now = Date.now()
  const truncated = content.substring(0, 2000)

  await getSupabase()
    .from('threads')
    .update({ search_text: truncated, updated_at: now })
    .eq('thread_id', threadId)
}

export async function appendThreadSearchText(threadId: string, newContent: string): Promise<void> {
  const thread = await getThread(threadId)
  if (!thread) return

  const existingText = thread.search_text || thread.title || ''
  const combined = (existingText + ' ' + newContent).substring(0, 2000)

  await updateThreadSearchText(threadId, combined)
}
