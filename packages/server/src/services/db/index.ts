import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getDbPath } from '../storage.js'

let db: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

/**
 * Save database to disk (debounced)
 */
export function saveToDisk(): void {
  if (!db) return

  dirty = true

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    if (db && dirty) {
      const data = db.export()
      writeFileSync(getDbPath(), Buffer.from(data))
      dirty = false
    }
  }, 100)
}

/**
 * Force immediate save
 */
export async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (db && dirty) {
    const data = db.export()
    writeFileSync(getDbPath(), Buffer.from(data))
    dirty = false
  }
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.')
  }
  return db
}

export async function initializeDatabase(): Promise<SqlJsDatabase> {
  const dbPath = getDbPath()
  console.log('Initializing database at:', dbPath)

  const SQL = await initSqlJs()

  // Load existing database if it exists
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    // Ensure directory exists
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    db = new SQL.Database()
  }

  // Create tables if they don't exist
  // Users table for authentication
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT,
      status TEXT DEFAULT 'idle',
      thread_values TEXT,
      title TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
      assistant_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT,
      metadata TEXT,
      kwargs TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS assistants (
      assistant_id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      name TEXT,
      model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Multi-agent support tables
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8B5CF6',
      icon TEXT NOT NULL DEFAULT 'bot',
      model_default TEXT DEFAULT 'claude-sonnet-4-5-20250929',
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      agent_id TEXT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
      tool_configs TEXT,
      mcp_servers TEXT,
      custom_prompt TEXT,
      learned_insights TEXT,
      updated_at INTEGER NOT NULL
    )
  `)

  // Add agent_id column to threads if it doesn't exist
  // SQLite doesn't have IF NOT EXISTS for columns, so we check pragmatically
  const threadColumns = db.exec("PRAGMA table_info(threads)")
  const hasAgentId = threadColumns[0]?.values?.some((col) => col[1] === 'agent_id')
  if (!hasAgentId) {
    db.run(`ALTER TABLE threads ADD COLUMN agent_id TEXT REFERENCES agents(agent_id)`)
  }

  // Add user_id column to threads if it doesn't exist
  const hasThreadUserId = threadColumns[0]?.values?.some((col) => col[1] === 'user_id')
  if (!hasThreadUserId) {
    db.run(`ALTER TABLE threads ADD COLUMN user_id TEXT REFERENCES users(user_id)`)
  }

  // Add e2b_sandbox_id column to threads if it doesn't exist
  const hasE2bSandboxId = threadColumns[0]?.values?.some((col) => col[1] === 'e2b_sandbox_id')
  if (!hasE2bSandboxId) {
    db.run(`ALTER TABLE threads ADD COLUMN e2b_sandbox_id TEXT`)
  }

  // Add user_id column to agents if it doesn't exist
  const agentColumns = db.exec("PRAGMA table_info(agents)")
  const hasAgentUserId = agentColumns[0]?.values?.some((col) => col[1] === 'user_id')
  if (!hasAgentUserId) {
    db.run(`ALTER TABLE agents ADD COLUMN user_id TEXT REFERENCES users(user_id)`)
  }

  // Add e2b_sandbox_id column to agents if it doesn't exist
  const hasAgentSandboxId = agentColumns[0]?.values?.some((col) => col[1] === 'e2b_sandbox_id')
  if (!hasAgentSandboxId) {
    db.run(`ALTER TABLE agents ADD COLUMN e2b_sandbox_id TEXT`)
  }

  // WhatsApp integration tables
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
      key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      jid TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT,
      push_name TEXT,
      phone_number TEXT,
      is_group INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (jid, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      jid TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      last_message_time INTEGER,
      unread_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (jid, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      from_jid TEXT NOT NULL,
      from_me INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      message_type TEXT,
      content TEXT,
      raw_message TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  // Legacy app_connections migration (if old table exists without user_id)
  // Must run BEFORE creating new table or indexes
  const appConnColumns = db.exec("PRAGMA table_info(app_connections)")
  const hasAppConnUserId = appConnColumns[0]?.values?.some((col) => col[1] === 'user_id')
  if (appConnColumns.length > 0 && !hasAppConnUserId) {
    console.log('Migrating app_connections table to new schema...')
    db.run(`DROP TABLE IF EXISTS app_connections`)
  }

  // Now create the table with correct schema (or it already exists with correct schema)
  db.run(`
    CREATE TABLE IF NOT EXISTS app_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      health_status TEXT DEFAULT 'unknown',
      warning_message TEXT,
      last_health_check_at TEXT,
      last_successful_activity_at TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, app_type),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  // Health event log for debugging connection issues
  db.run(`
    CREATE TABLE IF NOT EXISTS app_health_events (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES app_connections(id) ON DELETE CASCADE
    )
  `)

  // Create indexes after tables are properly set up
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_connections_user ON app_connections(user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_connections_user_type ON app_connections(user_id, app_type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_health_events_connection ON app_health_events(connection_id)`)

  // E2B sandbox file backups table (thread-based - deprecated, kept for migration)
  db.run(`
    CREATE TABLE IF NOT EXISTS sandbox_file_backups (
      thread_id TEXT PRIMARY KEY,
      files TEXT NOT NULL,
      file_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
    )
  `)

  // Agent-based file backups table (new - each agent has its own sandbox)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_file_backups (
      agent_id TEXT PRIMARY KEY,
      files TEXT NOT NULL,
      file_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_threads_agent_id ON threads(agent_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_jid, user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp)`)

  // WhatsApp Agent Configuration table (per user)
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_agent_config (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      agent_id TEXT,
      thread_timeout_minutes INTEGER DEFAULT 30,
      workspace_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE SET NULL
    )
  `)

  // WhatsApp JID to Thread Mapping table
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_thread_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      last_activity_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, jid),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_thread_mapping_user_jid ON whatsapp_thread_mapping(user_id, jid)`)

  // Add source column to threads for WhatsApp thread identification
  const hasThreadSource = threadColumns[0]?.values?.some((col) => col[1] === 'source')
  if (!hasThreadSource) {
    db.run(`ALTER TABLE threads ADD COLUMN source TEXT DEFAULT 'chat'`)
  }

  // Add whatsapp_jid column to threads for linking back to WhatsApp contact
  const hasWhatsappJid = threadColumns[0]?.values?.some((col) => col[1] === 'whatsapp_jid')
  if (!hasWhatsappJid) {
    db.run(`ALTER TABLE threads ADD COLUMN whatsapp_jid TEXT`)
  }

  // Add whatsapp_contact_name column to threads for display
  const hasWhatsappContactName = threadColumns[0]?.values?.some((col) => col[1] === 'whatsapp_contact_name')
  if (!hasWhatsappContactName) {
    db.run(`ALTER TABLE threads ADD COLUMN whatsapp_contact_name TEXT`)
  }

  // --- MIGRATIONS FOR WHATSAPP TABLES ---

  // Check if we need to migrate whatsapp tables to include user_id
  const waAuthColumns = db.exec("PRAGMA table_info(whatsapp_auth_state)")
  const hasAuthUserId = waAuthColumns[0]?.values?.some((col) => col[1] === 'user_id')

  // If tables exist but don't have user_id, we need to migrate them
  // Strategy: Drop and recreate (DATA LOSS) as agreed in plan for clean multi-user slate
  if (waAuthColumns.length > 0 && !hasAuthUserId) {
    console.log('Migrating WhatsApp tables to multi-user schema (dropping existing data)...')
    db.run(`DROP TABLE IF EXISTS whatsapp_auth_state`)
    db.run(`DROP TABLE IF EXISTS whatsapp_contacts`)
    db.run(`DROP TABLE IF EXISTS whatsapp_chats`)
    db.run(`DROP TABLE IF EXISTS whatsapp_messages`)

    // Re-run create statements
    db.run(`
      CREATE TABLE whatsapp_auth_state (
        key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, user_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE whatsapp_contacts (
        jid TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT,
        push_name TEXT,
        phone_number TEXT,
        is_group INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (jid, user_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE whatsapp_chats (
        jid TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT,
        is_group INTEGER DEFAULT 0,
        last_message_time INTEGER,
        unread_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (jid, user_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE TABLE whatsapp_messages (
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        from_jid TEXT NOT NULL,
        from_me INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        message_type TEXT,
        content TEXT,
        raw_message TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_jid, user_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp)`)
  }

  // Webhooks table for hook system
  db.run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      event_types TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      retry_count INTEGER DEFAULT 3,
      timeout_ms INTEGER DEFAULT 5000,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id)`)

  saveToDisk()

  // Run migrations (imported lazily to avoid circular deps)
  const { runAgentMigrations } = await import('./agents.js')
  await runAgentMigrations()

  console.log('Database initialized successfully')
  return db
}

export function closeDatabase(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (db) {
    // Save any pending changes
    if (dirty) {
      const data = db.export()
      writeFileSync(getDbPath(), Buffer.from(data))
    }
    db.close()
    db = null
  }
}

// Helper functions for common operations

export interface User {
  user_id: string
  email: string
  password_hash: string
  name: string | null
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
  source: string | null  // 'chat' | 'whatsapp'
  whatsapp_jid: string | null
  whatsapp_contact_name: string | null
}

export interface Agent {
  agent_id: string
  name: string
  color: string
  icon: string
  model_default: string
  is_default: number  // SQLite uses 0/1 for boolean
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

export function getAllThreads(): Thread[] {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM threads ORDER BY updated_at DESC')
  const threads: Thread[] = []

  while (stmt.step()) {
    threads.push(stmt.getAsObject() as unknown as Thread)
  }
  stmt.free()

  return threads
}

export function getThread(threadId: string): Thread | null {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM threads WHERE thread_id = ?')
  stmt.bind([threadId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const thread = stmt.getAsObject() as unknown as Thread
  stmt.free()
  return thread
}

export interface CreateThreadOptions {
  metadata?: Record<string, unknown>
  agentId?: string
  userId?: string
  source?: 'chat' | 'whatsapp'
  whatsappJid?: string
  whatsappContactName?: string
}

export function createThread(threadId: string, options?: CreateThreadOptions): Thread
export function createThread(threadId: string, metadata?: Record<string, unknown>, agentId?: string, userId?: string): Thread
export function createThread(
  threadId: string,
  metadataOrOptions?: Record<string, unknown> | CreateThreadOptions,
  agentId?: string,
  userId?: string
): Thread {
  const database = getDb()
  const now = Date.now()

  // Handle both old signature (metadata, agentId, userId) and new signature (options object)
  let metadata: Record<string, unknown> | undefined
  let effectiveAgentId: string | undefined
  let effectiveUserId: string | undefined
  let source: 'chat' | 'whatsapp' = 'chat'
  let whatsappJid: string | undefined
  let whatsappContactName: string | undefined

  if (metadataOrOptions && 'source' in metadataOrOptions) {
    // New options object signature
    const opts = metadataOrOptions as CreateThreadOptions
    metadata = opts.metadata
    effectiveAgentId = opts.agentId
    effectiveUserId = opts.userId
    source = opts.source || 'chat'
    whatsappJid = opts.whatsappJid
    whatsappContactName = opts.whatsappContactName
  } else {
    // Old signature for backward compatibility
    metadata = metadataOrOptions as Record<string, unknown> | undefined
    effectiveAgentId = agentId
    effectiveUserId = userId
  }

  database.run(
    `INSERT INTO threads (thread_id, created_at, updated_at, metadata, status, agent_id, user_id, source, whatsapp_jid, whatsapp_contact_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [threadId, now, now, metadata ? JSON.stringify(metadata) : null, 'idle', effectiveAgentId || null, effectiveUserId || null, source, whatsappJid || null, whatsappContactName || null]
  )

  saveToDisk()

  return {
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
    whatsapp_contact_name: whatsappContactName || null
  }
}

