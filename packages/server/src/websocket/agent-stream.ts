import { Socket } from 'socket.io'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { createAgentRuntime } from '../services/agent/runtime.js'
import { getThread, updateThread, setThreadNeedsAttention, appendThreadSearchText } from '../services/db/index.js'
import { broadcastToUser } from './index.js'
import { resolveThreadApproval, hasPendingApproval } from '../services/apps/whatsapp/agent-handler.js'
import type { HITLDecision } from '../services/types.js'

// Track active runs for cancellation
const activeRuns = new Map<string, AbortController>()

/**
 * Check if stream output contains an interrupt (tool needs approval).
 */
function checkForInterrupt(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false

  const outputObj = output as Record<string, unknown>
  const interrupt = outputObj.__interrupt__ as Array<{
    value?: {
      actionRequests?: Array<{ name: string; id: string; args: Record<string, unknown> }>
    }
  }> | undefined

  if (interrupt && Array.isArray(interrupt) && interrupt.length > 0) {
    const interruptValue = interrupt[0]?.value
    if (interruptValue?.actionRequests?.length) {
      return true
    }
  }

  return false
}

/**
 * Extract text content from a message in stream data.
 * Used to build searchable content for thread search functionality.
 * Skips tool calls and system messages, extracting only human/assistant text.
 */
function extractMessageContent(data: unknown): string {
  if (!data || typeof data !== 'object') return ''

  // Handle array of messages (from 'messages' mode)
  if (Array.isArray(data)) {
    return data
      .map(msg => extractSingleMessageContent(msg))
      .filter(Boolean)
      .join(' ')
  }

  // Handle single message tuple [message, metadata]
  const tuple = data as [unknown, unknown]
  if (tuple.length === 2 && tuple[0] && typeof tuple[0] === 'object') {
    return extractSingleMessageContent(tuple[0])
  }

  return ''
}

/**
 * Extract text content from a single message object.
 */
function extractSingleMessageContent(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return ''

  const msgObj = msg as Record<string, unknown>

  // Get message type/role
  const type = msgObj.type || msgObj.role || (typeof msgObj._getType === 'function' ? msgObj._getType() : null)

  // Skip tool messages
  if (type === 'tool' || type === 'tool_result') return ''

  // Extract content
  const content = msgObj.content

  if (typeof content === 'string') {
    return content
  }

  // Handle array content (text blocks)
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text?: string } =>
        typeof block === 'object' && block !== null && block.type === 'text'
      )
      .map(block => block.text || '')
      .join(' ')
  }

  return ''
}

