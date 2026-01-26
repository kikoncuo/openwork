/**
 * WhatsApp Adapter Tests
 * Run with: npx tsx src/services/apps/__tests__/whatsapp-adapter.test.ts
 */

import assert from 'node:assert'
import type { HealthStatus } from '../types.js'

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

// Health check thresholds (must match whatsapp-adapter.ts)
const ACTIVITY_WARNING_THRESHOLD_MS = 30 * 60 * 1000  // 30 minutes
const ACTIVITY_CRITICAL_THRESHOLD_MS = 2 * 60 * 60 * 1000  // 2 hours

// Mock socket manager for testing
class MockSocketManager {
  private connectedUsers: Set<string> = new Set()
  private phoneOnlineStatus: Map<string, boolean> = new Map()
  private lastActivityTimes: Map<string, number> = new Map()
  private connectionStatuses: Map<string, any> = new Map()

  // Simulated methods matching socket-manager interface
  async connect(userId: string) {
    this.connectedUsers.add(userId)
    this.phoneOnlineStatus.set(userId, true)
    this.lastActivityTimes.set(userId, Date.now())
    this.connectionStatuses.set(userId, {
      connected: true,
      connecting: false,
      phoneNumber: '+1234567890',
      connectedAt: new Date()
    })
  }

  async disconnect(userId: string) {
    this.connectedUsers.delete(userId)
    this.phoneOnlineStatus.delete(userId)
    this.lastActivityTimes.delete(userId)
    this.connectionStatuses.delete(userId)
  }

  isConnected(userId: string): boolean {
    return this.connectedUsers.has(userId)
  }

  isPhoneOnline(userId: string): boolean | undefined {
    return this.phoneOnlineStatus.get(userId)
  }

  getLastActivityTime(userId: string): number | undefined {
    return this.lastActivityTimes.get(userId)
  }

  getConnectionStatus(userId: string) {
    return this.connectionStatuses.get(userId) || {
      connected: false,
      connecting: false
    }
  }

  // Test helpers
  setPhoneOnline(userId: string, online: boolean) {
    this.phoneOnlineStatus.set(userId, online)
  }

  setLastActivityTime(userId: string, time: number) {
    this.lastActivityTimes.set(userId, time)
  }

  setConnecting(userId: string, connecting: boolean) {
    const status = this.connectionStatuses.get(userId) || {}
    this.connectionStatuses.set(userId, { ...status, connecting })
  }

  reset() {
    this.connectedUsers.clear()
    this.phoneOnlineStatus.clear()
    this.lastActivityTimes.clear()
    this.connectionStatuses.clear()
  }
}

// Testable WhatsApp adapter (mirrors the real one but uses mock)
class TestableWhatsAppAdapter {
  readonly appType = 'whatsapp' as const
  readonly displayName = 'WhatsApp'
  readonly description = 'Connect your WhatsApp account'

  private socketManager: MockSocketManager

  constructor(socketManager: MockSocketManager) {
    this.socketManager = socketManager
  }

  async connect(userId: string): Promise<void> {
    await this.socketManager.connect(userId)
  }

  async disconnect(userId: string): Promise<void> {
    await this.socketManager.disconnect(userId)
  }

