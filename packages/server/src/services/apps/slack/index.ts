/**
 * Slack Service - Per-user WebClient connections
 * Server-side implementation using @slack/web-api SDK
 */

import { WebClient } from '@slack/web-api'
import type { SlackConnectionStatus } from './types.js'
import { getSlackAuthStore } from './auth-store.js'

type ConnectionCallback = (status: SlackConnectionStatus) => void

interface UserConnection {
  client: WebClient
  callbacks: Set<ConnectionCallback>
}

class SlackService {
  private connections = new Map<string, UserConnection>()
  private initialized = false

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    console.log('[Slack] Initializing service...')
    this.initialized = true
    console.log('[Slack] Service initialized')
  }

  /**
   * Connect to Slack API for a user
   */
  async connect(userId: string, token: string, teamId: string): Promise<void> {
    await this.initialize()

    // Disconnect existing connection if any
    if (this.connections.has(userId)) {
      await this.disconnect(userId)
    }

    const client = new WebClient(token, { teamId })

    // Verify connection
    const authResult = await client.auth.test()
    console.log(`[Slack] Connected for user ${userId} as ${authResult.user} in team ${authResult.team}`)

    // Persist credentials to DB for session restore
    const authStore = getSlackAuthStore()
    await authStore.saveCredentials(userId, token, teamId)

    const existing = this.connections.get(userId)
    this.connections.set(userId, {
      client,
      callbacks: existing?.callbacks || new Set()
    })

    await this.notifyConnectionChange(userId)
  }

  /**
   * Disconnect from Slack API for a user
   */
  async disconnect(userId: string): Promise<void> {
    // Clear persisted credentials
    const authStore = getSlackAuthStore()
    await authStore.clearCredentials(userId)

    this.connections.delete(userId)
    await this.notifyConnectionChange(userId)
    console.log(`[Slack] Disconnected user ${userId}`)
  }

  /**
   * Check if user is connected
   */
  isConnected(userId: string): boolean {
    const connection = this.connections.get(userId)
    return connection?.client != null
  }

  /**
   * Restore session from stored credentials
   */
  private async restoreSession(userId: string): Promise<boolean> {
    console.log(`[Slack] Attempting to restore session for user ${userId}`)
    try {
      const authStore = getSlackAuthStore()
      const creds = await authStore.getCredentials(userId)

      if (!creds) {
        return false
      }

      const client = new WebClient(creds.token, { teamId: creds.teamId })

      // Verify the token is still valid
      try {
        await client.auth.test()
      } catch (testError) {
        console.warn(`[Slack] Stored token is no longer valid for user ${userId}:`, testError)
        await authStore.clearCredentials(userId)
        return false
      }

      // Store connection - preserve existing callbacks
      const existing = this.connections.get(userId)
      this.connections.set(userId, {
        client,
        callbacks: existing?.callbacks || new Set()
      })

      console.log(`[Slack] Session restored for user ${userId}`)
      return true
    } catch (error) {
      console.error(`[Slack] restoreSession error for user ${userId}:`, error)
      return false
    }
  }

  /**
   * Get connection status for a user
   * If not connected in memory, attempts to restore from stored credentials
   */
  async getConnectionStatus(userId: string): Promise<SlackConnectionStatus> {
    const connected = this.isConnected(userId)

    if (!connected) {
      try {
        const restored = await this.restoreSession(userId)
        if (!restored) {
          return { connected: false }
        }
      } catch (restoreError) {
        console.error('[Slack] Error restoring session:', restoreError)
        return { connected: false }
      }
    }

    return { connected: true }
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    let connection = this.connections.get(userId)
    if (!connection) {
      connection = { client: null as unknown as WebClient, callbacks: new Set() }
      this.connections.set(userId, connection)
    }
    connection.callbacks.add(callback)

    return () => {
      const conn = this.connections.get(userId)
      if (conn) {
        conn.callbacks.delete(callback)
      }
    }
  }

  /**
   * Notify connection change callbacks
   */
  private async notifyConnectionChange(userId: string): Promise<void> {
    const status = await this.getConnectionStatus(userId)
    const connection = this.connections.get(userId)
    if (connection) {
      for (const callback of connection.callbacks) {
        try {
          callback(status)
        } catch (error) {
          console.error('[Slack] Connection callback error:', error)
        }
      }
    }
  }

  /**
   * Get Slack WebClient for a user
   */
  getClient(userId: string): WebClient {
    const connection = this.connections.get(userId)
    if (!connection?.client) {
      throw new Error('Slack is not connected. Please connect in Settings > Apps.')
    }
    return connection.client
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.connections.clear()
    this.initialized = false
    console.log('[Slack] Service shutdown')
  }
}

// Singleton instance
export const slackService = new SlackService()