export function registerAgentStreamHandlers(socket: Socket): void {
  // Handle agent invocation with streaming
  socket.on('agent:invoke', async ({ threadId, message, modelId, planMode }: { threadId: string; message: string; modelId?: string; planMode?: boolean }) => {
    const channel = `agent:stream:${threadId}`
    const userId = socket.user?.userId

    console.log('[Agent] Received invoke request:', {
      threadId,
      message: message.substring(0, 50),
      modelId,
      userId
    })

    // Abort any existing stream for this thread before starting a new one
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      console.log('[Agent] Aborting existing stream for thread:', threadId)
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    try {
      // Verify thread exists and user has access
      const thread = await getThread(threadId)

      // Check ownership
      if (!thread || thread.user_id !== userId) {
        socket.emit(channel, {
          type: 'error',
          error: 'ACCESS_DENIED',
          message: 'Access denied to this thread.'
        })
        return
      }

      // Check that thread has an agent assigned (required for E2B sandbox)
      if (!thread.agent_id) {
        socket.emit(channel, {
          type: 'error',
          error: 'AGENT_REQUIRED',
          message: 'Please assign an agent to this thread before sending messages.'
        })
        return
      }

      // Persist plan_mode to thread metadata for resume support
      if (planMode !== undefined) {
        const existingMetadata = thread.metadata ? JSON.parse(thread.metadata as string) : {}
        await updateThread(threadId, {
          metadata: JSON.stringify({ ...existingMetadata, plan_mode: planMode })
        })
      }

      const agent = await createAgentRuntime({ threadId, modelId, socket, planMode: planMode || false })
      const humanMessage = new HumanMessage(message)

      // Stream with both modes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (agent as any).stream(
        { messages: [humanMessage] },
        {
          configurable: { thread_id: threadId },
          signal: abortController.signal,
          streamMode: ['messages', 'values'],
          recursionLimit: 1000
        }
      )

      let interruptDetected = false
      // Accumulate message content for search indexing
      let accumulatedContent = message // Start with the user's input message

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as [string, unknown]

        // Check for interrupt in values mode
        if (mode === 'values' && checkForInterrupt(data)) {
          interruptDetected = true
        }

        // Extract message content for search indexing
        if (mode === 'messages') {
          const content = extractMessageContent(data)
          if (content) {
            accumulatedContent += ' ' + content
          }
        }

        // Forward raw stream events
        socket.emit(channel, {
          type: 'stream',
          mode,
          data: JSON.parse(JSON.stringify(data))
        })
      }

      // Send done event (only if not aborted)
      if (!abortController.signal.aborted) {
        socket.emit(channel, { type: 'done' })

        // Update search_text with accumulated message content
        if (accumulatedContent.trim()) {
          await appendThreadSearchText(threadId, accumulatedContent)
        }

        // If interrupt was detected, set needs_attention on the thread
        if (interruptDetected && userId) {
          await setThreadNeedsAttention(threadId, true)
          broadcastToUser(userId, 'thread:updated', {
            thread_id: threadId,
            needs_attention: true
          })
        }
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('Controller is already closed'))

      if (!isAbortError) {
        console.error('[Agent] Error:', error)
        socket.emit(channel, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    } finally {
      activeRuns.delete(threadId)
    }
  })

  // Handle agent resume (after interrupt approval/rejection)
  socket.on('agent:resume', async ({ threadId, command, modelId }: { threadId: string; command: { resume?: { decision?: string; decisions?: Array<{ type: string }> } }; modelId?: string }) => {
    const channel = `agent:stream:${threadId}`
    const userId = socket.user?.userId

    console.log('[Agent] Received resume request:', { threadId, command, modelId, userId })

    // Verify thread exists and user has access
    const thread = await getThread(threadId)

    // Check ownership
    if (!thread || thread.user_id !== userId) {
      socket.emit(channel, {
        type: 'error',
        error: 'Access denied to this thread'
      })
      return
    }

    // Check that thread has an agent assigned
    if (!thread.agent_id) {
      socket.emit(channel, {
        type: 'error',
        error: 'Agent assignment is required'
      })
      return
    }

    // Support both new format (decisions array) and legacy format (single decision)
    let resumeValue: { decisions: Array<{ type: string }> }

    if (command?.resume?.decisions && Array.isArray(command.resume.decisions)) {
      // New format: multiple decisions
      resumeValue = { decisions: command.resume.decisions }
    } else {
      // Legacy format: single decision
      const decisionType = command?.resume?.decision || 'approve'
      resumeValue = { decisions: [{ type: decisionType }] }
    }

    const decisionType = resumeValue.decisions[0]?.type || 'approve'

    // Check if this thread has a pending WhatsApp-triggered approval
    // If so, resolve it and let the WhatsApp handler continue (don't start a new stream)
    if (hasPendingApproval(threadId)) {
      console.log('[Agent] Resolving WhatsApp pending approval via resume for thread:', threadId)
      const resolved = resolveThreadApproval(threadId, decisionType as 'approve' | 'reject')
      if (resolved) {
        // The WhatsApp agent handler will continue streaming
        return
      }
    }

    // No pending WhatsApp approval - handle as direct UI-initiated resume
    // Abort any existing stream before resuming
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    try {
      // Read plan_mode from thread metadata (persisted during invoke)
      const resumeThread = await getThread(threadId)
      let resumePlanMode = false
      if (resumeThread?.metadata) {
        try {
          const meta = typeof resumeThread.metadata === 'string' ? JSON.parse(resumeThread.metadata) : resumeThread.metadata
          resumePlanMode = meta.plan_mode === true
        } catch { /* ignore parse errors */ }
      }

      const agent = await createAgentRuntime({ threadId, modelId, socket, planMode: resumePlanMode })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ['messages', 'values'] as const,
        recursionLimit: 1000
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (agent as any).stream(new Command({ resume: resumeValue }), config)

      let interruptDetected = false
      let accumulatedContent = ''

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]

        // Check for new interrupt in values mode
        if (mode === 'values' && checkForInterrupt(data)) {
          interruptDetected = true
        }

        // Extract message content for search indexing
        if (mode === 'messages') {
          const content = extractMessageContent(data)
          if (content) {
            accumulatedContent += ' ' + content
          }
        }

        socket.emit(channel, {
          type: 'stream',
          mode,
          data: JSON.parse(JSON.stringify(data))
        })
      }

      if (!abortController.signal.aborted) {
        socket.emit(channel, { type: 'done' })

        // Update search_text with accumulated message content
        if (accumulatedContent.trim()) {
          await appendThreadSearchText(threadId, accumulatedContent)
        }

        // If a new interrupt was detected, set needs_attention
        if (interruptDetected && userId) {
          await setThreadNeedsAttention(threadId, true)
          broadcastToUser(userId, 'thread:updated', {
            thread_id: threadId,
            needs_attention: true
          })
        }
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('Controller is already closed'))

      if (!isAbortError) {
        console.error('[Agent] Resume error:', error)
        socket.emit(channel, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    } finally {
      activeRuns.delete(threadId)
    }
  })

  // Handle HITL interrupt response
  socket.on('agent:interrupt', async ({ threadId, decision }: { threadId: string; decision: HITLDecision }) => {
    const channel = `agent:stream:${threadId}`
    const userId = socket.user?.userId

    console.log('[Agent] Received interrupt decision:', { threadId, decision: decision.type, userId })

    // Verify thread exists and user has access
    const thread = await getThread(threadId)

    // Check ownership
    if (!thread || thread.user_id !== userId) {
      socket.emit(channel, {
        type: 'error',
        error: 'Access denied to this thread'
      })
      return
    }

    // Check that thread has an agent assigned
    if (!thread.agent_id) {
      socket.emit(channel, {
        type: 'error',
        error: 'Agent assignment is required'
      })
      return
    }

    // Check if this thread has a pending WhatsApp-triggered approval
    // If so, resolve it and let the WhatsApp handler continue (don't start a new stream)
    if (hasPendingApproval(threadId)) {
      console.log('[Agent] Resolving WhatsApp pending approval for thread:', threadId)
      const resolved = resolveThreadApproval(threadId, decision.type as 'approve' | 'reject')
      if (resolved) {
        // The WhatsApp agent handler will continue streaming
        // We just need to acknowledge the decision was received
        return
      }
    }

    // No pending WhatsApp approval - handle as direct UI-initiated interrupt
    // Abort any existing stream before continuing
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    try {
      const agent = await createAgentRuntime({ threadId, socket })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ['messages', 'values'] as const,
        recursionLimit: 1000
      }

      if (decision.type === 'approve') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await (agent as any).stream(null, config)

        let interruptDetected = false
        let accumulatedContent = ''

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break

          const [mode, data] = chunk as unknown as [string, unknown]

          // Check for new interrupt in values mode
          if (mode === 'values' && checkForInterrupt(data)) {
            interruptDetected = true
          }

          // Extract message content for search indexing
          if (mode === 'messages') {
            const content = extractMessageContent(data)
            if (content) {
              accumulatedContent += ' ' + content
            }
          }

          socket.emit(channel, {
            type: 'stream',
            mode,
            data: JSON.parse(JSON.stringify(data))
          })
        }

        if (!abortController.signal.aborted) {
          socket.emit(channel, { type: 'done' })

          // Update search_text with accumulated message content
          if (accumulatedContent.trim()) {
            await appendThreadSearchText(threadId, accumulatedContent)
          }

          // If a new interrupt was detected, set needs_attention
          if (interruptDetected && userId) {
            await setThreadNeedsAttention(threadId, true)
            broadcastToUser(userId, 'thread:updated', {
              thread_id: threadId,
              needs_attention: true
            })
          }
        }
      } else if (decision.type === 'reject') {
        socket.emit(channel, { type: 'done' })
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('Controller is already closed'))

      if (!isAbortError) {
        console.error('[Agent] Interrupt error:', error)
        socket.emit(channel, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    } finally {
      activeRuns.delete(threadId)
    }
  })

  // Handle cancellation
  socket.on('agent:cancel', async ({ threadId }: { threadId: string }) => {
    const userId = socket.user?.userId
    const thread = await getThread(threadId)

    // Only allow cancellation of own threads
    if (thread && thread.user_id === userId) {
      const controller = activeRuns.get(threadId)
      if (controller) {
        controller.abort()
        activeRuns.delete(threadId)
      }
    }
  })
}