  async healthCheck(userId: string) {
    // Not connected
    if (!this.isConnected(userId)) {
      return {
        healthy: false,
        status: 'critical' as HealthStatus,
        warningMessage: 'Not connected to WhatsApp'
      }
    }

    const healthIndicators: string[] = []
    let overallStatus: HealthStatus = 'healthy'

    // Check phone online status
    const phoneOnline = this.socketManager.isPhoneOnline(userId)
    if (phoneOnline === false) {
      healthIndicators.push('Phone appears offline')
      overallStatus = this.degradeStatus(overallStatus, 'warning')
    }

    // Check last activity time
    const lastActivity = this.socketManager.getLastActivityTime(userId)
    if (lastActivity) {
      const timeSinceActivity = Date.now() - lastActivity

      if (timeSinceActivity > ACTIVITY_CRITICAL_THRESHOLD_MS) {
        healthIndicators.push('No activity for over 2 hours')
        overallStatus = this.degradeStatus(overallStatus, 'critical')
      } else if (timeSinceActivity > ACTIVITY_WARNING_THRESHOLD_MS) {
        healthIndicators.push('No recent activity')
        overallStatus = this.degradeStatus(overallStatus, 'warning')
      }
    }

    // Check connection status
    const status = this.socketManager.getConnectionStatus(userId)
    if (status.connecting) {
      healthIndicators.push('Connection in progress')
      overallStatus = this.degradeStatus(overallStatus, 'warning')
    }

    const healthy = overallStatus === 'healthy'
    const warningMessage = healthIndicators.length > 0
      ? healthIndicators.join('. ')
      : undefined

    return {
      healthy,
      status: overallStatus,
      warningMessage,
      details: {
        phoneOnline,
        lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
        connectionStatus: status
      }
    }
  }

  isConnected(userId: string): boolean {
    return this.socketManager.isConnected(userId)
  }

  getConnectionInfo(userId: string): Record<string, unknown> | null {
    const status = this.socketManager.getConnectionStatus(userId)
    if (!status.connected) return null
    return {
      phoneNumber: status.phoneNumber,
      connectedAt: status.connectedAt instanceof Date
        ? status.connectedAt.toISOString()
        : status.connectedAt
    }
  }

  private degradeStatus(current: HealthStatus, target: HealthStatus): HealthStatus {
    const statusOrder: HealthStatus[] = ['healthy', 'unknown', 'warning', 'critical']
    const currentIndex = statusOrder.indexOf(current)
    const targetIndex = statusOrder.indexOf(target)
    return targetIndex > currentIndex ? target : current
  }
}

