/**
 * Connection Manager Tests
 * Run with: npx tsx src/services/apps/__tests__/connection-manager.test.ts
 */

import assert from 'node:assert'
import type { AppAdapter, HealthCheckResult, HealthStatus } from '../types.js'

// Simple test framework with proper async handling
let testCount = 0
let passCount = 0
let failCount = 0

async function describe(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`)
  await fn()
}

async function it(name: string, fn: () => void | Promise<void>) {
  testCount++
  try {
    await fn()
    passCount++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failCount++
    console.log(`  ✗ ${name}`)
    console.log(`    Error: ${(error as Error).message}`)
  }
}

// Mock database for testing
class MockDatabase {
  private connections: Map<string, any> = new Map()
  private events: any[] = []

  clear() {
    this.connections.clear()
    this.events = []
  }

  async getConnection(userId: string, appType: string) {
    return this.connections.get(`${userId}:${appType}`) || null
  }

  async upsertConnection(connection: any) {
    const key = `${connection.userId}:${connection.appType}`
    this.connections.set(key, connection)
  }

  async getAllConnections(userId: string) {
    return Array.from(this.connections.values()).filter(c => c.userId === userId)
  }

  async deleteConnection(userId: string, appType: string) {
    this.connections.delete(`${userId}:${appType}`)
  }

  async insertHealthEvent(event: any) {
    this.events.push(event)
  }

  async getHealthEvents(userId: string, appType: string, limit: number) {
    return this.events
      .filter(e => e.userId === userId && e.appType === appType)
      .slice(0, limit)
  }
}

// Mock adapter for testing
class MockAdapter implements AppAdapter {
  readonly appType = 'mock' as const
  readonly displayName = 'Mock App'
  readonly description = 'A mock app for testing'

  private connectedUsers: Set<string> = new Set()
  private healthResults: Map<string, HealthCheckResult> = new Map()

  async connect(userId: string): Promise<void> {
    this.connectedUsers.add(userId)
  }

  async disconnect(userId: string): Promise<void> {
    this.connectedUsers.delete(userId)
  }

  async healthCheck(userId: string): Promise<HealthCheckResult> {
    return this.healthResults.get(userId) || { healthy: true, status: 'healthy' }
  }

  isConnected(userId: string): boolean {
    return this.connectedUsers.has(userId)
  }

  getConnectionInfo(userId: string): Record<string, unknown> | null {
    if (!this.isConnected(userId)) return null
    return { username: 'test-user' }
  }

  // Test helpers
  setHealthResult(userId: string, result: HealthCheckResult) {
    this.healthResults.set(userId, result)
  }

  reset() {
    this.connectedUsers.clear()
    this.healthResults.clear()
  }
}

// Simplified connection manager for testing
class TestableConnectionManager {
  private adapters: Map<string, AppAdapter> = new Map()
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map()
  private db: MockDatabase

  constructor(db: MockDatabase) {
    this.db = db
  }

  registerAdapter(adapter: AppAdapter) {
    this.adapters.set(adapter.appType, adapter)
  }

  getAdapter(appType: string): AppAdapter | undefined {
    return this.adapters.get(appType)
  }

  getRegisteredApps() {
    return Array.from(this.adapters.values()).map(a => ({
      appType: a.appType,
      displayName: a.displayName,
      description: a.description
    }))
  }

  async connect(userId: string, appType: string) {
    const adapter = this.adapters.get(appType)
    if (!adapter) throw new Error(`Unknown app type: ${appType}`)

    await adapter.connect(userId)

    await this.db.upsertConnection({
      id: `conn-${Date.now()}`,
      userId,
      appType,
      status: 'connected',
      healthStatus: 'healthy',
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }

  async disconnect(userId: string, appType: string) {
    const adapter = this.adapters.get(appType)
    if (!adapter) throw new Error(`Unknown app type: ${appType}`)

    await adapter.disconnect(userId)
    await this.db.deleteConnection(userId, appType)
    this.stopHealthMonitoring(userId, appType)
  }

  async performHealthCheck(userId: string, appType: string): Promise<HealthCheckResult> {
    const adapter = this.adapters.get(appType)
    if (!adapter) throw new Error(`Unknown app type: ${appType}`)

    const result = await adapter.healthCheck(userId)

    // Update connection status
    const connection = await this.db.getConnection(userId, appType)
    if (connection) {
      await this.db.upsertConnection({
        ...connection,
        healthStatus: result.status,
        warningMessage: result.warningMessage,
        lastHealthCheckAt: new Date(),
        updatedAt: new Date()
      })
    }

    // Log health event
    await this.db.insertHealthEvent({
      id: `evt-${Date.now()}`,
      userId,
      appType,
      eventType: 'health_check',
      details: result,
      createdAt: new Date()
    })

    return result
  }

  startHealthMonitoring(userId: string, appType: string, intervalMs = 5000) {
    const key = `${userId}:${appType}`
    this.stopHealthMonitoring(userId, appType)

    const interval = setInterval(async () => {
      try {
        await this.performHealthCheck(userId, appType)
      } catch (error) {
        console.error(`Health check failed: ${error}`)
      }
    }, intervalMs)

    this.healthCheckIntervals.set(key, interval)
  }

  stopHealthMonitoring(userId: string, appType: string) {
    const key = `${userId}:${appType}`
    const interval = this.healthCheckIntervals.get(key)
    if (interval) {
      clearInterval(interval)
      this.healthCheckIntervals.delete(key)
    }
  }

  async getConnection(userId: string, appType: string) {
    return this.db.getConnection(userId, appType)
  }

  async getAllConnections(userId: string) {
    return this.db.getAllConnections(userId)
  }

  cleanup() {
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval)
    }
    this.healthCheckIntervals.clear()
  }
}

// Tests
async function runTests() {
  const db = new MockDatabase()
  const manager = new TestableConnectionManager(db)
  const mockAdapter = new MockAdapter()

  // Setup
  manager.registerAdapter(mockAdapter)

  await describe('AppConnectionManager', async () => {
    await describe('Adapter Registration', async () => {
      await it('registers and retrieves adapters', async () => {
        const adapter = manager.getAdapter('mock')
        assert(adapter !== undefined, 'Adapter should be registered')
        assert(adapter.appType === 'mock', 'Adapter type should match')
      })

      await it('returns undefined for unknown adapters', async () => {
        const adapter = manager.getAdapter('unknown')
        assert(adapter === undefined, 'Should return undefined for unknown adapter')
      })

      await it('lists registered apps', async () => {
        const apps = manager.getRegisteredApps()
        assert(apps.length === 1, 'Should have one registered app')
        assert(apps[0].appType === 'mock', 'Should list mock app')
      })
    })

    await describe('Connection Lifecycle', async () => {
      await it('connects to an app', async () => {
        await manager.connect('user-1', 'mock')

        assert(mockAdapter.isConnected('user-1'), 'Adapter should show connected')

        const connection = await manager.getConnection('user-1', 'mock')
        assert(connection !== null, 'Connection should exist in database')
        assert(connection.status === 'connected', 'Status should be connected')
      })

      await it('disconnects from an app', async () => {
        await manager.connect('user-2', 'mock')
        await manager.disconnect('user-2', 'mock')

        assert(!mockAdapter.isConnected('user-2'), 'Adapter should show disconnected')

        const connection = await manager.getConnection('user-2', 'mock')
        assert(connection === null, 'Connection should be removed from database')
      })

      await it('throws error for unknown app type', async () => {
        let threw = false
        try {
          await manager.connect('user-3', 'unknown')
        } catch {
          threw = true
        }
        assert(threw, 'Should throw error for unknown app type')
      })
    })

    await describe('Health Checks', async () => {
      await it('performs health check and returns result', async () => {
        await manager.connect('user-4', 'mock')

        const result = await manager.performHealthCheck('user-4', 'mock')
        assert(result.healthy === true, 'Should be healthy')
        assert(result.status === 'healthy', 'Status should be healthy')
      })

      await it('updates connection status on health check', async () => {
        await manager.connect('user-5', 'mock')
        mockAdapter.setHealthResult('user-5', {
          healthy: false,
          status: 'warning',
          warningMessage: 'Test warning'
        })

        await manager.performHealthCheck('user-5', 'mock')

        const connection = await manager.getConnection('user-5', 'mock')
        assert(connection.healthStatus === 'warning', 'Health status should be warning')
        assert(connection.warningMessage === 'Test warning', 'Warning message should be set')
      })

      await it('handles critical health status', async () => {
        await manager.connect('user-6', 'mock')
        mockAdapter.setHealthResult('user-6', {
          healthy: false,
          status: 'critical',
          warningMessage: 'Connection lost'
        })

        const result = await manager.performHealthCheck('user-6', 'mock')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.status === 'critical', 'Status should be critical')
      })
    })

    await describe('Health Monitoring', async () => {
      await it('starts and stops health monitoring', async () => {
        await manager.connect('user-7', 'mock')

        // Start monitoring with short interval for testing
        manager.startHealthMonitoring('user-7', 'mock', 100)

        // Wait for at least one health check
        await new Promise(resolve => setTimeout(resolve, 150))

        const connection = await manager.getConnection('user-7', 'mock')
        assert(connection.lastHealthCheckAt !== undefined, 'Should have performed health check')

        // Stop monitoring
        manager.stopHealthMonitoring('user-7', 'mock')
      })
    })

    await describe('Multiple Connections', async () => {
      await it('handles multiple users', async () => {
        await manager.connect('user-a', 'mock')
        await manager.connect('user-b', 'mock')

        assert(mockAdapter.isConnected('user-a'), 'User A should be connected')
        assert(mockAdapter.isConnected('user-b'), 'User B should be connected')

        await manager.disconnect('user-a', 'mock')

        assert(!mockAdapter.isConnected('user-a'), 'User A should be disconnected')
        assert(mockAdapter.isConnected('user-b'), 'User B should still be connected')
      })
    })
  })

  // Cleanup
  manager.cleanup()

  // Summary
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Tests: ${testCount} | Passed: ${passCount} | Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(console.error)
