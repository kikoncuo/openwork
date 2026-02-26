/**
 * Microsoft Teams Agent Tools
 * Tools for the agent to interact with Microsoft Teams (teams, channels, chats, users, search)
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { microsoftTeamsService } from './index.js'

/**
 * Tool info interface for UI display
 */
export interface TeamsToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
  service: 'teams' | 'chats' | 'users' | 'search'
}

/**
 * Create Microsoft Teams tools for the agent
 *
 * @param userId - The user ID to scope Teams operations to
 * @param agentId - The agent ID (optional, for future use)
 * @param fileAccess - File access abstraction (optional, for future use)
 */
export function createMicrosoftTeamsTools(userId: string, _agentId?: string, _fileAccess?: unknown): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // ============= USER TOOLS =============

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_get_current_user',
      description: `Get the currently authenticated Microsoft Teams user's profile.
Returns display name, email, job title, department, and office location.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({}),
      func: async () => {
        try {
          const user = await microsoftTeamsService.getCurrentUser(userId)
          return `Current user:
  Name: ${user.displayName}
  Email: ${user.mail || user.userPrincipalName}
  Job Title: ${user.jobTitle || 'N/A'}
  Department: ${user.department || 'N/A'}
  Office: ${user.officeLocation || 'N/A'}`
        } catch (error) {
          return `Failed to get current user: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_search_users',
      description: `Search for users in the organization by name or email.
Use this to find people to message or mention.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('Search query (name or email prefix)'),
        limit: z.number().optional().default(10).describe('Maximum number of results (default: 10)')
      }),
      func: async ({ query, limit }) => {
        try {
          const users = await microsoftTeamsService.searchUsers(userId, query, limit)
          if (users.length === 0) {
            return `No users found matching "${query}".`
          }
          const results = users.map((u, i) =>
            `${i + 1}. ${u.displayName} (${u.mail || u.userPrincipalName})${u.jobTitle ? ` - ${u.jobTitle}` : ''}${u.department ? `, ${u.department}` : ''}\n   ID: ${u.id}`
          )
          return `Found ${users.length} user${users.length !== 1 ? 's' : ''}:\n\n${results.join('\n')}`
        } catch (error) {
          return `Failed to search users: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_get_user',
      description: `Get detailed profile for a specific user by their ID or email.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        userIdOrEmail: z.string().describe('The user ID or email address')
      }),
      func: async ({ userIdOrEmail }) => {
        try {
          const user = await microsoftTeamsService.getUser(userId, userIdOrEmail)
          return `User profile:
  Name: ${user.displayName}
  Email: ${user.mail || user.userPrincipalName}
  Job Title: ${user.jobTitle || 'N/A'}
  Department: ${user.department || 'N/A'}
  Office: ${user.officeLocation || 'N/A'}
  ID: ${user.id}`
        } catch (error) {
          return `Failed to get user: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= TEAMS & CHANNELS TOOLS =============

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_list_teams',
      description: `List all Microsoft Teams that the user has joined.
Returns team names, descriptions, and archive status.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({}),
      func: async () => {
        try {
          const teams = await microsoftTeamsService.listTeams(userId)
          if (teams.length === 0) {
            return 'No teams found. You may not be a member of any teams.'
          }
          const results = teams.map((t, i) =>
            `${i + 1}. ${t.displayName}${t.isArchived ? ' (archived)' : ''}${t.description ? `\n   ${t.description}` : ''}\n   ID: ${t.id}`
          )
          return `Found ${teams.length} team${teams.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to list teams: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_list_channels',
      description: `List channels in a Microsoft Teams team.
Returns channel names, descriptions, and membership type.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID (from teams_list_teams)')
      }),
      func: async ({ teamId }) => {
        try {
          const channels = await microsoftTeamsService.listChannels(userId, teamId)
          if (channels.length === 0) {
            return 'No channels found in this team.'
          }
          const results = channels.map((c, i) =>
            `${i + 1}. ${c.displayName} (${c.membershipType || 'standard'})${c.description ? `\n   ${c.description}` : ''}\n   ID: ${c.id}`
          )
          return `Found ${channels.length} channel${channels.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to list channels: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_list_team_members',
      description: `List members of a Microsoft Teams team.
Returns member names, emails, and roles.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID (from teams_list_teams)')
      }),
      func: async ({ teamId }) => {
        try {
          const members = await microsoftTeamsService.listTeamMembers(userId, teamId)
          if (members.length === 0) {
            return 'No members found.'
          }
          const results = members.map((m, i) =>
            `${i + 1}. ${m.displayName}${m.email ? ` (${m.email})` : ''}${m.roles.length ? ` - ${m.roles.join(', ')}` : ''}\n   ID: ${m.id}`
          )
          return `Found ${members.length} member${members.length !== 1 ? 's' : ''}:\n\n${results.join('\n')}`
        } catch (error) {
          return `Failed to list team members: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_get_channel_messages',
      description: `Get recent messages from a Microsoft Teams channel.
Returns message content, sender, and timestamps.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID'),
        channelId: z.string().describe('The channel ID (from teams_list_channels)'),
        limit: z.number().optional().default(20).describe('Maximum number of messages (default: 20, max: 50)')
      }),
      func: async ({ teamId, channelId, limit }) => {
        try {
          const messages = await microsoftTeamsService.getChannelMessages(userId, teamId, channelId, Math.min(limit, 50))
          if (messages.length === 0) {
            return 'No messages found in this channel.'
          }
          const results = messages.map((m, i) => {
            const date = new Date(m.createdDateTime).toLocaleString()
            const mentions = m.mentions?.length ? ` [mentions: ${m.mentions.map(mn => mn.mentionText).join(', ')}]` : ''
            return `${i + 1}. [${date}] ${m.from}${mentions}:\n   ${m.body.substring(0, 300)}${m.body.length > 300 ? '...' : ''}\n   ID: ${m.id}`
          })
          return `${messages.length} message${messages.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to get channel messages: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_get_channel_message_replies',
      description: `Get replies to a specific channel message (thread).
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID'),
        channelId: z.string().describe('The channel ID'),
        messageId: z.string().describe('The message ID to get replies for'),
        limit: z.number().optional().default(20).describe('Maximum number of replies (default: 20)')
      }),
      func: async ({ teamId, channelId, messageId, limit }) => {
        try {
          const replies = await microsoftTeamsService.getChannelMessageReplies(userId, teamId, channelId, messageId, limit)
          if (replies.length === 0) {
            return 'No replies found for this message.'
          }
          const results = replies.map((m, i) => {
            const date = new Date(m.createdDateTime).toLocaleString()
            return `${i + 1}. [${date}] ${m.from}:\n   ${m.body.substring(0, 300)}${m.body.length > 300 ? '...' : ''}\n   ID: ${m.id}`
          })
          return `${replies.length} repl${replies.length !== 1 ? 'ies' : 'y'}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to get replies: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_send_channel_message',
      description: `Send a message to a Microsoft Teams channel.
Supports plain text or HTML content.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID'),
        channelId: z.string().describe('The channel ID'),
        content: z.string().describe('The message content (text or HTML)'),
        contentType: z.enum(['text', 'html']).optional().default('text').describe('Content type: "text" or "html" (default: text)')
      }),
      func: async ({ teamId, channelId, content, contentType }) => {
        try {
          const result = await microsoftTeamsService.sendChannelMessage(userId, teamId, channelId, content, contentType)
          return `Message sent successfully. Message ID: ${result.messageId}`
        } catch (error) {
          return `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_reply_to_channel_message',
      description: `Reply to a message in a Microsoft Teams channel thread.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        teamId: z.string().describe('The team ID'),
        channelId: z.string().describe('The channel ID'),
        messageId: z.string().describe('The message ID to reply to'),
        content: z.string().describe('The reply content (text or HTML)'),
        contentType: z.enum(['text', 'html']).optional().default('text').describe('Content type: "text" or "html" (default: text)')
      }),
      func: async ({ teamId, channelId, messageId, content, contentType }) => {
        try {
          const result = await microsoftTeamsService.replyToChannelMessage(userId, teamId, channelId, messageId, content, contentType)
          return `Reply sent successfully. Reply ID: ${result.messageId}`
        } catch (error) {
          return `Failed to send reply: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= CHAT TOOLS =============

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_list_chats',
      description: `List the user's Microsoft Teams chats (1:1 and group chats).
Returns chat type, topic, and members.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        limit: z.number().optional().default(20).describe('Maximum number of chats (default: 20)')
      }),
      func: async ({ limit }) => {
        try {
          const chats = await microsoftTeamsService.listChats(userId, limit)
          if (chats.length === 0) {
            return 'No chats found.'
          }
          const results = chats.map((c, i) => {
            const members = c.members.map(m => m.displayName).join(', ')
            const updated = c.lastUpdatedDateTime ? new Date(c.lastUpdatedDateTime).toLocaleString() : 'N/A'
            return `${i + 1}. [${c.chatType}] ${c.topic || members || 'Unnamed chat'}\n   Members: ${members}\n   Last updated: ${updated}\n   ID: ${c.id}`
          })
          return `Found ${chats.length} chat${chats.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to list chats: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_get_chat_messages',
      description: `Get recent messages from a Microsoft Teams chat.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        chatId: z.string().describe('The chat ID (from teams_list_chats)'),
        limit: z.number().optional().default(20).describe('Maximum number of messages (default: 20, max: 50)')
      }),
      func: async ({ chatId, limit }) => {
        try {
          const messages = await microsoftTeamsService.getChatMessages(userId, chatId, Math.min(limit, 50))
          if (messages.length === 0) {
            return 'No messages found in this chat.'
          }
          const results = messages.map((m, i) => {
            const date = new Date(m.createdDateTime).toLocaleString()
            return `${i + 1}. [${date}] ${m.from}:\n   ${m.body.substring(0, 300)}${m.body.length > 300 ? '...' : ''}\n   ID: ${m.id}`
          })
          return `${messages.length} message${messages.length !== 1 ? 's' : ''}:\n\n${results.join('\n\n')}`
        } catch (error) {
          return `Failed to get chat messages: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_send_chat_message',
      description: `Send a message in a Microsoft Teams chat.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        chatId: z.string().describe('The chat ID (from teams_list_chats)'),
        content: z.string().describe('The message content (text or HTML)'),
        contentType: z.enum(['text', 'html']).optional().default('text').describe('Content type: "text" or "html" (default: text)')
      }),
      func: async ({ chatId, content, contentType }) => {
        try {
          const result = await microsoftTeamsService.sendChatMessage(userId, chatId, content, contentType)
          return `Message sent successfully. Message ID: ${result.messageId}`
        } catch (error) {
          return `Failed to send chat message: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_create_chat',
      description: `Create a new 1:1 or group chat in Microsoft Teams.
Provide email addresses of the people to chat with.
IMPORTANT: This action requires human approval before execution.
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        memberEmails: z.array(z.string()).describe('Email addresses of people to add to the chat'),
        topic: z.string().optional().describe('Optional topic for group chats')
      }),
      func: async ({ memberEmails, topic }) => {
        try {
          const result = await microsoftTeamsService.createChat(userId, memberEmails, topic)
          return `Chat created successfully. Chat ID: ${result.chatId} (type: ${result.chatType})`
        } catch (error) {
          return `Failed to create chat: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // ============= SEARCH TOOLS =============

  tools.push(
    new DynamicStructuredTool({
      name: 'teams_search_messages',
      description: `Search for messages across Microsoft Teams using Microsoft Search.
Supports KQL (Keyword Query Language) syntax for advanced queries.
Examples: "project update", "from:john", "sent>=2024-01-01"
IMPORTANT: This tool only works if Microsoft Teams is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('Search query (supports KQL syntax)'),
        limit: z.number().optional().default(25).describe('Maximum number of results (default: 25)')
      }),
      func: async ({ query, limit }) => {
        try {
          const results = await microsoftTeamsService.searchMessages(userId, query, limit)
          if (results.messages.length === 0) {
            return `No messages found matching "${query}".`
          }
          const formatted = results.messages.map((m, i) => {
            const date = m.createdDateTime ? new Date(m.createdDateTime).toLocaleString() : 'Unknown date'
            return `${i + 1}. [${date}] ${m.from}:\n   ${m.body.substring(0, 200)}${m.body.length > 200 ? '...' : ''}`
          })
          return `Found ${results.totalCount} result${results.totalCount !== 1 ? 's' : ''} (showing ${results.messages.length}):\n\n${formatted.join('\n\n')}`
        } catch (error) {
          return `Failed to search messages: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  return tools
}

/**
 * Get list of Microsoft Teams tools that require human approval (interrupt)
 */
export function getMicrosoftTeamsInterruptTools(): string[] {
  return [
    'teams_send_channel_message',
    'teams_reply_to_channel_message',
    'teams_send_chat_message',
    'teams_create_chat'
  ]
}

/**
 * Get tool info for UI display
 */
export function getMicrosoftTeamsToolInfo(): TeamsToolInfo[] {
  return [
    // User tools
    { id: 'teams_get_current_user', name: 'Get Current User', description: 'Get your Microsoft Teams profile', requireApproval: false, service: 'users' },
    { id: 'teams_search_users', name: 'Search Users', description: 'Search for people in your organization', requireApproval: false, service: 'users' },
    { id: 'teams_get_user', name: 'Get User Profile', description: 'Get detailed profile for a specific user', requireApproval: false, service: 'users' },
    // Teams & Channel tools
    { id: 'teams_list_teams', name: 'List Teams', description: 'List your joined teams', requireApproval: false, service: 'teams' },
    { id: 'teams_list_channels', name: 'List Channels', description: 'List channels in a team', requireApproval: false, service: 'teams' },
    { id: 'teams_list_team_members', name: 'List Team Members', description: 'List members of a team', requireApproval: false, service: 'teams' },
    { id: 'teams_get_channel_messages', name: 'Get Channel Messages', description: 'Read messages from a channel', requireApproval: false, service: 'teams' },
    { id: 'teams_get_channel_message_replies', name: 'Get Message Replies', description: 'Get replies in a channel thread', requireApproval: false, service: 'teams' },
    { id: 'teams_send_channel_message', name: 'Send Channel Message', description: 'Send a message to a channel', requireApproval: true, service: 'teams' },
    { id: 'teams_reply_to_channel_message', name: 'Reply to Message', description: 'Reply to a channel message', requireApproval: true, service: 'teams' },
    // Chat tools
    { id: 'teams_list_chats', name: 'List Chats', description: 'List your 1:1 and group chats', requireApproval: false, service: 'chats' },
    { id: 'teams_get_chat_messages', name: 'Get Chat Messages', description: 'Read messages from a chat', requireApproval: false, service: 'chats' },
    { id: 'teams_send_chat_message', name: 'Send Chat Message', description: 'Send a message in a chat', requireApproval: true, service: 'chats' },
    { id: 'teams_create_chat', name: 'Create Chat', description: 'Create a new 1:1 or group chat', requireApproval: true, service: 'chats' },
    // Search tools
    { id: 'teams_search_messages', name: 'Search Messages', description: 'Search messages across Teams', requireApproval: false, service: 'search' }
  ]
}
