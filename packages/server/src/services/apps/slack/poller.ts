/**
 * Slack Poller Service
 * Uses search.messages API to efficiently find new messages directed at the user
 */

import type { WebClient } from '@slack/web-api'
import { slackService } from './index.js'
import {
  getSlackAgentConfig,
  getThreadForSlackChannel,
  updateSlackLastProcessedTs,
  isSlackThreadMappingDeleted,
  resetSlackThreadMapping
} from './config-store.js'
import { hookManager } from '../../hooks/hook-manager.js'

interface SlackMessage {
  ts?: string
  user?: string
  username?: string
  text?: string
  type?: string
  subtype?: string
}

interface SearchMatch {
  ts?: string
  text?: string
  user?: string
  username?: string
  channel?: {
    id?: string
    name?: string
  }
  permalink?: string
}

class SlackPoller {
  private intervals = new Map<string, NodeJS.Timeout>()
  private userIds = new Map<string, string>()  // userId -> Slack user ID cache
  private userNameCache = new Map<string, Map<string, string>>()  // userId -> (slackUserId -> displayName)

  /**
   * Start polling for a user
   */
  async start(userId: string): Promise<void> {
    // Check if already polling
    if (this.intervals.has(userId)) {
      console.log(`[SlackPoller] Already polling for user ${userId}`)
      return
    }

    // Check if Slack is connected
    if (!slackService.isConnected(userId)) {
      console.log(`[SlackPoller] Slack not connected for user ${userId}`)
      return
    }

    // Get config
    const config = await getSlackAgentConfig(userId)
    if (!config || !config.enabled) {
      console.log(`[SlackPoller] Slack agent not enabled for user ${userId}`)
      return
    }

    const intervalSeconds = config.poll_interval_seconds || 60
    console.log(`[SlackPoller] Starting polling for user ${userId} every ${intervalSeconds}s`)

    // Run initial poll
    await this.poll(userId)

    // Set up interval
    const interval = setInterval(() => {
      this.poll(userId).catch(error => {
        console.error(`[SlackPoller] Poll error for user ${userId}:`, error)
      })
    }, intervalSeconds * 1000)

    this.intervals.set(userId, interval)
  }

