/**
 * Exa IPC handlers for main process
 * Exposes Search and Datasets functionality to the renderer process
 */

import { IpcMain, BrowserWindow } from 'electron'
import { exaService } from '../apps/exa'
import { getExaToolInfo } from '../apps/exa/tools'
import type { ExaToolInfo } from '../apps/exa/types'
import { setApiKey } from '../storage'
import type { ExaConnectionStatus } from '../apps/exa/types'

export function registerExaHandlers(ipcMain: IpcMain): void {
  // ============= CONNECTION MANAGEMENT =============

  /**
   * Connect to Exa with API key
   * Saves the API key and establishes connection
   */
  ipcMain.handle('exa:connect', async (_event, apiKey?: string): Promise<void> => {
    try {
      // Save API key if provided
      if (apiKey) {
        setApiKey('exa', apiKey)
      }

      await exaService.connect(apiKey)
    } catch (error) {
      console.error('[Exa IPC] Connection error:', error)
      const message = error instanceof Error ? error.message : 'Failed to connect to Search and Datasets'
      throw new Error(message)
    }
  })

  /**
   * Disconnect from Exa
   */
  ipcMain.handle('exa:disconnect', async (): Promise<void> => {
    await exaService.disconnect()
  })

  /**
   * Get current connection status
   */
  ipcMain.handle('exa:getStatus', async (): Promise<ExaConnectionStatus> => {
    return exaService.getConnectionStatus()
  })

  /**
   * Check if Exa is connected
   */
  ipcMain.handle('exa:isConnected', (): boolean => {
    return exaService.isConnected()
  })

  // ============= EVENT SUBSCRIPTIONS =============
  // These set up listeners that forward events to the renderer

  // Track active subscription for cleanup
  let connectionCleanup: (() => void) | null = null

  /**
   * Subscribe to connection change events
   * The renderer will receive 'exa:connectionChange' events
   */
  ipcMain.handle('exa:subscribeConnection', (_event): void => {
    // Clean up existing subscription
    if (connectionCleanup) {
      connectionCleanup()
    }

    connectionCleanup = exaService.onConnectionChange((status: ExaConnectionStatus) => {
      // Send to all renderer windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('exa:connectionChange', status)
      })
    })
  })

  /**
   * Unsubscribe from connection change events
   */
  ipcMain.handle('exa:unsubscribeConnection', (): void => {
    if (connectionCleanup) {
      connectionCleanup()
      connectionCleanup = null
    }
  })

  // ============= TOOLS INFO =============

  /**
   * Get Exa tool info for the UI
   * Returns tool metadata that can be displayed in the Tools tab
   */
  ipcMain.handle('exa:getTools', (): ExaToolInfo[] => {
    return getExaToolInfo()
  })
}