// Tests
async function runTests() {
  const socketManager = new MockSocketManager()
  const adapter = new TestableWhatsAppAdapter(socketManager)

  await describe('WhatsAppAdapter', async () => {
    await describe('Connection Lifecycle', async () => {
      await it('connects successfully', async () => {
        await adapter.connect('user-1')
        assert(adapter.isConnected('user-1'), 'Should be connected')
      })

      await it('disconnects successfully', async () => {
        await adapter.connect('user-2')
        await adapter.disconnect('user-2')
        assert(!adapter.isConnected('user-2'), 'Should be disconnected')
      })

      await it('returns connection info when connected', async () => {
        await adapter.connect('user-3')
        const info = adapter.getConnectionInfo('user-3')
        assert(info !== null, 'Should have connection info')
        assert(info.phoneNumber === '+1234567890', 'Should have phone number')
        assert(info.connectedAt !== undefined, 'Should have connected time')
      })

      await it('returns null connection info when disconnected', async () => {
        const info = adapter.getConnectionInfo('nonexistent-user')
        assert(info === null, 'Should return null for disconnected user')
      })
    })

    await describe('Health Check - Not Connected', async () => {
      await it('returns critical when not connected', async () => {
        const result = await adapter.healthCheck('nonexistent-user')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.status === 'critical', 'Status should be critical')
        assert(result.warningMessage === 'Not connected to WhatsApp', 'Should have warning message')
      })
    })

    await describe('Health Check - Phone Status', async () => {
      await it('returns healthy when phone is online', async () => {
        socketManager.reset()
        await adapter.connect('user-phone-1')
        socketManager.setPhoneOnline('user-phone-1', true)

        const result = await adapter.healthCheck('user-phone-1')
        assert(result.healthy === true, 'Should be healthy')
        assert(result.status === 'healthy', 'Status should be healthy')
      })

      await it('returns warning when phone is offline', async () => {
        socketManager.reset()
        await adapter.connect('user-phone-2')
        socketManager.setPhoneOnline('user-phone-2', false)

        const result = await adapter.healthCheck('user-phone-2')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.status === 'warning', 'Status should be warning')
        assert(result.warningMessage?.includes('Phone appears offline'), 'Should mention phone offline')
      })
    })

    await describe('Health Check - Activity Time', async () => {
      await it('returns healthy with recent activity', async () => {
        socketManager.reset()
        await adapter.connect('user-activity-1')
        socketManager.setLastActivityTime('user-activity-1', Date.now())

        const result = await adapter.healthCheck('user-activity-1')
        assert(result.healthy === true, 'Should be healthy')
        assert(result.status === 'healthy', 'Status should be healthy')
      })

      await it('returns warning with stale activity (30+ minutes)', async () => {
        socketManager.reset()
        await adapter.connect('user-activity-2')
        const staleTime = Date.now() - (31 * 60 * 1000) // 31 minutes ago
        socketManager.setLastActivityTime('user-activity-2', staleTime)

        const result = await adapter.healthCheck('user-activity-2')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.status === 'warning', 'Status should be warning')
        assert(result.warningMessage?.includes('No recent activity'), 'Should mention no recent activity')
      })

      await it('returns critical with very stale activity (2+ hours)', async () => {
        socketManager.reset()
        await adapter.connect('user-activity-3')
        const veryStaleTime = Date.now() - (3 * 60 * 60 * 1000) // 3 hours ago
        socketManager.setLastActivityTime('user-activity-3', veryStaleTime)

        const result = await adapter.healthCheck('user-activity-3')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.status === 'critical', 'Status should be critical')
        assert(result.warningMessage?.includes('No activity for over 2 hours'), 'Should mention no activity for 2 hours')
      })
    })

    await describe('Health Check - Connection Status', async () => {
      await it('returns warning when connecting', async () => {
        socketManager.reset()
        await adapter.connect('user-connecting-1')
        socketManager.setConnecting('user-connecting-1', true)

        const result = await adapter.healthCheck('user-connecting-1')
        assert(result.status === 'warning', 'Status should be warning')
        assert(result.warningMessage?.includes('Connection in progress'), 'Should mention connection in progress')
      })
    })

    await describe('Health Check - Multiple Issues', async () => {
      await it('combines multiple warning messages', async () => {
        socketManager.reset()
        await adapter.connect('user-multi-1')
        socketManager.setPhoneOnline('user-multi-1', false)
        const staleTime = Date.now() - (31 * 60 * 1000)
        socketManager.setLastActivityTime('user-multi-1', staleTime)

        const result = await adapter.healthCheck('user-multi-1')
        assert(result.healthy === false, 'Should not be healthy')
        assert(result.warningMessage?.includes('Phone appears offline'), 'Should mention phone offline')
        assert(result.warningMessage?.includes('No recent activity'), 'Should mention no recent activity')
      })

      await it('escalates to worst status', async () => {
        socketManager.reset()
        await adapter.connect('user-multi-2')
        socketManager.setPhoneOnline('user-multi-2', false) // warning
        const veryStaleTime = Date.now() - (3 * 60 * 60 * 1000)
        socketManager.setLastActivityTime('user-multi-2', veryStaleTime) // critical

        const result = await adapter.healthCheck('user-multi-2')
        // Should be critical (worst of warning and critical)
        assert(result.status === 'critical', 'Status should be critical (worst status wins)')
      })
    })

    await describe('Health Check - Details', async () => {
      await it('includes details in health check result', async () => {
        socketManager.reset()
        await adapter.connect('user-details-1')

        const result = await adapter.healthCheck('user-details-1')
        assert(result.details !== undefined, 'Should have details')
        assert(result.details.phoneOnline !== undefined, 'Should have phoneOnline')
        assert(result.details.lastActivity !== undefined, 'Should have lastActivity')
        assert(result.details.connectionStatus !== undefined, 'Should have connectionStatus')
      })
    })
  })

  // Summary
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Tests: ${testCount} | Passed: ${passCount} | Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(console.error)
