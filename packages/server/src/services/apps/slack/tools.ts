/**
 * Slack Tools for Agent
 * Provides Slack workspace interaction capabilities
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { basename } from 'path'
import { slackService } from './index.js'
import type { SlackToolInfo } from './types.js'
import type { SandboxFileAccess } from '../../agent/sandbox-file-access.js'

/** All required Slack User Token Scopes and what they enable */
const REQUIRED_SCOPES: Record<string, string> = {
  'channels:read': 'List channels',
  'channels:history': 'Read messages',
  'chat:write': 'Send messages',
  'reactions:write': 'Add reactions',
  'users:read': 'List users',
  'users:read.email': 'Read user emails',
  'search:read': 'Search messages',
  'files:write': 'Upload files',
  'files:read': 'Download files & view file info',
}

/** Format a descriptive error when a Slack API call fails due to missing OAuth scopes */
function formatSlackError(error: unknown, toolAction: string): string {
  if (!(error instanceof Error)) return `Failed to ${toolAction}: Unknown error`

  const msg = error.message || ''

  // Detect missing_scope errors from @slack/web-api
  if (msg.includes('missing_scope')) {
    // Try to extract the needed scope from the error data (Slack SDK attaches .data to errors)
    const errorData = (error as unknown as Record<string, unknown>).data as Record<string, unknown> | undefined
    const neededScope = errorData?.needed as string | undefined

    let response = `Failed to ${toolAction}: Missing required Slack OAuth scope.`
    if (neededScope) {
      response += `\n\nScope needed: ${neededScope}`
      if (REQUIRED_SCOPES[neededScope]) {
        response += ` (${REQUIRED_SCOPES[neededScope]})`
      }
    }
    response += '\n\nTo fix this:'
    response += '\n1. Go to https://api.slack.com/apps → select your app → OAuth & Permissions (left sidebar)'
    response += '\n2. Scroll to "User Token Scopes" and add the missing scope(s):'
    response += `\n   ${Object.entries(REQUIRED_SCOPES).map(([scope, desc]) => `${scope} (${desc})`).join('\n   ')}`
    response += '\n3. IMPORTANT: After adding scopes, you must click "Reinstall to Workspace" at the top of the OAuth & Permissions page'
    response += '\n4. Copy the new xoxp- token and reconnect in Settings → Apps → Slack'
    return response
  }

  return `Failed to ${toolAction}: ${msg}`
}

/** Format file attachment info from a Slack message's files array */
function formatFileInfo(files: { id?: string; name?: string; size?: number }[] | undefined): string {
  if (!files || files.length === 0) return ''
  return files.map(f => {
    const size = f.size ? ` - ${(f.size / 1024 / 1024).toFixed(1)}MB` : ''
    return ` [File: ${f.name || 'unknown'} (${f.id || 'no-id'})${size}]`
  }).join('')
}

/**
 * Create Slack tools for the agent
 * @param userId - The user ID for API access
 * @param agentId - The agent ID
 * @param fileAccess - File access abstraction for reading/writing sandbox files
 */
