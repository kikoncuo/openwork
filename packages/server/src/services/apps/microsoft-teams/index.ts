/**
 * Microsoft Teams Service - Main entry point for Microsoft Teams integration
 * Server-side implementation using Microsoft Graph REST API
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
import { getTeamsAuthStore } from './auth-store.js'
import type {
  TeamsConnectionStatus,
  MicrosoftTokens,
  TeamsTeam,
  TeamsChannel,
  TeamsTeamMember,
  TeamsMessage,
  TeamsChat,
  TeamsUser,
  SendMessageResult,
  CreateChatResult,
  SearchResult
} from './types.js'

export type {
  TeamsConnectionStatus,
  MicrosoftTokens,
  TeamsTeam,
  TeamsChannel,
  TeamsTeamMember,
  TeamsMessage,
  TeamsChat,
  TeamsUser,
  SendMessageResult,
  CreateChatResult,
  SearchResult
}

// OAuth credentials from environment variables
const MS_OAUTH_CLIENT_ID = process.env.MS_OAUTH_CLIENT_ID || ''
const MS_OAUTH_CLIENT_SECRET = process.env.MS_OAUTH_CLIENT_SECRET || ''
const MS_OAUTH_TENANT_ID = process.env.MS_OAUTH_TENANT_ID || 'common'

// Log credential status at module load
console.log('[Microsoft Teams] OAuth Client ID configured:', MS_OAUTH_CLIENT_ID ? `${MS_OAUTH_CLIENT_ID.substring(0, 20)}...` : 'NOT SET')
console.log('[Microsoft Teams] OAuth Client Secret configured:', MS_OAUTH_CLIENT_SECRET ? 'SET' : 'NOT SET')
console.log('[Microsoft Teams] Tenant ID:', MS_OAUTH_TENANT_ID)

// Microsoft Graph API base URL
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

// OAuth endpoints
const AUTHORITY = `https://login.microsoftonline.com/${MS_OAUTH_TENANT_ID}`
const AUTHORIZE_URL = `${AUTHORITY}/oauth2/v2.0/authorize`
const TOKEN_URL = `${AUTHORITY}/oauth2/v2.0/token`

// OAuth scopes for Microsoft Teams
const OAUTH_SCOPES = [
  'User.Read',
  'User.ReadBasic.All',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Read.All',
  'ChannelMessage.Send',
  'TeamMember.Read.All',
  'Chat.ReadBasic',
  'Chat.ReadWrite',
  'ChatMessage.Read',
  'ChatMessage.Send',
  'offline_access',
  'openid',
  'profile',
  'email'
]

type ConnectionCallback = (status: TeamsConnectionStatus) => void

interface UserConnection {
  accessToken: string
  refreshToken: string
  expiryDate: number
  callbacks: Set<ConnectionCallback>
}

interface PendingAuth {
  userId: string
  resolve: (result: { tokens: MicrosoftTokens; email: string; displayName: string }) => void
  reject: (error: Error) => void
}

class MicrosoftTeamsService {
  // Map of userId -> connection
  private connections = new Map<string, UserConnection>()
  private oauthServer: Server | null = null
  private pendingAuths = new Map<string, PendingAuth>()
  private initialized = false

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    console.log('[Microsoft Teams] Initializing service...')

    if (!MS_OAUTH_CLIENT_ID || !MS_OAUTH_CLIENT_SECRET) {
      console.warn('[Microsoft Teams] OAuth credentials not configured. Set MS_OAUTH_CLIENT_ID and MS_OAUTH_CLIENT_SECRET in .env')
    } else {
      console.log('[Microsoft Teams] OAuth credentials configured')
    }

    this.initialized = true
    console.log('[Microsoft Teams] Service initialized')
  }

  /**
   * Start OAuth connection flow for a user
   * Returns the OAuth URL to redirect the user to
   */
  async connect(userId: string): Promise<string> {
    await this.initialize()

    const redirectUri = await this.startOAuthServer()

    // Generate state with userId
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64')

    const params = new URLSearchParams({
      client_id: MS_OAUTH_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES.join(' '),
      state,
      response_mode: 'query',
      prompt: 'consent'
    })

    const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

    // Store pending auth promise
    const authPromise = new Promise<{ tokens: MicrosoftTokens; email: string; displayName: string }>((resolve, reject) => {
      this.pendingAuths.set(state, { userId, resolve, reject })

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingAuths.has(state)) {
          this.pendingAuths.delete(state)
          reject(new Error('Authentication timed out'))
        }
      }, 5 * 60 * 1000)
    })

    // Handle auth completion asynchronously
    authPromise
      .then(async ({ tokens, email, displayName }) => {
        await this.handleAuthSuccess(userId, tokens, email, displayName)
      })
      .catch((error) => {
        console.error('[Microsoft Teams] Auth failed:', error)
      })

    return authUrl
  }

  /**
   * Start the local OAuth callback server
   */
  private async startOAuthServer(): Promise<string> {
    const OAUTH_PORT = 8091

    if (this.oauthServer) {
      return `http://localhost:${OAUTH_PORT}/oauth/callback`
    }

    return new Promise((resolve, reject) => {
      this.oauthServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url?.startsWith('/oauth/callback')) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          const pending = state ? this.pendingAuths.get(state) : null
          if (pending) {
            pending.reject(new Error(`OAuth error: ${error}`))
            this.pendingAuths.delete(state!)
          }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication failed</h2><p>You can close this window.</p></body></html>')
          return
        }

        if (!code || !state) {
          res.writeHead(400)
          res.end('Missing code or state')
          return
        }

        const pending = this.pendingAuths.get(state)
        if (!pending) {
          res.writeHead(400)
          res.end('Unknown auth state')
          return
        }

        try {
          // Exchange code for tokens
          const redirectUri = `http://localhost:${OAUTH_PORT}/oauth/callback`
          const tokenResponse = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: MS_OAUTH_CLIENT_ID,
              client_secret: MS_OAUTH_CLIENT_SECRET,
              code,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
              scope: OAUTH_SCOPES.join(' ')
            }).toString()
          })

          if (!tokenResponse.ok) {
            const errorBody = await tokenResponse.text()
            throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorBody}`)
          }

          const tokenData = await tokenResponse.json() as {
            access_token: string
            refresh_token?: string
            expires_in: number
            scope: string
          }

          const tokens: MicrosoftTokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || '',
            expiry_date: Date.now() + tokenData.expires_in * 1000,
            scope: tokenData.scope
          }

          // Get user info
          const userResponse = await fetch(`${GRAPH_API_BASE}/me`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
          })

          if (!userResponse.ok) {
            throw new Error('Failed to get user info')
          }

          const userData = await userResponse.json() as {
            mail?: string
            userPrincipalName: string
            displayName: string
          }

          const email = userData.mail || userData.userPrincipalName
          const displayName = userData.displayName

          pending.resolve({ tokens, email, displayName })
          this.pendingAuths.delete(state)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<html><body><h2>Connected to Microsoft Teams!</h2><p>Signed in as ${email}. You can close this window.</p><script>window.close()</script></body></html>`)
        } catch (err) {
          console.error('[Microsoft Teams] OAuth callback error:', err)
          pending.reject(err instanceof Error ? err : new Error('OAuth failed'))
          this.pendingAuths.delete(state)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication failed</h2><p>Please try again. You can close this window.</p></body></html>')
        }
      })

      this.oauthServer.listen(OAUTH_PORT, () => {
        console.log(`[Microsoft Teams] OAuth callback server listening on port ${OAUTH_PORT}`)
        resolve(`http://localhost:${OAUTH_PORT}/oauth/callback`)
      })

      this.oauthServer.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          console.log('[Microsoft Teams] OAuth server port already in use, reusing')
          resolve(`http://localhost:${OAUTH_PORT}/oauth/callback`)
        } else {
          reject(err)
        }
      })
    })
  }

  /**
   * Handle successful authentication
   */
  private async handleAuthSuccess(
    userId: string,
    tokens: MicrosoftTokens,
    email: string,
    displayName: string
  ): Promise<void> {
    console.log('[Microsoft Teams] Auth success for user:', userId, 'email:', email)

    // Save tokens to encrypted store
    const authStore = getTeamsAuthStore()
    await authStore.saveTokens(userId, tokens, email, displayName)

    // Set up connection
    const existing = this.connections.get(userId)
    const callbacks = existing?.callbacks || new Set<ConnectionCallback>()

    this.connections.set(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date,
      callbacks
    })

    // Notify listeners
    const status = await this.getConnectionStatus(userId)
    for (const callback of callbacks) {
      try {
        callback(status)
      } catch (e) {
        console.error('[Microsoft Teams] Connection callback error:', e)
      }
    }
  }

  /**
   * Restore session from saved tokens
   */
  async restoreSession(userId: string): Promise<boolean> {
    await this.initialize()

    const authStore = getTeamsAuthStore()
    const tokens = await authStore.getTokens(userId)
    if (!tokens) return false

    try {
      // Refresh token if expired or close to expiry
      if (tokens.expiry_date < Date.now() + 60000) {
        const refreshed = await this.refreshAccessToken(tokens.refresh_token)
        if (!refreshed) return false

        await authStore.updateTokens(userId, refreshed)
        tokens.access_token = refreshed.access_token
        tokens.expiry_date = refreshed.expiry_date
        if (refreshed.refresh_token) {
          tokens.refresh_token = refreshed.refresh_token
        }
      }

      // Verify token works
      const response = await fetch(`${GRAPH_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })

      if (!response.ok) return false

      const existing = this.connections.get(userId)
      const callbacks = existing?.callbacks || new Set<ConnectionCallback>()

      this.connections.set(userId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        callbacks
      })

      console.log(`[Microsoft Teams] Session restored for user ${userId}`)
      return true
    } catch (error) {
      console.error('[Microsoft Teams] Session restore failed:', error)
      return false
    }
  }

  /**
   * Refresh the access token
   */
  private async refreshAccessToken(refreshToken: string): Promise<MicrosoftTokens | null> {
    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: MS_OAUTH_CLIENT_ID,
          client_secret: MS_OAUTH_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: OAUTH_SCOPES.join(' ')
        }).toString()
      })

      if (!response.ok) {
        console.error('[Microsoft Teams] Token refresh failed:', response.status)
        return null
      }

      const data = await response.json() as {
        access_token: string
        refresh_token?: string
        expires_in: number
        scope: string
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        expiry_date: Date.now() + data.expires_in * 1000,
        scope: data.scope
      }
    } catch (error) {
      console.error('[Microsoft Teams] Token refresh error:', error)
      return null
    }
  }

  /**
   * Get a valid access token for a user (auto-refresh if needed)
   */
  private async getAccessToken(userId: string): Promise<string> {
    const conn = this.connections.get(userId)
    if (!conn) throw new Error('Not connected to Microsoft Teams')

    // Refresh if expired or within 60s of expiry
    if (conn.expiryDate < Date.now() + 60000) {
      const refreshed = await this.refreshAccessToken(conn.refreshToken)
      if (!refreshed) throw new Error('Failed to refresh access token')

      conn.accessToken = refreshed.access_token
      conn.expiryDate = refreshed.expiry_date
      if (refreshed.refresh_token) {
        conn.refreshToken = refreshed.refresh_token
      }

      // Update stored tokens
      const authStore = getTeamsAuthStore()
      await authStore.updateTokens(userId, refreshed)
    }

    return conn.accessToken
  }

  /**
   * Make an authenticated request to the Graph API
   */
  private async graphRequest(
    userId: string,
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<unknown> {
    const token = await this.getAccessToken(userId)
    const { method = 'GET', body, headers = {} } = options

    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers
      }
    }

    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(`${GRAPH_API_BASE}${path}`, fetchOptions)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Graph API error ${response.status}: ${errorText}`)
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) return {}

    return response.json()
  }

  /**
   * Disconnect a user
   */
  async disconnect(userId: string): Promise<void> {
    const conn = this.connections.get(userId)
    const callbacks = conn?.callbacks || new Set<ConnectionCallback>()

    this.connections.delete(userId)

    // Clear stored tokens
    const authStore = getTeamsAuthStore()
    await authStore.clearTokens(userId)

    // Notify listeners
    const status: TeamsConnectionStatus = {
      connected: false,
      email: null,
      displayName: null,
      connectedAt: null,
      services: { teams: false, chats: false, users: false, search: false }
    }

    for (const callback of callbacks) {
      try {
        callback(status)
      } catch (e) {
        console.error('[Microsoft Teams] Disconnect callback error:', e)
      }
    }

    console.log(`[Microsoft Teams] Disconnected user ${userId}`)
  }

  /**
   * Check if a user is connected
   */
  isConnected(userId: string): boolean {
    return this.connections.has(userId)
  }

  /**
   * Get connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<TeamsConnectionStatus> {
    if (!this.isConnected(userId)) {
      // Try to restore session
      const restored = await this.restoreSession(userId)
      if (!restored) {
        return {
          connected: false,
          email: null,
          displayName: null,
          connectedAt: null,
          services: { teams: false, chats: false, users: false, search: false }
        }
      }
    }

    const authStore = getTeamsAuthStore()
    const email = await authStore.getEmail(userId)
    const displayName = await authStore.getDisplayName(userId)
    const connectedAt = await authStore.getConnectedAt(userId)

    return {
      connected: true,
      email,
      displayName,
      connectedAt,
      services: {
        teams: true,
        chats: true,
        users: true,
        search: true
      }
    }
  }

  /**
   * Subscribe to connection changes
   */
  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    const conn = this.connections.get(userId)
    if (conn) {
      conn.callbacks.add(callback)
    } else {
      // Store callbacks even if not connected yet
      this.connections.set(userId, {
        accessToken: '',
        refreshToken: '',
        expiryDate: 0,
        callbacks: new Set([callback])
      })
    }

    return () => {
      const c = this.connections.get(userId)
      if (c) {
        c.callbacks.delete(callback)
      }
    }
  }

  // ========================
  // User Operations
  // ========================

  /**
   * Get the current authenticated user's profile
   */
  async getCurrentUser(userId: string): Promise<TeamsUser> {
    const data = await this.graphRequest(userId, '/me') as {
      id: string
      displayName: string
      mail?: string
      userPrincipalName: string
      jobTitle?: string
      department?: string
      officeLocation?: string
    }

    return {
      id: data.id,
      displayName: data.displayName,
      mail: data.mail || data.userPrincipalName,
      userPrincipalName: data.userPrincipalName,
      jobTitle: data.jobTitle,
      department: data.department,
      officeLocation: data.officeLocation
    }
  }

  /**
   * Search for users by name or email
   */
  async searchUsers(userId: string, query: string, limit: number = 10): Promise<TeamsUser[]> {
    const filter = `startswith(displayName,'${query}') or startswith(mail,'${query}') or startswith(userPrincipalName,'${query}')`
    const data = await this.graphRequest(
      userId,
      `/users?$filter=${encodeURIComponent(filter)}&$top=${limit}&$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation`
    ) as { value: Array<{
      id: string; displayName: string; mail?: string; userPrincipalName: string;
      jobTitle?: string; department?: string; officeLocation?: string
    }> }

    return data.value.map(u => ({
      id: u.id,
      displayName: u.displayName,
      mail: u.mail,
      userPrincipalName: u.userPrincipalName,
      jobTitle: u.jobTitle,
      department: u.department,
      officeLocation: u.officeLocation
    }))
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: string, targetUserId: string): Promise<TeamsUser> {
    const data = await this.graphRequest(
      userId,
      `/users/${targetUserId}?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation`
    ) as {
      id: string; displayName: string; mail?: string; userPrincipalName: string;
      jobTitle?: string; department?: string; officeLocation?: string
    }

    return {
      id: data.id,
      displayName: data.displayName,
      mail: data.mail,
      userPrincipalName: data.userPrincipalName,
      jobTitle: data.jobTitle,
      department: data.department,
      officeLocation: data.officeLocation
    }
  }

  // ========================
  // Teams & Channels
  // ========================

  /**
   * List teams the user has joined
   */
  async listTeams(userId: string): Promise<TeamsTeam[]> {
    const data = await this.graphRequest(userId, '/me/joinedTeams') as {
      value: Array<{ id: string; displayName: string; description?: string; isArchived?: boolean }>
    }

    return data.value.map(t => ({
      id: t.id,
      displayName: t.displayName,
      description: t.description,
      isArchived: t.isArchived
    }))
  }

  /**
   * List channels in a team
   */
  async listChannels(userId: string, teamId: string): Promise<TeamsChannel[]> {
    const data = await this.graphRequest(userId, `/teams/${teamId}/channels`) as {
      value: Array<{ id: string; displayName: string; description?: string; membershipType?: string }>
    }

    return data.value.map(c => ({
      id: c.id,
      displayName: c.displayName,
      description: c.description,
      membershipType: c.membershipType
    }))
  }

  /**
   * List members of a team
   */
  async listTeamMembers(userId: string, teamId: string): Promise<TeamsTeamMember[]> {
    const data = await this.graphRequest(userId, `/teams/${teamId}/members`) as {
      value: Array<{
        id: string; displayName: string; email?: string; roles: string[]
      }>
    }

    return data.value.map(m => ({
      id: m.id,
      displayName: m.displayName,
      email: m.email,
      roles: m.roles || []
    }))
  }

  /**
   * Get messages from a channel
   */
  async getChannelMessages(userId: string, teamId: string, channelId: string, limit: number = 20): Promise<TeamsMessage[]> {
    const data = await this.graphRequest(
      userId,
      `/teams/${teamId}/channels/${channelId}/messages?$top=${limit}`
    ) as {
      value: Array<{
        id: string; createdDateTime: string;
        body: { contentType: string; content: string };
        from?: { user?: { id: string; displayName: string } };
        importance?: string; webUrl?: string;
        attachments?: Array<{ id: string; contentType: string; name?: string; contentUrl?: string }>;
        mentions?: Array<{ id: number; mentionText: string; mentioned: { user?: { id: string; displayName: string } } }>
      }>
    }

    return data.value.map(m => this.mapMessage(m))
  }

  /**
   * Get replies to a channel message
   */
  async getChannelMessageReplies(userId: string, teamId: string, channelId: string, messageId: string, limit: number = 20): Promise<TeamsMessage[]> {
    const data = await this.graphRequest(
      userId,
      `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies?$top=${limit}`
    ) as { value: Array<unknown> }

    return data.value.map(m => this.mapMessage(m as Record<string, unknown>))
  }

  /**
   * Send a message to a channel
   */
  async sendChannelMessage(userId: string, teamId: string, channelId: string, content: string, contentType: 'text' | 'html' = 'html'): Promise<SendMessageResult> {
    const data = await this.graphRequest(
      userId,
      `/teams/${teamId}/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: {
          body: { contentType, content }
        }
      }
    ) as { id: string; createdDateTime: string }

    return { messageId: data.id, createdDateTime: data.createdDateTime }
  }

  /**
   * Reply to a channel message
   */
  async replyToChannelMessage(userId: string, teamId: string, channelId: string, messageId: string, content: string, contentType: 'text' | 'html' = 'html'): Promise<SendMessageResult> {
    const data = await this.graphRequest(
      userId,
      `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
      {
        method: 'POST',
        body: {
          body: { contentType, content }
        }
      }
    ) as { id: string; createdDateTime: string }

    return { messageId: data.id, createdDateTime: data.createdDateTime }
  }

  // ========================
  // Chat Operations
  // ========================

  /**
   * List the user's chats
   */
  async listChats(userId: string, limit: number = 20): Promise<TeamsChat[]> {
    const data = await this.graphRequest(
      userId,
      `/me/chats?$expand=members&$top=${limit}&$orderby=lastUpdatedDateTime desc`
    ) as {
      value: Array<{
        id: string; chatType: 'oneOnOne' | 'group' | 'meeting'; topic?: string;
        lastUpdatedDateTime?: string;
        members: Array<{ id: string; displayName: string; email?: string }>
      }>
    }

    return data.value.map(c => ({
      id: c.id,
      chatType: c.chatType,
      topic: c.topic,
      lastUpdatedDateTime: c.lastUpdatedDateTime,
      members: (c.members || []).map(m => ({
        id: m.id,
        displayName: m.displayName,
        email: m.email
      }))
    }))
  }

  /**
   * Get messages from a chat
   */
  async getChatMessages(userId: string, chatId: string, limit: number = 20): Promise<TeamsMessage[]> {
    const data = await this.graphRequest(
      userId,
      `/me/chats/${chatId}/messages?$top=${limit}`
    ) as { value: Array<unknown> }

    return data.value.map(m => this.mapMessage(m as Record<string, unknown>))
  }

  /**
   * Send a message to a chat
   */
  async sendChatMessage(userId: string, chatId: string, content: string, contentType: 'text' | 'html' = 'html'): Promise<SendMessageResult> {
    const data = await this.graphRequest(
      userId,
      `/me/chats/${chatId}/messages`,
      {
        method: 'POST',
        body: {
          body: { contentType, content }
        }
      }
    ) as { id: string; createdDateTime: string }

    return { messageId: data.id, createdDateTime: data.createdDateTime }
  }

  /**
   * Create a new chat
   */
  async createChat(userId: string, memberEmails: string[], topic?: string): Promise<CreateChatResult> {
    const chatType = memberEmails.length === 1 ? 'oneOnOne' : 'group'

    // Build members array - need to look up user IDs from emails
    const members = []
    for (const email of memberEmails) {
      members.push({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${email}')`
      })
    }

    // Add the current user
    const currentUser = await this.getCurrentUser(userId)
    members.push({
      '@odata.type': '#microsoft.graph.aadUserConversationMember',
      roles: ['owner'],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${currentUser.id}')`
    })

    const body: Record<string, unknown> = {
      chatType,
      members
    }
    if (topic && chatType === 'group') {
      body.topic = topic
    }

    const data = await this.graphRequest(userId, '/chats', {
      method: 'POST',
      body
    }) as { id: string; chatType: string }

    return { chatId: data.id, chatType: data.chatType }
  }

  // ========================
  // Search
  // ========================

  /**
   * Search messages across Teams using Microsoft Search API
   */
  async searchMessages(userId: string, query: string, limit: number = 25): Promise<SearchResult> {
    try {
      const data = await this.graphRequest(userId, '/search/query', {
        method: 'POST',
        body: {
          requests: [{
            entityTypes: ['chatMessage'],
            query: { queryString: query },
            from: 0,
            size: limit
          }]
        }
      }) as {
        value: Array<{
          hitsContainers: Array<{
            total: number
            hits: Array<{
              resource: {
                id: string
                createdDateTime: string
                body?: { content: string }
                from?: { user?: { id: string; displayName: string } }
                webUrl?: string
              }
            }>
          }>
        }>
      }

      const hitsContainer = data.value?.[0]?.hitsContainers?.[0]
      if (!hitsContainer?.hits) {
        return { messages: [], totalCount: 0 }
      }

      const messages: TeamsMessage[] = hitsContainer.hits.map(hit => ({
        id: hit.resource.id || '',
        createdDateTime: hit.resource.createdDateTime || '',
        body: hit.resource.body?.content || '',
        from: hit.resource.from?.user?.displayName || 'Unknown',
        fromId: hit.resource.from?.user?.id,
        webUrl: hit.resource.webUrl
      }))

      return { messages, totalCount: hitsContainer.total || messages.length }
    } catch (error) {
      console.error('[Microsoft Teams] Search failed:', error)
      return { messages: [], totalCount: 0 }
    }
  }

  // ========================
  // Helper Methods
  // ========================

  /**
   * Map a raw Graph API message to our TeamsMessage type
   */
  private mapMessage(raw: Record<string, unknown>): TeamsMessage {
    const body = raw.body as { contentType?: string; content?: string } | undefined
    const from = raw.from as { user?: { id: string; displayName: string } } | undefined
    const attachments = raw.attachments as Array<{
      id: string; contentType: string; name?: string; contentUrl?: string
    }> | undefined
    const mentions = raw.mentions as Array<{
      id: number; mentionText: string; mentioned: { user?: { id: string; displayName: string } }
    }> | undefined

    // Strip HTML tags for a cleaner body text
    let bodyText = body?.content || ''
    if (body?.contentType === 'html') {
      bodyText = bodyText.replace(/<[^>]*>/g, '').trim()
    }

    return {
      id: raw.id as string || '',
      createdDateTime: raw.createdDateTime as string || '',
      body: bodyText,
      from: from?.user?.displayName || 'Unknown',
      fromId: from?.user?.id,
      importance: raw.importance as string,
      webUrl: raw.webUrl as string,
      attachments: attachments?.map(a => ({
        id: a.id,
        contentType: a.contentType,
        name: a.name,
        contentUrl: a.contentUrl
      })),
      mentions: mentions?.map(m => ({
        id: m.id,
        mentionText: m.mentionText,
        mentioned: m.mentioned
      }))
    }
  }
}

// Singleton instance
export const microsoftTeamsService = new MicrosoftTeamsService()