  /**
   * Stop polling for a user
   */
  stop(userId: string): void {
    const interval = this.intervals.get(userId)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(userId)
      console.log(`[SlackPoller] Stopped polling for user ${userId}`)
    }
  }

  /**
   * Stop all polling
   */
  stopAll(): void {
    for (const userId of this.intervals.keys()) {
      this.stop(userId)
    }
  }

  /**
   * Check if polling is active for a user
   */
  isPolling(userId: string): boolean {
    return this.intervals.has(userId)
  }

  /**
   * Resolve Slack user IDs to display names with caching.
   * Fetches user info for any IDs not already cached.
   */
  private async resolveUserNames(
    userId: string,
    client: WebClient,
    slackUserIds: string[]
  ): Promise<Map<string, string>> {
    // Get or create cache for this user
    let cache = this.userNameCache.get(userId)
    if (!cache) {
      cache = new Map()
      this.userNameCache.set(userId, cache)
    }

    // Find IDs not in cache
    const uncached = slackUserIds.filter(id => id && !cache!.has(id))

    // Fetch uncached users
    for (const slackUserId of uncached) {
      try {
        const result = await client.users.info({ user: slackUserId })
        const name = result.user?.real_name || result.user?.name || slackUserId
        cache.set(slackUserId, name)
      } catch {
        cache.set(slackUserId, slackUserId) // Fallback to ID
      }
    }

    return cache
  }

  /**
   * Get the authenticated user's Slack ID
   */
  private async getAuthenticatedUserId(userId: string, client: WebClient): Promise<string | null> {
    // Check cache first
    if (this.userIds.has(userId)) {
      return this.userIds.get(userId)!
    }

    try {
      const auth = await client.auth.test()
      const slackUserId = auth.user_id as string
      this.userIds.set(userId, slackUserId)
      return slackUserId
    } catch (error) {
      console.error(`[SlackPoller] Failed to get authenticated user ID:`, error)
      return null
    }
  }

  /**
   * Poll for new messages using search API
   */
  private async poll(userId: string): Promise<void> {
    // Verify still enabled
    const config = await getSlackAgentConfig(userId)
    if (!config || !config.enabled) {
      this.stop(userId)
      return
    }

    // Check connection
    if (!slackService.isConnected(userId)) {
      console.log(`[SlackPoller] Slack disconnected for user ${userId}, stopping poller`)
      this.stop(userId)
      return
    }

    try {
      const client = slackService.getClient(userId)
      const slackUserId = await this.getAuthenticatedUserId(userId, client)
      if (!slackUserId) return

      // Use search.messages to find messages TO the user
      // This catches: DMs, group DMs, @mentions in channels, @mentions in threads
      const searchResult = await client.search.messages({
        query: 'to:me',
        sort: 'timestamp',
        sort_dir: 'desc',
        count: 50
      })

      const matches = (searchResult.messages?.matches || []) as SearchMatch[]

      if (matches.length === 0) {
        console.log('[SlackPoller] No messages found in search')
        return
      }

      console.log(`[SlackPoller] Search found ${matches.length} messages`)

      // Collect new messages grouped by channel
      const newMessagesByChannel = new Map<string, { messages: SearchMatch[], channelName: string, lastProcessedTs: string }>()

      for (const match of matches) {
        const channelId = match.channel?.id
        const messageTs = match.ts
        const senderUserId = match.user

        if (!channelId || !messageTs) continue

        // Skip messages from self
        if (senderUserId === slackUserId) continue

        // Check if channel is opted-out (deleted)
        let mapping = await getThreadForSlackChannel(userId, channelId)
        if (mapping && isSlackThreadMappingDeleted(mapping)) {
          // Check if timeout has passed since deletion
          const now = Date.now()
          const timeoutMs = config.thread_timeout_seconds * 1000
          const timeSinceDeletion = now - mapping.last_activity_at

          if (timeSinceDeletion < timeoutMs) {
            // Still within timeout - skip this channel
            continue
          }

          // Timeout passed - reset the mapping so we can create a new thread
          console.log(`[SlackPoller] Channel ${channelId} was deleted but timeout passed, resetting`)
          await resetSlackThreadMapping(userId, channelId)
          mapping = await getThreadForSlackChannel(userId, channelId)  // Refresh mapping
        }

        // Check if already processed
        const lastProcessedTs = mapping?.last_processed_ts || null

        // First time seeing this channel - initialize timestamp and skip
        // This prevents processing old messages from before activation
        if (!lastProcessedTs) {
          console.log(`[SlackPoller] First time seeing channel ${channelId}, initializing timestamp`)
          await updateSlackLastProcessedTs(userId, channelId, messageTs)
          continue
        }

        if (messageTs <= lastProcessedTs) continue

        // New message - add to channel group
        const channelName = match.channel?.name || 'Slack'
        const existing = newMessagesByChannel.get(channelId)
        if (existing) {
          existing.messages.push(match)
        } else {
          newMessagesByChannel.set(channelId, {
            messages: [match],
            channelName,
            lastProcessedTs
          })
        }
      }

      // Process each channel's messages as a batch
      for (const [channelId, channelData] of newMessagesByChannel) {
        const { messages: channelMessages, channelName, lastProcessedTs } = channelData

        // Sort by timestamp (oldest first)
        channelMessages.sort((a, b) => parseFloat(a.ts!) - parseFloat(b.ts!))

        // Process as single event with all new messages
        await this.processChannelMessages(userId, client, slackUserId, channelId, channelName, channelMessages, lastProcessedTs)
      }

      if (newMessagesByChannel.size > 0) {
        const totalMessages = Array.from(newMessagesByChannel.values()).reduce((sum, c) => sum + c.messages.length, 0)
        console.log(`[SlackPoller] Processed ${totalMessages} new messages across ${newMessagesByChannel.size} channels`)
      }

    } catch (error) {
      console.error(`[SlackPoller] Poll error for user ${userId}:`, error)
    }
  }

  /**
   * Process all new messages from a single channel as a batch.
   */
  private async processChannelMessages(
    userId: string,
    client: WebClient,
    slackUserId: string,
    channelId: string,
    channelName: string,
    channelMessages: SearchMatch[],
    lastProcessedTs: string
  ): Promise<void> {
    console.log(`[SlackPoller] Processing ${channelMessages.length} new message(s) in ${channelName} (${channelId})`)

    // Check if this is an existing thread or a new one
    const mapping = await getThreadForSlackChannel(userId, channelId)
    const isExistingThread = !!(mapping?.thread_id)

    // Collect all unique user IDs from the new messages for name resolution
    const userIdsInMessages = [...new Set(channelMessages.map(m => m.user).filter((id): id is string => !!id))]
    const userNameMap = await this.resolveUserNames(userId, client, userIdsInMessages)

    // Build context messages only for NEW threads
    let contextMessages = ''
    if (!isExistingThread) {
      // New thread - get full history for context
      try {
        const history = await client.conversations.history({
          channel: channelId,
          limit: 20
        })

        if (history.messages && history.messages.length > 0) {
          // Collect user IDs from history for name resolution
          const historyUserIds = (history.messages as SlackMessage[])
            .map(m => m.user)
            .filter((id): id is string => !!id)
          const allUserIds = [...new Set([...userIdsInMessages, ...historyUserIds])]
          const fullUserNameMap = await this.resolveUserNames(userId, client, allUserIds)

          contextMessages = (history.messages as SlackMessage[])
            .reverse()  // Oldest first
            .map(msg => {
              const isMe = msg.user === slackUserId
              const name = isMe ? 'You' : (fullUserNameMap.get(msg.user || '') || msg.user || 'Unknown')
              const time = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString() : ''
              return `[${time}] ${name}: ${msg.text || ''}`
            })
            .join('\n')
        }
      } catch (historyError) {
        console.error(`[SlackPoller] Error getting history for ${channelId}:`, historyError)
      }
    }
    // For existing threads: agent already has context, no need to repeat history

    // Build the combined content from all new messages
    const newMessagesContent = channelMessages.map(msg => {
      const name = userNameMap.get(msg.user || '') || msg.user || 'Unknown'
      const time = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString() : ''
      return `[${time}] ${name}: ${msg.text || ''}`
    }).join('\n')

    // Use the first message's sender as the primary sender
    const firstMessage = channelMessages[0]
    const primarySenderName = userNameMap.get(firstMessage.user || '') || firstMessage.user || 'Unknown'
    const latestMessage = channelMessages[channelMessages.length - 1]
    const latestTs = latestMessage.ts!

    // Emit to hook system
    await hookManager.emit({
      type: 'message:received',
      userId,
      source: 'slack',
      payload: {
        message: {
          id: latestTs,
          from: firstMessage.user || '',
          to: channelId,
          fromMe: false,
          timestamp: Math.floor(parseFloat(latestTs)),
          type: 'text',
          content: newMessagesContent,  // All new messages concatenated
          isGroup: false,
          senderName: primarySenderName
        },
        slackChannelId: channelId,
        slackChannelName: channelName,
        contextMessages,  // Empty for existing threads, history for new
        messageCount: channelMessages.length,
        isExistingThread
      }
    })

    // Update last processed to the latest message timestamp
    await updateSlackLastProcessedTs(userId, channelId, latestTs)
  }
}

// Singleton instance
export const slackPoller = new SlackPoller()

/**
 * Start polling for all users with Slack enabled
 * Called on server startup
 */
export async function startPollingForAllUsers(): Promise<void> {
  // This would need access to all users - for now, polling starts when user enables
  console.log('[SlackPoller] Poller service initialized')
}
