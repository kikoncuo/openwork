import { Router } from 'express'
import {
  getMcpServers,
  saveMcpServers,
  type MCPServerConfig
} from '../services/settings.js'
import {
  initiateOAuth,
  hasValidAuth,
  revokeAuth,
  createOAuthProvider
} from '../services/mcp/oauth-service.js'

const router = Router()

// List MCP servers
router.get('/servers', async (_req, res) => {
  try {
    res.json(getMcpServers())
  } catch (error) {
    console.error('[MCP] List error:', error)
    res.status(500).json({ error: 'Failed to list MCP servers' })
  }
})

// Save MCP servers
router.put('/servers', async (req, res) => {
  try {
    const servers: MCPServerConfig[] = req.body
    saveMcpServers(servers)
    res.json(servers)
  } catch (error) {
    console.error('[MCP] Save error:', error)
    res.status(500).json({ error: 'Failed to save MCP servers' })
  }
})

// Add MCP server
router.post('/servers', async (req, res) => {
  try {
    const server: MCPServerConfig = req.body
    const servers = getMcpServers()
    servers.push(server)
    saveMcpServers(servers)
    res.json(servers)
  } catch (error) {
    console.error('[MCP] Add error:', error)
    res.status(500).json({ error: 'Failed to add MCP server' })
  }
})

// Remove MCP server
router.delete('/servers/:serverId', async (req, res) => {
  try {
    const servers = getMcpServers().filter((s) => s.id !== req.params.serverId)
    saveMcpServers(servers)
    res.json(servers)
  } catch (error) {
    console.error('[MCP] Remove error:', error)
    res.status(500).json({ error: 'Failed to remove MCP server' })
  }
})

// Toggle MCP server
router.patch('/servers/:serverId/toggle', async (req, res) => {
  try {
    const servers = getMcpServers().map((s) =>
      s.id === req.params.serverId ? { ...s, enabled: !s.enabled } : s
    )
    saveMcpServers(servers)
    res.json(servers)
  } catch (error) {
    console.error('[MCP] Toggle error:', error)
    res.status(500).json({ error: 'Failed to toggle MCP server' })
  }
})

// Test MCP server connection
router.post('/servers/test', async (req, res) => {
  const { MultiServerMCPClient } = await import('@langchain/mcp-adapters')
  const server = req.body as MCPServerConfig
  console.log(`[MCP Test] Testing server: ${server.name} (transport=${server.transport || 'stdio'}, id=${server.id})`)

  let mcpConfig: Record<string, unknown>

  if (server.transport === 'http') {
    // HTTP transport
    const httpConfig: Record<string, unknown> = {
      url: server.url,
      transport: 'http' as const
    }

    // Add headers
    if (server.headers) {
      httpConfig.headers = { ...server.headers }
    }

    // Add auth
    if (server.auth?.type === 'bearer' && server.auth.bearerToken) {
      httpConfig.headers = {
        ...(httpConfig.headers as Record<string, string> || {}),
        Authorization: `Bearer ${server.auth.bearerToken}`
      }
    } else if (server.auth?.type === 'oauth') {
      httpConfig.authProvider = createOAuthProvider(server.id)
    }

    mcpConfig = { [server.name]: httpConfig }
  } else {
    // Stdio transport (legacy or explicit)
    mcpConfig = {
      [server.name]: {
        command: server.command,
        args: server.args,
        env: server.env
      }
    }
  }

  let client: InstanceType<typeof MultiServerMCPClient> | null = null

  try {
    client = new MultiServerMCPClient({ mcpServers: mcpConfig as Record<string, { command: string; args: string[] }> })
    await client.initializeConnections()
    const tools = await client.getTools()

    const toolInfo = tools.map((t) => ({
      name: t.name,
      description: t.description || ''
    }))

    console.log(`[MCP Test] SUCCESS: ${server.name} — ${toolInfo.length} tools`)
    res.json({
      success: true,
      tools: toolInfo
    })
  } catch (error) {
    console.error(`[MCP Test] FAILED: ${server.name} —`, error instanceof Error ? error.message : error)
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      tools: []
    })
  } finally {
    if (client) {
      try {
        await client.close()
      } catch {
        // Ignore close errors
      }
    }
  }
})

// ============================================
// OAuth endpoints
// ============================================

// Initiate OAuth flow for a server
router.post('/servers/:serverId/oauth/initiate', async (req, res) => {
  try {
    const serverId = req.params.serverId
    const server = getMcpServers().find(s => s.id === serverId)

    if (!server) {
      res.status(404).json({ error: 'Server not found' })
      return
    }

    if (server.transport !== 'http') {
      res.status(400).json({ error: 'OAuth is only supported for HTTP transport servers' })
      return
    }

    const authUrl = await initiateOAuth(serverId, server.url)

    if (!authUrl) {
      // Already authorized
      res.json({ authUrl: null, authorized: true })
      return
    }

    res.json({ authUrl })
  } catch (error) {
    console.error('[MCP OAuth] Initiate error:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to initiate OAuth' })
  }
})

// Check OAuth status for a server
router.get('/servers/:serverId/oauth/status', async (req, res) => {
  try {
    const serverId = req.params.serverId
    const authorized = await hasValidAuth(serverId)
    res.json({ authorized })
  } catch (error) {
    console.error('[MCP OAuth] Status error:', error)
    res.status(500).json({ error: 'Failed to check OAuth status' })
  }
})

// Revoke OAuth for a server
router.post('/servers/:serverId/oauth/revoke', async (req, res) => {
  try {
    const serverId = req.params.serverId
    revokeAuth(serverId)
    res.json({ success: true })
  } catch (error) {
    console.error('[MCP OAuth] Revoke error:', error)
    res.status(500).json({ error: 'Failed to revoke OAuth' })
  }
})

export default router
