import { Router } from 'express'
import {
  getMcpServers,
  saveMcpServers,
  type MCPServerConfig
} from '../services/settings.js'

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
  const server = req.body as { name: string; command: string; args: string[]; env?: Record<string, string> }

  const mcpConfig = {
    [server.name]: {
      command: server.command,
      args: server.args,
      env: server.env
    }
  }

  let client: InstanceType<typeof MultiServerMCPClient> | null = null

  try {
    client = new MultiServerMCPClient({ mcpServers: mcpConfig })
    await client.initializeConnections()
    const tools = await client.getTools()

    const toolInfo = tools.map((t) => ({
      name: t.name,
      description: t.description || ''
    }))

    res.json({
      success: true,
      tools: toolInfo
    })
  } catch (error) {
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

export default router