export function updateThread(
  threadId: string,
  updates: Partial<Omit<Thread, 'thread_id' | 'created_at'>>
): Thread | null {
  const database = getDb()
  const existing = getThread(threadId)

  if (!existing) return null

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.metadata !== undefined) {
    setClauses.push('metadata = ?')
    values.push(
      typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata)
    )
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?')
    values.push(updates.status)
  }
  if (updates.thread_values !== undefined) {
    setClauses.push('thread_values = ?')
    values.push(updates.thread_values)
  }
  if (updates.title !== undefined) {
    setClauses.push('title = ?')
    values.push(updates.title)
  }
  if (updates.agent_id !== undefined) {
    setClauses.push('agent_id = ?')
    values.push(updates.agent_id)
  }
  if (updates.e2b_sandbox_id !== undefined) {
    setClauses.push('e2b_sandbox_id = ?')
    values.push(updates.e2b_sandbox_id)
  }
  if (updates.source !== undefined) {
    setClauses.push('source = ?')
    values.push(updates.source)
  }
  if (updates.whatsapp_jid !== undefined) {
    setClauses.push('whatsapp_jid = ?')
    values.push(updates.whatsapp_jid)
  }
  if (updates.whatsapp_contact_name !== undefined) {
    setClauses.push('whatsapp_contact_name = ?')
    values.push(updates.whatsapp_contact_name)
  }

  values.push(threadId)

  database.run(`UPDATE threads SET ${setClauses.join(', ')} WHERE thread_id = ?`, values)

  saveToDisk()

  return getThread(threadId)
}