export function createSlackTools(userId: string, agentId: string, fileAccess?: SandboxFileAccess): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // 1. List channels
  tools.push(new DynamicStructuredTool({
    name: 'slack_list_channels',
    description: 'List Slack channels in the workspace. Returns channel names, IDs, topics, and member counts.',
    schema: z.object({
      limit: z.number().optional().default(100).describe('Max channels (default 100, max 200)'),
      cursor: z.string().optional().describe('Pagination cursor')
    }),
    func: async ({ limit, cursor }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.conversations.list({
          types: 'public_channel,private_channel',
          limit,
          cursor: cursor || undefined,
          exclude_archived: true
        })
        const channels = (result.channels || []).map(ch => ({
          id: ch.id, name: ch.name, topic: ch.topic?.value, purpose: ch.purpose?.value,
          num_members: ch.num_members
        }))
        let response = `Found ${channels.length} channels:\n\n`
        response += channels.map(ch =>
          `#${ch.name} (${ch.id}) - ${ch.num_members} members${ch.topic ? `: ${ch.topic}` : ''}`
        ).join('\n')
        if (result.response_metadata?.next_cursor) {
          response += `\n\nMore channels available. Use cursor: "${result.response_metadata.next_cursor}"`
        }
        return response
      } catch (error) {
        return formatSlackError(error, 'list channels')
      }
    }
  }))

  // 2. Post message (requires approval)
  tools.push(new DynamicStructuredTool({
    name: 'slack_post_message',
    description: 'Post a message to a Slack channel or DM. Accepts channel ID (C...), DM channel ID (D...), or user ID (U...) for direct messages. Optionally attach a file from the workspace.',
    schema: z.object({
      channel_id: z.string().describe('Channel ID (C...), DM channel ID (D...), or user ID (U...) for DMs'),
      text: z.string().describe('Message text (supports Slack markdown)'),
      file_path: z.string().optional().describe('Path to file in workspace to attach')
    }),
    func: async ({ channel_id, text, file_path }) => {
      try {
        const client = slackService.getClient(userId)

        // If user ID provided, open DM to get channel ID
        let targetChannel = channel_id
        if (channel_id.startsWith('U')) {
          const dmResult = await client.conversations.open({ users: channel_id })
          if (!dmResult.channel?.id) {
            return `ERROR: Could not open DM with user ${channel_id}`
          }
          targetChannel = dmResult.channel.id
        }

        if (file_path) {
          if (!fileAccess) {
            return 'ERROR: Cannot attach files - file access not available.'
          }
          const fileData = await fileAccess.getFile(file_path)
          if (!fileData) {
            return `ERROR: File not found at path: ${file_path}`
          }
          const buffer = Buffer.from(fileData.content, fileData.encoding === 'base64' ? 'base64' : 'utf8')
          const result = await client.filesUploadV2({
            channel_id: targetChannel,
            file: buffer,
            filename: basename(file_path),
            initial_comment: text
          })
          return `File "${basename(file_path)}" uploaded to <#${targetChannel}> with message (file id: ${result.files?.[0]?.files?.[0]?.id || 'unknown'})`
        }

        const result = await client.chat.postMessage({ channel: targetChannel, text })
        return `Message posted to <#${targetChannel}> (ts: ${result.ts})`
      } catch (error) {
        return formatSlackError(error, 'post message')
      }
    }
  }))

  // 3. Reply to thread (requires approval)
  tools.push(new DynamicStructuredTool({
    name: 'slack_reply_to_thread',
    description: 'Reply to a specific message thread in Slack. Accepts channel ID (C...), DM channel ID (D...), or user ID (U...). Optionally attach a file from the workspace.',
    schema: z.object({
      channel_id: z.string().describe('Channel ID (C...), DM channel ID (D...), or user ID (U...)'),
      thread_ts: z.string().describe('Thread timestamp of the parent message'),
      text: z.string().describe('Reply text'),
      file_path: z.string().optional().describe('Path to file in workspace to attach')
    }),
    func: async ({ channel_id, thread_ts, text, file_path }) => {
      try {
        const client = slackService.getClient(userId)

        // If user ID provided, open DM to get channel ID
        let targetChannel = channel_id
        if (channel_id.startsWith('U')) {
          const dmResult = await client.conversations.open({ users: channel_id })
          if (!dmResult.channel?.id) {
            return `ERROR: Could not open DM with user ${channel_id}`
          }
          targetChannel = dmResult.channel.id
        }

        if (file_path) {
          if (!fileAccess) {
            return 'ERROR: Cannot attach files - file access not available.'
          }
          const fileData = await fileAccess.getFile(file_path)
          if (!fileData) {
            return `ERROR: File not found at path: ${file_path}`
          }
          const buffer = Buffer.from(fileData.content, fileData.encoding === 'base64' ? 'base64' : 'utf8')
          const result = await client.filesUploadV2({
            channel_id: targetChannel,
            file: buffer,
            filename: basename(file_path),
            initial_comment: text,
            thread_ts
          })
          return `File "${basename(file_path)}" uploaded to thread ${thread_ts} in <#${targetChannel}> (file id: ${result.files?.[0]?.files?.[0]?.id || 'unknown'})`
        }

        const result = await client.chat.postMessage({ channel: targetChannel, text, thread_ts })
        return `Reply posted to thread ${thread_ts} in <#${targetChannel}> (ts: ${result.ts})`
      } catch (error) {
        return formatSlackError(error, 'reply to thread')
      }
    }
  }))

  // 4. Add reaction (requires approval)
  tools.push(new DynamicStructuredTool({
    name: 'slack_add_reaction',
    description: 'Add an emoji reaction to a message.',
    schema: z.object({
      channel_id: z.string().describe('Channel ID'),
      timestamp: z.string().describe('Message timestamp to react to'),
      emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup")')
    }),
    func: async ({ channel_id, timestamp, emoji }) => {
      try {
        const client = slackService.getClient(userId)
        await client.reactions.add({ channel: channel_id, name: emoji, timestamp })
        return `Added :${emoji}: reaction to message ${timestamp} in <#${channel_id}>`
      } catch (error) {
        return formatSlackError(error, 'add reaction')
      }
    }
  }))

  // 5. Get channel history
  tools.push(new DynamicStructuredTool({
    name: 'slack_get_channel_history',
    description: 'Get recent messages from a Slack channel. Shows file attachments if present.',
    schema: z.object({
      channel_id: z.string().describe('Channel ID'),
      limit: z.number().optional().default(20).describe('Number of messages (default 20, max 100)')
    }),
    func: async ({ channel_id, limit }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.conversations.history({ channel: channel_id, limit })
        const messages = result.messages || []
        if (messages.length === 0) return `No messages found in <#${channel_id}>`
        return messages.map(m =>
          `[${m.ts}] <@${m.user}>: ${m.text}${m.reply_count ? ` (${m.reply_count} replies)` : ''}${formatFileInfo(m.files as { id?: string; name?: string; size?: number }[] | undefined)}`
        ).join('\n')
      } catch (error) {
        return formatSlackError(error, 'get channel history')
      }
    }
  }))

  // 6. Get thread replies
  tools.push(new DynamicStructuredTool({
    name: 'slack_get_thread_replies',
    description: 'Get replies to a specific thread. Shows file attachments if present.',
    schema: z.object({
      channel_id: z.string().describe('Channel ID'),
      thread_ts: z.string().describe('Thread timestamp'),
      limit: z.number().optional().default(20).describe('Number of replies (default 20, max 100)')
    }),
    func: async ({ channel_id, thread_ts, limit }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.conversations.replies({ channel: channel_id, ts: thread_ts, limit })
        const messages = (result.messages || []).slice(1) // Skip parent message
        if (messages.length === 0) return 'No replies in this thread'
        return messages.map(m =>
          `[${m.ts}] <@${m.user}>: ${m.text}${formatFileInfo(m.files as { id?: string; name?: string; size?: number }[] | undefined)}`
        ).join('\n')
      } catch (error) {
        return formatSlackError(error, 'get thread replies')
      }
    }
  }))

  // 7. List users
  tools.push(new DynamicStructuredTool({
    name: 'slack_get_users',
    description: 'List workspace users. Returns names, IDs, and status.',
    schema: z.object({
      limit: z.number().optional().default(100).describe('Max users (default 100, max 200)'),
      cursor: z.string().optional().describe('Pagination cursor')
    }),
    func: async ({ limit, cursor }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.users.list({ limit, cursor: cursor || undefined })
        const users = (result.members || [])
          .filter(u => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')
          .map(u => ({
            id: u.id, name: u.real_name || u.name,
            display_name: u.profile?.display_name,
            title: u.profile?.title, status: u.profile?.status_text
          }))
        let response = `Found ${users.length} users:\n\n`
        response += users.map(u =>
          `${u.name} (${u.id})${u.title ? ` - ${u.title}` : ''}${u.status ? ` [${u.status}]` : ''}`
        ).join('\n')
        if (result.response_metadata?.next_cursor) {
          response += `\n\nMore users available. Use cursor: "${result.response_metadata.next_cursor}"`
        }
        return response
      } catch (error) {
        return formatSlackError(error, 'list users')
      }
    }
  }))

  // 8. Get user profile
  tools.push(new DynamicStructuredTool({
    name: 'slack_get_user_profile',
    description: 'Get detailed profile information for a specific user.',
    schema: z.object({
      user_id: z.string().describe('User ID (e.g., U0123456789)')
    }),
    func: async ({ user_id }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.users.info({ user: user_id })
        const u = result.user
        if (!u) return `User ${user_id} not found`
        return [
          `Name: ${u.real_name || u.name}`,
          u.profile?.display_name ? `Display: ${u.profile.display_name}` : null,
          u.profile?.title ? `Title: ${u.profile.title}` : null,
          u.profile?.email ? `Email: ${u.profile.email}` : null,
          u.profile?.status_text ? `Status: ${u.profile.status_emoji || ''} ${u.profile.status_text}` : null,
          `Timezone: ${u.tz_label || u.tz}`,
          `Admin: ${u.is_admin ? 'Yes' : 'No'}`
        ].filter(Boolean).join('\n')
      } catch (error) {
        return formatSlackError(error, 'get user profile')
      }
    }
  }))

  // 9. Search messages
  tools.push(new DynamicStructuredTool({
    name: 'slack_search_messages',
    description: 'Search messages across the workspace. Supports Slack search operators (from:, in:, has:, etc.). Shows file attachments if present.',
    schema: z.object({
      query: z.string().describe('Search query (supports Slack search operators)'),
      count: z.number().optional().default(10).describe('Number of results (default 10, max 50)')
    }),
    func: async ({ query, count }) => {
      try {
        const client = slackService.getClient(userId)
        const result = await client.search.messages({ query, count })
        const matches = result.messages?.matches || []
        if (matches.length === 0) return `No messages found for "${query}"`
        return matches.map(m =>
          `[${m.ts}] <@${m.user}> in <#${m.channel?.id}>: ${m.text}${formatFileInfo(m.files as { id?: string; name?: string; size?: number }[] | undefined)}`
        ).join('\n\n')
      } catch (error) {
        return formatSlackError(error, 'search messages')
      }
    }
  }))

  // 10. Download file
  if (fileAccess) {
    tools.push(new DynamicStructuredTool({
      name: 'slack_download_file',
      description: 'Download a file from Slack by its file ID and save it to the workspace. Use file IDs from channel history or search results.',
      schema: z.object({
        file_id: z.string().describe('Slack file ID (e.g., F0123456789)'),
        save_as: z.string().optional().describe('Workspace path to save the file (default: /home/user/downloads/<filename>)')
      }),
      func: async ({ file_id, save_as }) => {
        try {
          const client = slackService.getClient(userId)

          // Get file metadata
          const fileInfo = await client.files.info({ file: file_id })
          const file = fileInfo.file
          if (!file) return `File ${file_id} not found`

          const downloadUrl = file.url_private_download || file.url_private
          if (!downloadUrl) return `File ${file_id} has no download URL`

          const filename = file.name || `slack-file-${file_id}`
          const savePath = save_as || `/home/user/downloads/${filename}`

          // Download the file with bot token auth
          const response = await fetch(downloadUrl, {
            headers: { Authorization: `Bearer ${client.token}` }
          })
          if (!response.ok) {
            return `Failed to download file: HTTP ${response.status}`
          }

          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          // Determine encoding based on mimetype
          const mimetype = file.mimetype || ''
          const isText = mimetype.startsWith('text/') || mimetype === 'application/json' || mimetype === 'application/xml'
          const encoding = isText ? 'utf8' : 'base64'
          const content = isText ? buffer.toString('utf8') : buffer.toString('base64')

          await fileAccess.saveFile(savePath, content, encoding)

          const sizeStr = file.size ? ` (${(file.size / 1024 / 1024).toFixed(1)}MB)` : ''
          return `Downloaded "${filename}"${sizeStr} to ${savePath}`
        } catch (error) {
          return formatSlackError(error, 'download file')
        }
      }
    }))
  }

  return tools
}

