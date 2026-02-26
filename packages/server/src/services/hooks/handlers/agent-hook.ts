/**
 * Agent Hook Handler
 * Processes incoming messages and triggers AI agent responses
 */

import { v4 as uuidv4 } from 'uuid'
import { HookHandler, HookEvent, HookResult, hookManager } from '../hook-manager.js'
import {
  getWhatsAppAgentConfig,
  getThreadForJid,
  updateThreadMapping,
  updateThreadMappingActivity,
  isThreadMappingActive
} from '../../apps/whatsapp/config-store.js'
import {
  getSlackAgentConfig,
  getThreadForSlackChannel,
  updateSlackThreadMapping,
  updateSlackThreadMappingActivity,
  isSlackThreadMappingActive,
  isSlackThreadMappingDeleted
} from '../../apps/slack/config-store.js'
import { createThread, updateThread, setThreadNeedsAttention } from '../../db/index.js'
import { createAgentRuntime } from '../../agent/runtime.js'
import { broadcastToUser } from '../../../websocket/index.js'
import { getMessageStore } from '../../apps/whatsapp/message-store.js'

// Queue of messages being processed per JID to prevent concurrent processing
const processingQueues = new Map<string, Promise<void>>()

interface MessagePayload {
  message: {
    id: string
    from: string
    to: string
    fromMe: boolean
    timestamp: number
    type: string
    content: string
    isGroup: boolean
    senderName?: string
  }
  jid?: string  // WhatsApp JID
  contactName?: string
  // Slack-specific fields
  slackChannelId?: string
  slackChannelName?: string
  contextMessages?: string  // Conversation history (only for new threads)
  messageCount?: number     // Number of new messages in this batch
  isExistingThread?: boolean  // True if this is a continuation of existing thread
}

interface ContactInfo {
  jid: string
  name?: string
  pushName?: string | null
}

/**
 * Format an incoming message for the agent.
 * Includes sender info and message content.
 */
function formatMessageForAgent(message: MessagePayload['message'], contact: ContactInfo | null): string {
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
 * Get or create a thread for a source-specific JID.
 * Uses timeout logic to determine if an existing thread should be reused.
 */
async function getOrCreateThreadForJid(
  userId: string,
  jid: string,
  contactName: string,
  agentId: string,
  timeoutMinutes: number
): Promise<string> {
  const existingMapping = await getThreadForJid(userId, jid)

  if (existingMapping) {
    // Check if the mapping is still active (within timeout)
    if (isThreadMappingActive(existingMapping, timeoutMinutes)) {
      // Update last activity and reuse thread
      await updateThreadMappingActivity(userId, jid)
      console.log(`[AgentHook] Reusing thread ${existingMapping.thread_id} for JID ${jid}`)
      return existingMapping.thread_id
    } else {
      console.log(`[AgentHook] Thread ${existingMapping.thread_id} expired for JID ${jid}, creating new thread`)
    }
  }

  // Create a new thread
  const threadId = uuidv4()
  const thread = await createThread(threadId, {
    agentId,
    userId,
    source: 'whatsapp',
    whatsappJid: jid,
    whatsappContactName: contactName
  })

  // Set initial title based on contact name
  const title = `WhatsApp: ${contactName}`
  await updateThread(threadId, { title })

  // Create or update thread mapping
  await updateThreadMapping(userId, jid, threadId)

  // Emit thread:created event
  await hookManager.emit({
    type: 'thread:created',
    userId,
    source: 'whatsapp',
    payload: {
      threadId,
      agentId,
      jid,
      contactName,
      title
    }
  })

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

  console.log(`[AgentHook] Created new thread ${threadId} for JID ${jid}`)
  return threadId
}

/**
 * Get or create a thread for a Slack channel.
 * Uses timeout logic to determine if an existing thread should be reused.
 */
async function getOrCreateThreadForSlackChannel(
  userId: string,
  slackChannelId: string,
  slackChannelName: string,
  agentId: string,
  timeoutSeconds: number,
  contextMessages?: string
): Promise<string> {
  const existingMapping = await getThreadForSlackChannel(userId, slackChannelId)

  // Check if mapping is deleted (user opted out)
  if (existingMapping && isSlackThreadMappingDeleted(existingMapping)) {
    console.log(`[AgentHook] Slack channel ${slackChannelId} is deleted, skipping`)
    throw new Error('Channel mapping is deleted')
  }

  if (existingMapping) {
    // Check if the mapping is still active (within timeout)
    if (isSlackThreadMappingActive(existingMapping, timeoutSeconds)) {
      // Update last activity and reuse thread
      await updateSlackThreadMappingActivity(userId, slackChannelId)
      console.log(`[AgentHook] Reusing thread ${existingMapping.thread_id} for Slack channel ${slackChannelId}`)
      return existingMapping.thread_id
    } else {
      console.log(`[AgentHook] Thread ${existingMapping.thread_id} expired for Slack channel ${slackChannelId}, creating new thread`)
    }
  }

  // Create a new thread
  const threadId = uuidv4()
  const thread = await createThread(threadId, {
    agentId,
    userId,
    source: 'slack',
    slackChannelId,
    slackChannelName
  })

  // Set initial title based on channel name
  const title = `Slack: ${slackChannelName}`

  // If we have context messages, add them to the search_text for reference
  const searchText = contextMessages ? `${title}\n\n${contextMessages.substring(0, 1500)}` : title
  await updateThread(threadId, { title, search_text: searchText })

  // Create or update thread mapping
  await updateSlackThreadMapping(userId, slackChannelId, threadId)

  // Emit thread:created event
  await hookManager.emit({
    type: 'thread:created',
    userId,
    source: 'slack',
    payload: {
      threadId,
      agentId,
      slackChannelId,
      slackChannelName,
      title
    }
  })

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
    source: 'slack',
    slack_channel_id: slackChannelId,
    slack_channel_name: slackChannelName
  })

  console.log(`[AgentHook] Created new thread ${threadId} for Slack channel ${slackChannelId}`)
  return threadId
}