export function deleteThread(threadId: string): void {
  const database = getDb()
  database.run('DELETE FROM threads WHERE thread_id = ?', [threadId])
  saveToDisk()
}

// Get threads filtered by user_id
export function getThreadsByUserId(userId: string): Thread[] {
  const database = getDb()
  const stmt = database.prepare('SELECT * FROM threads WHERE user_id = ? ORDER BY updated_at DESC')
  stmt.bind([userId])
  const threads: Thread[] = []

  while (stmt.step()) {
    threads.push(stmt.getAsObject() as unknown as Thread)
  }
  stmt.free()

  return threads
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
}

/**
 * Save or update a file backup for a thread.
 */
export function saveFileBackup(threadId: string, files: BackedUpFile[]): void {
  const database = getDb()
  const now = Date.now()
  const filesJson = JSON.stringify(files)
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0)

  // Use INSERT OR REPLACE to handle both insert and update
  database.run(
    `INSERT OR REPLACE INTO sandbox_file_backups
     (thread_id, files, file_count, total_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM sandbox_file_backups WHERE thread_id = ?), ?), ?)`,
    [threadId, filesJson, files.length, totalSize, threadId, now, now]
  )

  saveToDisk()
}

/**
 * Get the file backup for a thread.
 */
export function getFileBackup(threadId: string): BackedUpFile[] | null {
  const database = getDb()
  const stmt = database.prepare('SELECT files FROM sandbox_file_backups WHERE thread_id = ?')
  stmt.bind([threadId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as { files: string }
  stmt.free()

  try {
    return JSON.parse(row.files) as BackedUpFile[]
  } catch {
    return null
  }
}

/**
 * Get backup info (metadata only) for a thread.
 */
export function getBackupInfo(threadId: string): BackupInfo | null {
  const database = getDb()
  const stmt = database.prepare(
    'SELECT file_count, total_size, updated_at FROM sandbox_file_backups WHERE thread_id = ?'
  )
  stmt.bind([threadId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as { file_count: number; total_size: number; updated_at: number }
  stmt.free()

  return {
    fileCount: row.file_count,
    totalSize: row.total_size,
    updatedAt: row.updated_at
  }
}

/**
 * Clear the file backup for a thread.
 */
export function clearFileBackup(threadId: string): void {
  const database = getDb()
  database.run('DELETE FROM sandbox_file_backups WHERE thread_id = ?', [threadId])
  saveToDisk()
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

/**
 * Save or update a file backup for an agent's sandbox.
 */
export function saveAgentFileBackup(agentId: string, files: BackedUpFile[]): void {
  const database = getDb()
  const now = Date.now()
  const filesJson = JSON.stringify(files)
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0)

  // Use INSERT OR REPLACE to handle both insert and update
  database.run(
    `INSERT OR REPLACE INTO agent_file_backups
     (agent_id, files, file_count, total_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM agent_file_backups WHERE agent_id = ?), ?), ?)`,
    [agentId, filesJson, files.length, totalSize, agentId, now, now]
  )

  saveToDisk()
}

/**
 * Get the file backup for an agent's sandbox.
 */
export function getAgentFileBackup(agentId: string): BackedUpFile[] | null {
  const database = getDb()
  const stmt = database.prepare('SELECT files FROM agent_file_backups WHERE agent_id = ?')
  stmt.bind([agentId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as { files: string }
  stmt.free()

  try {
    return JSON.parse(row.files) as BackedUpFile[]
  } catch {
    return null
  }
}

/**
 * Get backup info (metadata only) for an agent's sandbox.
 */
export function getAgentBackupInfo(agentId: string): BackupInfo | null {
  const database = getDb()
  const stmt = database.prepare(
    'SELECT file_count, total_size, updated_at FROM agent_file_backups WHERE agent_id = ?'
  )
  stmt.bind([agentId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as { file_count: number; total_size: number; updated_at: number }
  stmt.free()

  return {
    fileCount: row.file_count,
    totalSize: row.total_size,
    updatedAt: row.updated_at
  }
}

/**
 * Clear the file backup for an agent's sandbox.
 */
export function clearAgentFileBackup(agentId: string): void {
  const database = getDb()
  database.run('DELETE FROM agent_file_backups WHERE agent_id = ?', [agentId])
  saveToDisk()
}

/**
 * Update an agent's e2b_sandbox_id.
 */
export function updateAgentSandboxId(agentId: string, sandboxId: string | null): void {
  const database = getDb()
  const now = Date.now()
  database.run(
    'UPDATE agents SET e2b_sandbox_id = ?, updated_at = ? WHERE agent_id = ?',
    [sandboxId, now, agentId]
  )
  saveToDisk()
}

// ============================================
// Single-File Backup Operations
// ============================================

/**
 * Get a single file from an agent's backup by path.
 */
export function getAgentFileByPath(agentId: string, filePath: string): BackedUpFile | null {
  const backup = getAgentFileBackup(agentId)
  if (!backup) return null

  return backup.find(f => f.path === filePath) || null
}

/**
 * Save or update a single file in an agent's backup.
 */
export function saveAgentFile(agentId: string, path: string, content: string): void {
  const database = getDb()
  const now = Date.now()

  // Get existing backup or create empty array
  const existingBackup = getAgentFileBackup(agentId) || []

  // Find and update or add the file
  const existingIndex = existingBackup.findIndex(f => f.path === path)
  if (existingIndex >= 0) {
    existingBackup[existingIndex] = { path, content }
  } else {
    existingBackup.push({ path, content })
  }

  // Calculate totals
  const filesJson = JSON.stringify(existingBackup)
  const totalSize = existingBackup.reduce((sum, f) => sum + f.content.length, 0)

  // Save back to database
  database.run(
    `INSERT OR REPLACE INTO agent_file_backups
     (agent_id, files, file_count, total_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM agent_file_backups WHERE agent_id = ?), ?), ?)`,
    [agentId, filesJson, existingBackup.length, totalSize, agentId, now, now]
  )

  saveToDisk()
}

/**
 * Delete a single file from an agent's backup.
 * Returns true if the file was found and deleted, false otherwise.
 */
export function deleteAgentFile(agentId: string, path: string): boolean {
  const database = getDb()
  const now = Date.now()

  // Get existing backup
  const existingBackup = getAgentFileBackup(agentId)
  if (!existingBackup) return false

  // Find and remove the file
  const existingIndex = existingBackup.findIndex(f => f.path === path)
  if (existingIndex < 0) return false

  existingBackup.splice(existingIndex, 1)

  // Calculate totals
  const filesJson = JSON.stringify(existingBackup)
  const totalSize = existingBackup.reduce((sum, f) => sum + f.content.length, 0)

  // Save back to database
  database.run(
    `UPDATE agent_file_backups SET files = ?, file_count = ?, total_size = ?, updated_at = ? WHERE agent_id = ?`,
    [filesJson, existingBackup.length, totalSize, now, agentId]
  )

  saveToDisk()
  return true
}

/**
 * List files from an agent's backup (path + size, no content).
 * Returns an array of file metadata without the actual content.
 */
export function listAgentBackupFiles(agentId: string): Array<{path: string, size: number, is_dir: boolean}> {
  const backup = getAgentFileBackup(agentId)
  if (!backup) return []

  // Build a set of directories from file paths
  const directories = new Set<string>()

  for (const file of backup) {
    // Extract all parent directories from the path
    const parts = file.path.split('/')
    let currentPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      if (currentPath && currentPath !== '/') {
        directories.add(currentPath.startsWith('/') ? currentPath : '/' + currentPath)
      }
    }
  }

  // Create file entries
  const files = backup.map(f => ({
    path: f.path,
    size: f.content.length,
    is_dir: false
  }))

  // Add directory entries
  for (const dir of directories) {
    // Don't add if there's already a file with this path (shouldn't happen, but just in case)
    if (!backup.some(f => f.path === dir)) {
      files.push({
        path: dir,
        size: 0,
        is_dir: true
      })
    }
  }

  // Sort: directories first, then by path
  files.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.path.localeCompare(b.path)
  })

  return files
}
