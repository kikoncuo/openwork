import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getDbPath } from '../storage'

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

  // Add default_workspace_path column to agents if it doesn't exist
  const agentColumns = db.exec("PRAGMA table_info(agents)")
  const hasWorkspacePath = agentColumns[0]?.values?.some((col) => col[1] === 'default_workspace_path')
  if (!hasWorkspacePath) {
    db.run(`ALTER TABLE agents ADD COLUMN default_workspace_path TEXT`)
  }

  // WhatsApp integration tables
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      push_name TEXT,
      phone_number TEXT,
      is_group INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      last_message_time INTEGER,
      unread_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      message_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      from_jid TEXT NOT NULL,
      from_me INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      message_type TEXT,
      content TEXT,
      raw_message TEXT,
      created_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS app_connections (
      app_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      connected INTEGER DEFAULT 0,
      connection_data TEXT,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_threads_agent_id ON threads(agent_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_jid)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp)`)

  saveToDisk()

  // Run migrations (imported lazily to avoid circular deps)
  const { runAgentMigrations } = await import('./agents')
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

export interface Thread {
  thread_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  status: string
  thread_values: string | null
  title: string | null
  agent_id: string | null
}

export interface Agent {
  agent_id: string
  name: string
  color: string
  icon: string
  model_default: string
  default_workspace_path: string | null
  is_default: number  // SQLite uses 0/1 for boolean
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
  data: string  // Encrypted JSON
  updated_at: number
}

export interface WhatsAppContact {
  jid: string
  name: string | null
  push_name: string | null
  phone_number: string | null
  is_group: number  // 0 or 1
  updated_at: number
}

export interface WhatsAppChat {
  jid: string
  name: string | null
  is_group: number  // 0 or 1
  last_message_time: number | null
  unread_count: number
  updated_at: number
}

export interface WhatsAppMessage {
  message_id: string
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
  app_id: string
  enabled: number  // 0 or 1
  connected: number  // 0 or 1
  connection_data: string | null  // JSON
  updated_at: number
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

export function createThread(threadId: string, metadata?: Record<string, unknown>, agentId?: string): Thread {
  const database = getDb()
  const now = Date.now()

  database.run(
    `INSERT INTO threads (thread_id, created_at, updated_at, metadata, status, agent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [threadId, now, now, metadata ? JSON.stringify(metadata) : null, 'idle', agentId || null]
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
    agent_id: agentId || null
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