/**
 * Format a Slack message for the agent.
 */
function formatSlackMessageForAgent(payload: MessagePayload): string {
  const message = payload.message
  const channelName = payload.slackChannelName || 'Slack'
  const channelId = payload.slackChannelId || message.to  // Get the actual channel ID
  const senderName = message.senderName || message.from || 'Unknown'
  const messageCount = payload.messageCount || 1
  const isExistingThread = payload.isExistingThread ?? false

  let formattedMessage = `[Slack Message]\n`
  formattedMessage += `From: ${senderName}\n`
  formattedMessage += `Channel ID: ${channelId}\n`  // Use channel ID for replying

  if (message.isGroup) {
    formattedMessage += `Type: Group/Multi-party DM\n`
  } else {
    formattedMessage += `Type: Direct Message with ${channelName}\n`
  }

  formattedMessage += `---\n`

  // Add conversation history only for NEW threads (not existing ones)
  if (payload.contextMessages && !isExistingThread) {
    formattedMessage += `Conversation history (You = the user, others by name):\n${payload.contextMessages}\n\n---\n`
  }

  // Show new message(s) with appropriate label
  const messageLabel = messageCount > 1 ? `New messages (${messageCount})` : 'Latest message'
  formattedMessage += `${messageLabel} from ${senderName}:\n`
  formattedMessage += message.content || '[No content]'

  return formattedMessage
}

/**
 * Extract AI response text from agent stream output.
 */
function extractResponseFromAgentOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null

  const outputObj = output as Record<string, unknown>

  // Check for messages array
  if (Array.isArray(outputObj.messages)) {
    // Find the last AI message
    for (let i = outputObj.messages.length - 1; i >= 0; i--) {
      const msg = outputObj.messages[i] as Record<string, unknown>
      if (msg.type === 'ai' || (typeof msg._getType === 'function' && (msg._getType as () => string)() === 'ai') || msg.role === 'assistant') {
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
 * Extract interrupt data from stream output.
 * Returns true if an interrupt is detected.
 */
function checkForInterrupt(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false

  const outputObj = output as Record<string, unknown>

  // Check for __interrupt__ in values stream mode
  const interrupt = outputObj.__interrupt__ as Array<{
    value?: {
      actionRequests?: Array<{ name: string; id: string; args: Record<string, unknown> }>
    }
  }> | undefined

  if (interrupt && Array.isArray(interrupt) && interrupt.length > 0) {
    const interruptValue = interrupt[0]?.value
    if (interruptValue?.actionRequests?.length) {
      const actionRequest = interruptValue.actionRequests[0]
      console.log(`[AgentHook] *** INTERRUPT DETECTED ***`)
      console.log(`[AgentHook] Tool: ${actionRequest?.name}`)
      console.log(`[AgentHook] Tool Call ID: ${actionRequest?.id}`)
      console.log(`[AgentHook] Args:`, JSON.stringify(actionRequest?.args))
      return true
    }
  }

  return false
}

/**
 * Invoke the agent server-side.
 * When an interrupt occurs, the checkpoint is saved and we return null.
 * The user can approve/reject later when they view the thread.
 * Returns the agent's response text, or null if interrupted/failed.
 */
async function invokeAgentServerSide(
  threadId: string,
  userId: string,
  message: string
): Promise<string | null> {
  const channel = `agent:stream:${threadId}`

  try {
    console.log(`[AgentHook] ========================================`)
    console.log(`[AgentHook] Invoking agent for thread ${threadId}`)
    console.log(`[AgentHook] User ID: ${userId}`)
    console.log(`[AgentHook] Message: ${message.substring(0, 100)}...`)

    const agent = await createAgentRuntime({
      threadId
    })

    // Stream the agent and collect output
    let lastOutput: unknown = null
    let interruptDetected = false

    // Use streamMode with 'values' to get interrupt data
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      {
        configurable: {
          thread_id: threadId
        },
        streamMode: ['messages', 'values'],
        recursionLimit: 1000
      }
    )

    console.log(`[AgentHook] Stream started, processing chunks...`)

    for await (const chunk of stream) {
      const [mode, data] = chunk as [string, unknown]

      // Broadcast stream event to UI (in case user is watching)
      broadcastToUser(userId, channel, {
        type: 'stream',
        mode,
        data: JSON.parse(JSON.stringify(data))
      })

      // Check for interrupt in values mode
      if (mode === 'values') {
        lastOutput = data

        // Log the keys in the values data for debugging
        const dataObj = data as Record<string, unknown>
        if (dataObj.__interrupt__) {
          console.log(`[AgentHook] Found __interrupt__ in values`)
        }

        if (checkForInterrupt(data)) {
          interruptDetected = true
          console.log(`[AgentHook] Interrupt saved to checkpoint. User can approve later.`)
        }
      }
    }

    console.log(`[AgentHook] Stream completed. Interrupt detected: ${interruptDetected}`)

    // Send done event
    broadcastToUser(userId, channel, { type: 'done' })

    // If interrupt was detected, set needs_attention and return null
    if (interruptDetected) {
      console.log(`[AgentHook] Agent paused for approval - setting needs_attention`)
      await setThreadNeedsAttention(threadId, true)
      // Broadcast thread:updated event
      broadcastToUser(userId, 'thread:updated', {
        thread_id: threadId,
        needs_attention: true
      })
      return null
    }

    // Extract response from the last output
    const response = extractResponseFromAgentOutput(lastOutput)
    console.log(`[AgentHook] Agent response extracted: ${response ? response.substring(0, 100) + '...' : 'null'}`)

    // If we have a response, set needs_attention
    if (response) {
      await setThreadNeedsAttention(threadId, true)
      // Broadcast thread:updated event
      broadcastToUser(userId, 'thread:updated', {
        thread_id: threadId,
        needs_attention: true
      })
    }

    return response
  } catch (error) {
    console.error(`[AgentHook] Error invoking agent:`, error)

    // Broadcast error to UI
    broadcastToUser(userId, channel, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    return null
  }
}

/**
 * Get source-specific agent configuration.
 * Currently only supports WhatsApp, but can be extended for other sources.
 */
async function getSourceAgentConfig(userId: string, source: string) {
  if (source === 'whatsapp') {
    return await getWhatsAppAgentConfig(userId)
  }
  if (source === 'slack') {
    const config = await getSlackAgentConfig(userId)
    if (config) {
      // Normalize config to match WhatsApp structure
      return {
        ...config,
        thread_timeout_minutes: Math.ceil(config.thread_timeout_seconds / 60)
      }
    }
  }
  return null
}

/**
 * Process a single incoming message.
 */
async function processMessage(
  userId: string,
  source: string,
  payload: MessagePayload
): Promise<void> {
  const config = await getSourceAgentConfig(userId, source)

  // Check if auto-agent is enabled
  if (!config || !config.enabled || !config.agent_id) {
    console.log(`[AgentHook] Auto-agent not enabled for user ${userId} (source: ${source})`)
    return
  }

  const message = payload.message

  try {
    let threadId: string
    let formattedMessage: string
    let identifier: string  // jid for WhatsApp, channelId for Slack

    if (source === 'slack' && payload.slackChannelId) {
      // Slack-specific processing
      const slackChannelId = payload.slackChannelId
      const slackChannelName = payload.slackChannelName || 'Slack DM'
      const slackConfig = await getSlackAgentConfig(userId)
      const timeoutSeconds = slackConfig?.thread_timeout_seconds || 60

      identifier = slackChannelId

      // Emit agent:invoked event
      await hookManager.emit({
        type: 'agent:invoked',
        userId,
        source,
        payload: {
          slackChannelId,
          slackChannelName,
          messageContent: message.content,
          agentId: config.agent_id
        }
      })

      // Get or create thread for Slack channel
      threadId = await getOrCreateThreadForSlackChannel(
        userId,
        slackChannelId,
        slackChannelName,
        config.agent_id,
        timeoutSeconds,
        payload.contextMessages
      )

      // Format message for agent
      formattedMessage = formatSlackMessageForAgent(payload)
    } else {
      // WhatsApp processing (default)
      const jid = payload.jid || (message.isGroup ? message.to : message.from)
      const timeoutMinutes = config.thread_timeout_minutes || 30

      // Get contact info for the sender
      const messageStore = getMessageStore()
      const contacts = await messageStore.getContacts(userId)
      const contact = contacts.find(c => c.jid === message.from) || null
      const contactName = payload.contactName || contact?.name || contact?.pushName || message.senderName || message.from.split('@')[0]

      identifier = jid

      // Emit agent:invoked event
      await hookManager.emit({
        type: 'agent:invoked',
        userId,
        source,
        payload: {
          jid,
          contactName,
          messageContent: message.content,
          agentId: config.agent_id
        }
      })

      // Get or create thread for WhatsApp JID
      threadId = await getOrCreateThreadForJid(
        userId,
        jid,
        contactName,
        config.agent_id,
        timeoutMinutes
      )

      // Format message for agent
      formattedMessage = formatMessageForAgent(message, contact)
    }

    // Invoke agent with userId for broadcasting
    const response = await invokeAgentServerSide(threadId, userId, formattedMessage)

    // Emit response or error event
    if (response) {
      // Emit agent:response event for sender handler to pick up
      await hookManager.emit({
        type: 'agent:response',
        userId,
        source,
        payload: {
          threadId,
          ...(source === 'slack' ? { slackChannelId: identifier } : { jid: identifier }),
          response,
          agentId: config.agent_id
        }
      })
    } else {
      console.log(`[AgentHook] No response generated for message from ${identifier}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[AgentHook] Error processing message:`, error)

    // Emit agent:error event
    await hookManager.emit({
      type: 'agent:error',
      userId,
      source,
      payload: {
        jid: payload.jid || (message.isGroup ? message.to : message.from),
        error: errorMessage,
        agentId: config.agent_id
      }
    })
  }
}

/**
 * Agent Hook Handler
 * Listens for message:received events and triggers agent processing
 */
export const agentHookHandler: HookHandler = {
  id: 'builtin:agent',
  name: 'AI Agent Auto-Response',
  eventTypes: ['message:received'],
  enabled: true,
  priority: 100,  // Run early in the chain
  handler: async (event: HookEvent): Promise<HookResult> => {
    const { userId, source, payload } = event
    const messagePayload = payload as unknown as MessagePayload

    // Skip if no message payload
    if (!messagePayload?.message) {
      return { success: true }
    }

    // Skip messages from self
    if (messagePayload.message.fromMe) {
      return { success: true }
    }

    // Check if auto-agent is enabled before processing
    const config = await getSourceAgentConfig(userId, source)
    if (!config?.enabled || !config.agent_id) {
      return { success: true }  // Not enabled, skip
    }

    const message = messagePayload.message
    const jid = message.isGroup ? message.to : message.from
    const queueKey = `${userId}:${jid}`

    // Get the current queue for this JID, or create empty resolved promise
    const currentQueue = processingQueues.get(queueKey) || Promise.resolve()

    // Chain this message processing after the current queue
    const newQueue = currentQueue.then(() => processMessage(userId, source, messagePayload)).catch(error => {
      console.error(`[AgentHook] Queue processing error:`, error)
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

    // Don't await - let processing happen asynchronously
    return { success: true }
  }
}

/**
 * Check if auto-agent is enabled for a user and source.
 */
export async function isAutoAgentEnabled(userId: string, source: string = 'whatsapp'): Promise<boolean> {
  const config = await getSourceAgentConfig(userId, source)
  return !!(config?.enabled && config.agent_id)
}
