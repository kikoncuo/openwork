/**
 * WhatsApp Agent Handler
 * Handles incoming WhatsApp messages and triggers agent responses
 */

import { v4 as uuidv4 } from 'uuid'
import {
  getWhatsAppAgentConfig,
  getThreadForJid,
  updateThreadMapping,
  updateThreadMappingActivity,
  isThreadMappingActive
} from './config-store.js'
import { socketManager } from './socket-manager.js'
import { getMessageStore } from './message-store.js'
import { createThread, updateThread, getThread } from '../../db/index.js'
import { createAgentRuntime } from '../../agent/runtime.js'
import { broadcastToUser } from '../../../websocket/index.js'
import type { MessageInfo, ContactInfo } from './types.js'

// Queue of messages being processed per JID to prevent concurrent processing
const processingQueues = new Map<string, Promise<void>>()

/**
 * Format an incoming WhatsApp message for the agent.
 * Includes sender info and message content.
 */
function formatMessageForAgent(message: MessageInfo, contact: ContactInfo | null): string {
  const senderName = contact?.name || contact?.pushName || message.senderName || message.from.split('@')[0]
  const phoneNumber = message.from.split('@')[0]

  let formattedMessage = `[WhatsApp Message]\n`
  formattedMessage += `From: ${senderName}\n`
  formattedMessage += `Phone: +${phoneNumber}\n`
  formattedMessage += `JID: ${message.from}\n`

  if (message.isGroup) {
    formattedMessage += `Group: ${message.to}\n`
  }

  formattedMessage += `---\n`

  // Handle different message types
  if (message.type === 'text') {
    formattedMessage += message.content
  } else if (message.type === 'image') {
    formattedMessage += `[Image Message]${message.content ? ` Caption: ${message.content}` : ''}`
  } else if (message.type === 'video') {
    formattedMessage += `[Video Message]${message.content ? ` Caption: ${message.content}` : ''}`
  } else if (message.type === 'audio') {
    formattedMessage += `[Audio Message]`
  } else if (message.type === 'document') {
    formattedMessage += `[Document]${message.content ? ` ${message.content}` : ''}`
  } else if (message.type === 'sticker') {
    formattedMessage += `[Sticker]`
  } else {
    formattedMessage += `[${message.type || 'Unknown'} Message]${message.content ? ` ${message.content}` : ''}`
  }

  return formattedMessage
}

/**
 * Get or create a thread for a WhatsApp JID.
 * Uses timeout logic to determine if an existing thread should be reused.
 */
async function getOrCreateThreadForJid(
  userId: string,
  jid: string,
  contactName: string,
  agentId: string,
  timeoutMinutes: number
): Promise<string> {
  const existingMapping = getThreadForJid(userId, jid)

  if (existingMapping) {
    // Check if the mapping is still active (within timeout)
    if (isThreadMappingActive(existingMapping, timeoutMinutes)) {
      // Update last activity and reuse thread
      updateThreadMappingActivity(userId, jid)
      console.log(`[WhatsApp Agent] Reusing thread ${existingMapping.thread_id} for JID ${jid}`)
      return existingMapping.thread_id
    } else {
      console.log(`[WhatsApp Agent] Thread ${existingMapping.thread_id} expired for JID ${jid}, creating new thread`)
    }
  }

  // Create a new thread
  const threadId = uuidv4()
  const thread = createThread(threadId, {
    agentId,
    userId,
    source: 'whatsapp',
    whatsappJid: jid,
    whatsappContactName: contactName
  })

  // Set initial title based on contact name
  const title = `WhatsApp: ${contactName}`
  updateThread(threadId, { title })

  // Create or update thread mapping
  updateThreadMapping(userId, jid, threadId)

  // Broadcast thread:created event to the user's connected clients
  broadcastToUser(userId, 'thread:created', {
    thread_id: threadId,
    created_at: new Date(thread.created_at),
    updated_at: new Date(thread.updated_at),
    metadata: thread.metadata ? JSON.parse(thread.metadata) : undefined,
    status: thread.status || 'idle',
    title,
    agent_id: agentId,
    user_id: userId,
    source: 'whatsapp',
    whatsapp_jid: jid,
    whatsapp_contact_name: contactName
  })

  console.log(`[WhatsApp Agent] Created new thread ${threadId} for JID ${jid}`)
  return threadId
}

/**
 * Extract AI response text from agent stream output.
 */
function extractResponseFromAgentOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null

  // Handle different output formats from the agent stream
  // The agent typically returns messages in the format: { messages: [...] }
  const outputObj = output as Record<string, unknown>

  // Check for messages array
  if (Array.isArray(outputObj.messages)) {
    // Find the last AI message
    for (let i = outputObj.messages.length - 1; i >= 0; i--) {
      const msg = outputObj.messages[i] as Record<string, unknown>
      if (msg.type === 'ai' || msg._getType?.() === 'ai' || msg.role === 'assistant') {
        // Extract content
        const content = msg.content
        if (typeof content === 'string') {
          return content
        }
        if (Array.isArray(content)) {
          // Handle content blocks
          for (const block of content) {
            if (typeof block === 'string') return block
            if (typeof block === 'object' && block !== null) {
              const blockObj = block as Record<string, unknown>
              if (blockObj.type === 'text' && typeof blockObj.text === 'string') {
                return blockObj.text
              }
            }
          }
        }
      }
    }
  }

  // Check for direct content
  if (typeof outputObj.content === 'string') {
    return outputObj.content
  }

  return null
}

