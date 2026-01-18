import { IpcMain } from 'electron'
import {
  listMCPServers,
  getMCPServer,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer
} from '../storage'
import type { MCPServerInput } from '../types/mcp'

export function registerMCPHandlers(ipcMain: IpcMain): void {
  console.log('[MCP] Registering MCP server handlers...')

  // List all MCP servers
  ipcMain.handle('mcp:list', async () => {
    try {
      return listMCPServers()
    } catch (error) {
      console.error('[MCP] Error listing servers:', error)
      throw error
    }
  })

  // Get a specific MCP server
  ipcMain.handle('mcp:get', async (_event, serverId: string) => {
    try {
      return getMCPServer(serverId)
    } catch (error) {
      console.error('[MCP] Error getting server:', error)
      throw error
    }
  })

  // Create a new MCP server
  ipcMain.handle('mcp:create', async (_event, input: MCPServerInput) => {
    try {
      console.log('[MCP] Creating server:', input.name)
      return createMCPServer(input)
    } catch (error) {
      console.error('[MCP] Error creating server:', error)
      throw error
    }
  })

  // Update an existing MCP server
  ipcMain.handle('mcp:update', async (_event, { serverId, updates }: { serverId: string; updates: Partial<MCPServerInput> }) => {
    try {
      console.log('[MCP] Updating server:', serverId)
      return updateMCPServer(serverId, updates)
    } catch (error) {
      console.error('[MCP] Error updating server:', error)
      throw error
    }
  })

  // Delete an MCP server
  ipcMain.handle('mcp:delete', async (_event, serverId: string) => {
    try {
      console.log('[MCP] Deleting server:', serverId)
      return deleteMCPServer(serverId)
    } catch (error) {
      console.error('[MCP] Error deleting server:', error)
      throw error
    }
  })
}
