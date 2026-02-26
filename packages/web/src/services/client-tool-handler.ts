// packages/web/src/services/client-tool-handler.ts
// Handles tool calls from the server and proxies them to local Docker container

import { ws } from '@/api/websocket'
import { ClientSandbox, createClientSandbox } from './client-sandbox'

interface ToolCall {
  callId: string
  tool: string
  args: Record<string, unknown>
  threadId: string
}

interface ToolResult {
  callId: string
  result?: unknown
  error?: string
}

// Active sandbox connection
let activeSandbox: ClientSandbox | null = null

// Whether the handler is active
let handlerActive = false

// Store config for re-registration after WebSocket connects
let pendingConfig: { host: string; port: number } | null = null

/**
 * Register the tool call handler on the WebSocket
 */
function registerHandler(): void {
  // Listen for tool calls from the server
  ws.on('client_tool_call', (data: unknown) => {
    console.log('[ClientToolHandler] Received client_tool_call event:', data)
    handleToolCall(data as ToolCall)
  })
  console.log('[ClientToolHandler] Handler registered on WebSocket')
}

/**
 * Initialize the client tool handler
 * Should be called when the app starts and local sandbox is configured
 */
export function initClientToolHandler(host: string, port: number): void {
  if (handlerActive) {
    console.log('[ClientToolHandler] Already initialized')
    return
  }

  activeSandbox = createClientSandbox(host, port)
  handlerActive = true
  pendingConfig = { host, port }

  console.log(`[ClientToolHandler] Initialized with Docker container at ${host}:${port}`)
  console.log('[ClientToolHandler] WebSocket connected:', ws.isConnected())

  if (ws.isConnected()) {
    // WebSocket already connected, register handler now
    registerHandler()
  } else {
    // WebSocket not connected, wait for connection
    console.log('[ClientToolHandler] Waiting for WebSocket to connect...')

    // Poll for connection (Socket.IO doesn't expose a clean "on connect" from outside)
    const checkConnection = setInterval(() => {
      if (ws.isConnected()) {
        clearInterval(checkConnection)
        console.log('[ClientToolHandler] WebSocket now connected, registering handler')
        registerHandler()
      }
    }, 100)

    // Stop polling after 30 seconds
    setTimeout(() => {
      clearInterval(checkConnection)
      if (!ws.isConnected()) {
        console.error('[ClientToolHandler] WebSocket did not connect within 30 seconds')
      }
    }, 30000)
  }
}

// Track the connection check interval
let connectionCheckInterval: ReturnType<typeof setInterval> | null = null

/**
 * Stop the client tool handler
 */
export function stopClientToolHandler(): void {
  if (!handlerActive) {
    return
  }

  // Clear connection check interval if running
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval)
    connectionCheckInterval = null
  }

  handlerActive = false
  activeSandbox = null
  pendingConfig = null

  console.log('[ClientToolHandler] Stopped')
}

/**
 * Update the sandbox connection settings
 */
export function updateClientToolHandler(host: string, port: number): void {
  if (activeSandbox) {
    activeSandbox = createClientSandbox(host, port)
    console.log(`[ClientToolHandler] Updated Docker container to ${host}:${port}`)
  }
}

/**
 * Handle incoming tool call from server
 */
async function handleToolCall(data: ToolCall): Promise<void> {
  if (!activeSandbox) {
    console.error('[ClientToolHandler] No active sandbox connection')
    sendResult({
      callId: data.callId,
      error: 'Local sandbox not configured'
    })
    return
  }

  const { callId, tool, args } = data

  console.log(`[ClientToolHandler] Received tool call: ${tool}`, args)

  try {
    const result = await activeSandbox.executeToolCall(tool, args)

    if (result.success) {
      sendResult({
        callId,
        result: result.result
      })
    } else {
      sendResult({
        callId,
        error: result.error || 'Tool execution failed'
      })
    }
  } catch (error) {
    console.error(`[ClientToolHandler] Error executing ${tool}:`, error)
    sendResult({
      callId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Send tool result back to server
 */
function sendResult(result: ToolResult): void {
  ws.emit('client_tool_result', result)
}

/**
 * Check if the local sandbox is connected
 */
export async function isLocalSandboxConnected(): Promise<boolean> {
  if (!activeSandbox) {
    return false
  }
  return activeSandbox.isConnected()
}
