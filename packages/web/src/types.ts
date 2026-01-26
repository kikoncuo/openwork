// Re-export types from electron for use in renderer
export type ThreadStatus = 'idle' | 'busy' | 'interrupted' | 'error'

export type ThreadSource = 'chat' | 'whatsapp'

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
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama'

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
  tool_call: ToolCall
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

// IPC/Stream types for electron-transport
export interface StreamPayload {
  input?: unknown
  config?: {
    configurable?: {
      thread_id?: string
      model_id?: string
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
