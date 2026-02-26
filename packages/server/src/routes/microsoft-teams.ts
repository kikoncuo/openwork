import { Router } from 'express'
import { microsoftTeamsService } from '../services/apps/microsoft-teams/index.js'
import { getMicrosoftTeamsToolInfo } from '../services/apps/microsoft-teams/tools.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// ============================================
// Connection Management
// ============================================

// Start OAuth connection
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const authUrl = await microsoftTeamsService.connect(userId)
    res.json({ authUrl })
  } catch (error) {
    console.error('[Microsoft Teams] Connect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect to Microsoft Teams'
    res.status(500).json({ error: message })
  }
})

// Disconnect from Microsoft Teams
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    await microsoftTeamsService.disconnect(userId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Microsoft Teams] Disconnect error:', error)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// Get connection status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const status = await microsoftTeamsService.getConnectionStatus(userId)
    res.json(status)
  } catch (error) {
    console.error('[Microsoft Teams] Status error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get status'
    res.status(500).json({ error: message })
  }
})

// ============================================
// Teams & Channels Routes
// ============================================

// List teams
router.get('/teams', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const teams = await microsoftTeamsService.listTeams(userId)
    res.json(teams)
  } catch (error) {
    console.error('[Microsoft Teams] List teams error:', error)
    res.status(500).json({ error: 'Failed to list teams' })
  }
})

// List channels
router.get('/teams/:teamId/channels', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const teamId = String(req.params.teamId)
    const channels = await microsoftTeamsService.listChannels(userId, teamId)
    res.json(channels)
  } catch (error) {
    console.error('[Microsoft Teams] List channels error:', error)
    res.status(500).json({ error: 'Failed to list channels' })
  }
})

// List team members
router.get('/teams/:teamId/members', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const teamId = String(req.params.teamId)
    const members = await microsoftTeamsService.listTeamMembers(userId, teamId)
    res.json(members)
  } catch (error) {
    console.error('[Microsoft Teams] List members error:', error)
    res.status(500).json({ error: 'Failed to list team members' })
  }
})

// Get channel messages
router.get('/teams/:teamId/channels/:channelId/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const teamId = String(req.params.teamId)
    const channelId = String(req.params.channelId)
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const messages = await microsoftTeamsService.getChannelMessages(userId, teamId, channelId, limit)
    res.json(messages)
  } catch (error) {
    console.error('[Microsoft Teams] Get channel messages error:', error)
    res.status(500).json({ error: 'Failed to get channel messages' })
  }
})

// Send channel message
router.post('/teams/:teamId/channels/:channelId/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const teamId = String(req.params.teamId)
    const channelId = String(req.params.channelId)
    const { content, contentType } = req.body
    const result = await microsoftTeamsService.sendChannelMessage(userId, teamId, channelId, content, contentType)
    res.json(result)
  } catch (error) {
    console.error('[Microsoft Teams] Send channel message error:', error)
    res.status(500).json({ error: 'Failed to send channel message' })
  }
})

// ============================================
// Chat Routes
// ============================================

// List chats
router.get('/chats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const chats = await microsoftTeamsService.listChats(userId, limit)
    res.json(chats)
  } catch (error) {
    console.error('[Microsoft Teams] List chats error:', error)
    res.status(500).json({ error: 'Failed to list chats' })
  }
})

// Get chat messages
router.get('/chats/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const chatId = String(req.params.chatId)
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const messages = await microsoftTeamsService.getChatMessages(userId, chatId, limit)
    res.json(messages)
  } catch (error) {
    console.error('[Microsoft Teams] Get chat messages error:', error)
    res.status(500).json({ error: 'Failed to get chat messages' })
  }
})

// Send chat message
router.post('/chats/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const chatId = String(req.params.chatId)
    const { content, contentType } = req.body
    const result = await microsoftTeamsService.sendChatMessage(userId, chatId, content, contentType)
    res.json(result)
  } catch (error) {
    console.error('[Microsoft Teams] Send chat message error:', error)
    res.status(500).json({ error: 'Failed to send chat message' })
  }
})

// Create chat
router.post('/chats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { memberEmails, topic } = req.body
    const result = await microsoftTeamsService.createChat(userId, memberEmails, topic)
    res.json(result)
  } catch (error) {
    console.error('[Microsoft Teams] Create chat error:', error)
    res.status(500).json({ error: 'Failed to create chat' })
  }
})

// ============================================
// Search Routes
// ============================================

router.post('/search', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const { query, limit } = req.body
    const results = await microsoftTeamsService.searchMessages(userId, query, limit)
    res.json(results)
  } catch (error) {
    console.error('[Microsoft Teams] Search error:', error)
    res.status(500).json({ error: 'Failed to search messages' })
  }
})

// ============================================
// Users Routes
// ============================================

router.get('/users/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const user = await microsoftTeamsService.getCurrentUser(userId)
    res.json(user)
  } catch (error) {
    console.error('[Microsoft Teams] Get current user error:', error)
    res.status(500).json({ error: 'Failed to get current user' })
  }
})

router.get('/users/search', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId
    const query = String(req.query.query || '')
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const users = await microsoftTeamsService.searchUsers(userId, query, limit)
    res.json(users)
  } catch (error) {
    console.error('[Microsoft Teams] Search users error:', error)
    res.status(500).json({ error: 'Failed to search users' })
  }
})

// ============================================
// Tools Route
// ============================================

router.get('/tools', requireAuth, async (_req, res) => {
  try {
    res.json(getMicrosoftTeamsToolInfo())
  } catch (error) {
    console.error('[Microsoft Teams] Get tools error:', error)
    res.status(500).json({ error: 'Failed to get tools' })
  }
})

export default router
