import { IpcMain } from 'electron'
import {
  getAllAgents,
  getAgent,
  getDefaultAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentConfig,
  updateAgentConfig,
  getAgentThreadCount,
  CreateAgentInput,
  UpdateAgentInput,
  UpdateAgentConfigInput,
  AGENT_ICONS,
  AGENT_COLORS,
} from '../db/agents'

export function registerAgentEntityHandlers(ipcMain: IpcMain): void {
  // ============= AGENT CRUD =============

  ipcMain.handle('agents:list', async () => {
    return getAllAgents()
  })

  ipcMain.handle('agents:get', async (_event, agentId: string) => {
    return getAgent(agentId)
  })

  ipcMain.handle('agents:getDefault', async () => {
    return getDefaultAgent()
  })

  ipcMain.handle('agents:create', async (_event, input: CreateAgentInput) => {
    return createAgent(input)
  })

  ipcMain.handle('agents:update', async (_event, agentId: string, updates: UpdateAgentInput) => {
    return updateAgent(agentId, updates)
  })

  ipcMain.handle('agents:delete', async (_event, agentId: string) => {
    return deleteAgent(agentId)
  })

  ipcMain.handle('agents:getThreadCount', async (_event, agentId: string) => {
    return getAgentThreadCount(agentId)
  })

  // ============= AGENT CONFIG =============

  ipcMain.handle('agents:getConfig', async (_event, agentId: string) => {
    return getAgentConfig(agentId)
  })

  ipcMain.handle('agents:updateConfig', async (_event, agentId: string, updates: UpdateAgentConfigInput) => {
    return updateAgentConfig(agentId, updates)
  })

  // ============= CONSTANTS =============

  ipcMain.handle('agents:getIcons', async () => {
    return AGENT_ICONS
  })

  ipcMain.handle('agents:getColors', async () => {
    return AGENT_COLORS
  })
}
