import { Socket } from 'socket.io'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { createAgentRuntime } from '../services/agent/runtime.js'
import { getThread } from '../services/db/index.js'
import { resolveThreadApproval, hasPendingApproval } from '../services/apps/whatsapp/agent-handler.js'
import type { HITLDecision } from '../services/types.js'

// Track active runs for cancellation
const activeRuns = new Map<string, AbortController>()

export function registerAgentStreamHandlers(socket: Socket): void {
  // Handle agent invocation with streaming
  socket.on('agent:invoke', async ({ threadId, message, modelId }: { threadId: string; message: string; modelId?: string }) => {
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
      const thread = getThread(threadId)

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

      const agent = await createAgentRuntime({ threadId, modelId })
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

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as [string, unknown]

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
  socket.on('agent:resume', async ({ threadId, command, modelId }: { threadId: string; command: { resume?: { decision?: string } }; modelId?: string }) => {
    const channel = `agent:stream:${threadId}`
    const userId = socket.user?.userId

    console.log('[Agent] Received resume request:', { threadId, command, modelId, userId })

    // Verify thread exists and user has access
    const thread = getThread(threadId)

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

    const decisionType = command?.resume?.decision || 'approve'

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
      const agent = await createAgentRuntime({ threadId, modelId })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ['messages', 'values'] as const,
        recursionLimit: 1000
      }

      const resumeValue = { decisions: [{ type: decisionType }] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (agent as any).stream(new Command({ resume: resumeValue }), config)

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]
        socket.emit(channel, {
          type: 'stream',
          mode,
          data: JSON.parse(JSON.stringify(data))
        })
      }

      if (!abortController.signal.aborted) {
        socket.emit(channel, { type: 'done' })
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
    const thread = getThread(threadId)

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
      const agent = await createAgentRuntime({ threadId })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ['messages', 'values'] as const,
        recursionLimit: 1000
      }

      if (decision.type === 'approve') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await (agent as any).stream(null, config)

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break

          const [mode, data] = chunk as unknown as [string, unknown]
          socket.emit(channel, {
            type: 'stream',
            mode,
            data: JSON.parse(JSON.stringify(data))
          })
        }

        if (!abortController.signal.aborted) {
          socket.emit(channel, { type: 'done' })
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
  socket.on('agent:cancel', ({ threadId }: { threadId: string }) => {
    const userId = socket.user?.userId
    const thread = getThread(threadId)

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
