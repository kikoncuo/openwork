// Re-export types from electron for use in renderer
export type ThreadStatus = 'idle' | 'busy' | 'interrupted' | 'error'

export type ThreadSource = 'chat' | 'whatsapp' | 'cronjob'

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_values?: Record<string, unknown>
  title?: string
  agent_id?: string | null
  source?: ThreadSource
  whatsapp_jid?: string | null
  whatsapp_contact_name?: string | null
  needs_attention?: boolean
}

// Agent types
export type AgentIcon = 'bot' | 'sparkles' | 'code' | 'pen' | 'search' | 'terminal' | 'brain' | 'shield'

export interface Agent {
  agent_id: string
  name: string
  color: string
  icon: AgentIcon
  model_default: string
  is_default: boolean
  created_at: Date
  updated_at: Date
}

export interface AgentConfig {
  agent_id: string
  tool_configs: unknown[] | null
  mcp_servers: unknown[] | null
  custom_prompt: string | null
  learned_insights: unknown[] | null
  updated_at: Date
}

export type RunStatus = 'pending' | 'running' | 'error' | 'success' | 'interrupted'

export interface Run {
  run_id: string
  thread_id: string
  assistant_id?: string
  created_at: Date
  updated_at: Date
  status: RunStatus
  metadata?: Record<string, unknown>
}

// Provider configuration
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama' | 'openrouter'

export interface Provider {
  id: ProviderId
  name: string
  hasApiKey: boolean
}

export interface ModelConfig {
  id: string
  name: string
  provider: ProviderId
  model: string
  description?: string
  available: boolean
}

// User tier for tier-based model management
export interface UserTier {
  tier_id: number
  name: string
  display_name: string
  default_model: string
  available_models: string[]
  features: {
    model_selection: boolean
    custom_providers: boolean
  }
}

// Subagent types (from deepagentsjs)
export interface Subagent {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: Date
  completedAt?: Date
  // Used to correlate task tool calls with their responses
  toolCallId?: string
  // Type of subagent (e.g., 'general-purpose', 'correctness-checker', 'final-reviewer')
  subagentType?: string
}

export type StreamEvent =
  | { type: 'message'; message: Message }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolResult: ToolResult }
  | { type: 'interrupt'; request: HITLRequest }
  | { type: 'token'; token: string }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'workspace'; files: FileInfo[]; path: string }
  | { type: 'subagents'; subagents: Subagent[] }
  | { type: 'done'; result: unknown }
  | { type: 'error'; error: string }

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ContentBlock[]
  tool_calls?: ToolCall[]
  // For tool messages - links result to its tool call
  tool_call_id?: string
  // For tool messages - the name of the tool
  name?: string
  created_at: Date
}

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  tool_call_id: string
  content: string | unknown
  is_error?: boolean
}

export interface HITLRequest {
  id: string
  tool_call?: ToolCall           // Legacy single (backwards compat)
  tool_calls?: ToolCall[]        // NEW: array of all pending tool calls
  allowed_decisions: HITLDecision['type'][]
}

export interface HITLDecision {
  type: 'approve' | 'reject' | 'edit'
  tool_call_id: string
  edited_args?: Record<string, unknown>
  feedback?: string
}

export interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}

// Terminal types
export interface TerminalInstance {
  id: string
  name: string
  cwd: string
  history: TerminalEntry[]
  isRunning: boolean
}

export interface TerminalEntry {
  id: string
  command: string
  output: string
  exitCode: number | null
  timestamp: Date
  isStreaming: boolean
  source: 'user' | 'agent'
}

// IPC/Stream types for electron-transport
export interface StreamPayload {
  input?: unknown
  config?: {
    configurable?: {
      thread_id?: string
      model_id?: string
      plan_mode?: boolean
    }
  }
  command?: {
    resume?: unknown
  }
  signal?: AbortSignal
}

// SDK stream event (different from StreamEvent above)
export interface SDKStreamEvent {
  event: string
  data: unknown
}

export interface IPCEvent {
  type: 'stream' | 'token' | 'tool_call' | 'values' | 'error' | 'done'
  messageId?: string
  token?: string
  tool_calls?: unknown[]
  data?: unknown
  error?: string
}

export interface IPCStreamEvent extends IPCEvent {
  type: 'stream'
  mode: string
  data: unknown
}

// Admin types
export interface AdminUser {
  user_id: string
  email: string
  name: string | null
  tier_id: number
  is_admin: number
  created_at: number
  updated_at: number
}

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

export interface AdminTier {
  tier_id: number
  name: string
  display_name: string
  default_model: string
  available_models: string[]
  features: Record<string, boolean>
  created_at: number
  updated_at: number
}

export interface AdminWebhook {
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

export interface AdminAppConnection {
  id: string
  user_id: string
  app_type: string
  status: string
  health_status: string
  warning_message: string | null
  last_health_check_at: string | null
  last_successful_activity_at: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

export interface AdminWhatsAppContact {
  jid: string
  user_id: string
  name: string | null
  push_name: string | null
  phone_number: string | null
  is_group: number
  updated_at: number
}

export interface AdminWhatsAppChat {
  jid: string
  user_id: string
  name: string | null
  is_group: number
  last_message_time: number | null
  unread_count: number
  updated_at: number
}

export interface AdminRun {
  run_id: string
  thread_id: string
  assistant_id: string | null
  created_at: number
  updated_at: number
  status: string | null
  metadata: string | null
  kwargs: string | null
}

export interface AdminThread {
  thread_id: string
  created_at: number
  updated_at: number
  title: string | null
  status: string
  agent_id: string | null
  user_id: string | null
  source: string | null
  needs_attention: number
}

export interface AdminAgent {
  agent_id: string
  name: string
  color: string
  icon: string
  model_default: string
  is_default: number
  user_id: string | null
  created_at: number
  updated_at: number
}

export interface AdminSkill {
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

export interface SQLResult {
  columns: string[]
  rows: unknown[][]
  error?: string
}

export interface AdminCronjob {
  cronjob_id: string
  user_id: string
  name: string
  cron_expression: string
  message: string
  agent_id: string
  thread_mode: string
  thread_timeout_minutes: number
  enabled: number
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}
