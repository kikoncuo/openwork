/**
 * Message Sender Hook Handler
 * Listens for agent:response events and sends messages back to the source
 */

import { HookHandler, HookEvent, HookResult, hookManager } from '../hook-manager.js'

interface AgentResponsePayload {
  threadId: string
  jid: string
  response: string
  agentId?: string
}

/**
 * Message Sender Hook Handler
 * Picks up agent:response events and routes them to the appropriate sender
 */
export const senderHookHandler: HookHandler = {
  id: 'builtin:sender',
  name: 'Message Sender',
  eventTypes: ['agent:response'],
  enabled: true,
  priority: 200,  // Run after agent hook
  handler: async (event: HookEvent): Promise<HookResult> => {
    const { userId, source, payload } = event
    const responsePayload = payload as AgentResponsePayload

    if (!responsePayload?.response || !responsePayload?.jid) {
      console.warn(`[SenderHook] Missing response or jid in payload`)
      return { success: false, error: 'Missing response or jid' }
    }

    try {
      // Route to appropriate sender based on source
      if (source === 'whatsapp') {
        // Dynamically import to avoid circular dependencies
        const { socketManager } = await import('../../apps/whatsapp/socket-manager.js')

        // Emit message:sending event
        await hookManager.emit({
          type: 'message:sending',
          userId,
          source,
          payload: {
            jid: responsePayload.jid,
            message: responsePayload.response,
            threadId: responsePayload.threadId
          }
        })

        const result = await socketManager.sendMessage(
          userId,
          responsePayload.jid,
          responsePayload.response
        )

        if (result.success) {
          console.log(`[SenderHook] Sent response to ${responsePayload.jid}: ${responsePayload.response.substring(0, 50)}...`)

          // Emit message:sent event
          await hookManager.emit({
            type: 'message:sent',
            userId,
            source,
            payload: {
              jid: responsePayload.jid,
              messageId: result.messageId,
              message: responsePayload.response,
              threadId: responsePayload.threadId
            }
          })

          return { success: true }
        } else {
          console.error(`[SenderHook] Failed to send response: ${result.error}`)
          return { success: false, error: result.error }
        }
      }

      // Future: Add support for other sources (Telegram, Slack, etc.)
      console.warn(`[SenderHook] Unknown source: ${source}`)
      return { success: false, error: `Unknown source: ${source}` }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SenderHook] Error sending message:`, error)
      return { success: false, error: errorMessage }
    }
  }
}