/**
 * Invoke the agent server-side (without WebSocket).
 * Returns the agent's response text.
 */
async function invokeAgentServerSide(
  threadId: string,
  message: string,
  workspacePath: string
): Promise<string | null> {
  try {
    console.log(`[WhatsApp Agent] Invoking agent for thread ${threadId}`)

    const agent = await createAgentRuntime({
      threadId,
      workspacePath
    })

    // Stream the agent and collect output
    let lastOutput: unknown = null

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      {
        configurable: {
          thread_id: threadId
        }
      }
    )

    for await (const output of stream) {
      lastOutput = output
      // Log for debugging
      // console.log('[WhatsApp Agent] Stream output:', JSON.stringify(output, null, 2))
    }

    // Extract response from the last output
    const response = extractResponseFromAgentOutput(lastOutput)
    console.log(`[WhatsApp Agent] Agent response extracted: ${response ? response.substring(0, 100) + '...' : 'null'}`)

    return response
  } catch (error) {
    console.error(`[WhatsApp Agent] Error invoking agent:`, error)
    return null
  }
}

/**
 * Send a typing indicator to WhatsApp.
 */
async function sendTypingIndicator(userId: string, jid: string, isTyping: boolean): Promise<void> {
  // TODO: Implement typing indicator via Baileys
  // This would require adding a method to socketManager
  // For now, this is a placeholder
}

/**
 * Process a single incoming message.
 * This is the internal function that does the actual work.
 */
async function processMessage(userId: string, message: MessageInfo): Promise<void> {
  const config = getWhatsAppAgentConfig(userId)

  // Check if auto-agent is enabled
  if (!config || !config.enabled || !config.agent_id) {
    console.log(`[WhatsApp Agent] Auto-agent not enabled for user ${userId}`)
    return
  }

  // Get workspace path (required for agent)
  const workspacePath = config.workspace_path
  if (!workspacePath) {
    console.log(`[WhatsApp Agent] No workspace path configured for user ${userId}`)
    return
  }

  const jid = message.isGroup ? message.to : message.from
  const timeoutMinutes = config.thread_timeout_minutes || 30

  // Get contact info for the sender
  const messageStore = getMessageStore()
  const contacts = messageStore.getContacts(userId)
  const contact = contacts.find(c => c.jid === message.from) || null
  const contactName = contact?.name || contact?.pushName || message.senderName || message.from.split('@')[0]

  try {
    // Send typing indicator
    await sendTypingIndicator(userId, jid, true)

    // Get or create thread
    const threadId = await getOrCreateThreadForJid(
      userId,
      jid,
      contactName,
      config.agent_id,
      timeoutMinutes
    )

    // Format message for agent
    const formattedMessage = formatMessageForAgent(message, contact)

    // Invoke agent
    const response = await invokeAgentServerSide(threadId, formattedMessage, workspacePath)

    // Stop typing indicator
    await sendTypingIndicator(userId, jid, false)

    // Send response via WhatsApp if we got one
    if (response) {
      const result = await socketManager.sendMessage(userId, jid, response)
      if (result.success) {
        console.log(`[WhatsApp Agent] Sent response to ${jid}: ${response.substring(0, 50)}...`)
      } else {
        console.error(`[WhatsApp Agent] Failed to send response: ${result.error}`)
      }
    } else {
      console.log(`[WhatsApp Agent] No response generated for message from ${jid}`)
    }
  } catch (error) {
    // Stop typing indicator on error
    await sendTypingIndicator(userId, jid, false)
    console.error(`[WhatsApp Agent] Error processing message:`, error)
  }
}

/**
 * Handle an incoming WhatsApp message.
 * This is the main entry point called by the socket manager.
 *
 * Messages are queued per JID to prevent concurrent processing of messages
 * from the same contact/group.
 */
export async function handleIncomingMessage(userId: string, message: MessageInfo): Promise<void> {
  // Skip messages from self
  if (message.fromMe) {
    return
  }

  const jid = message.isGroup ? message.to : message.from
  const queueKey = `${userId}:${jid}`

  // Get the current queue for this JID, or create empty resolved promise
  const currentQueue = processingQueues.get(queueKey) || Promise.resolve()

  // Chain this message processing after the current queue
  const newQueue = currentQueue.then(() => processMessage(userId, message)).catch(error => {
    console.error(`[WhatsApp Agent] Queue processing error:`, error)
  })

  // Update the queue
  processingQueues.set(queueKey, newQueue)

  // Clean up the queue entry after processing is complete
  newQueue.finally(() => {
    // Only delete if this is still the current queue
    if (processingQueues.get(queueKey) === newQueue) {
      processingQueues.delete(queueKey)
    }
  })
}

/**
 * Check if auto-agent is enabled for a user.
 */
export function isAutoAgentEnabled(userId: string): boolean {
  const config = getWhatsAppAgentConfig(userId)
  return !!(config?.enabled && config.agent_id && config.workspace_path)
}