/**
 * Get tools that require human approval before execution
 */
export function getSlackInterruptTools(): string[] {
  return ['slack_post_message', 'slack_reply_to_thread', 'slack_add_reaction']
}

/**
 * Get tool info for the UI
 */
export function getSlackToolInfo(): SlackToolInfo[] {
  return [
    { id: 'slack_list_channels', name: 'List Channels', description: 'List public Slack channels', requireApproval: false },
    { id: 'slack_post_message', name: 'Post Message', description: 'Post a message to a channel (optionally with file)', requireApproval: true },
    { id: 'slack_reply_to_thread', name: 'Reply to Thread', description: 'Reply in a message thread (optionally with file)', requireApproval: true },
    { id: 'slack_add_reaction', name: 'Add Reaction', description: 'Add an emoji reaction', requireApproval: true },
    { id: 'slack_get_channel_history', name: 'Channel History', description: 'Get recent channel messages', requireApproval: false },
    { id: 'slack_get_thread_replies', name: 'Thread Replies', description: 'Get replies to a thread', requireApproval: false },
    { id: 'slack_get_users', name: 'List Users', description: 'List workspace users', requireApproval: false },
    { id: 'slack_get_user_profile', name: 'User Profile', description: 'Get user profile details', requireApproval: false },
    { id: 'slack_search_messages', name: 'Search Messages', description: 'Search messages across workspace', requireApproval: false },
    { id: 'slack_download_file', name: 'Download File', description: 'Download a file from Slack to workspace', requireApproval: false },
  ]
}
