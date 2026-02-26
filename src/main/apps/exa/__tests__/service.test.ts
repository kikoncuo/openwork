/**
 * Integration Tests for Exa Service
 * Tests service functionality without requiring an API key
 * Run with: npx tsx src/main/apps/exa/__tests__/service.test.ts
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, rmSync } from 'fs'

// Test utilities
let testsPassed = 0
let testsFailed = 0

function test(name: string, fn: () => void | Promise<void>): void {
  const result = fn()
  if (result instanceof Promise) {
    result
      .then(() => {
        console.log(`  ✓ ${name}`)
        testsPassed++
      })
      .catch((err) => {
        console.error(`  ✗ ${name}`)
        console.error(`    Error: ${err.message}`)
        testsFailed++
      })
  } else {
    console.log(`  ✓ ${name}`)
    testsPassed++
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`)
  }
}

function assertTrue(value: boolean, message?: string): void {
  if (!value) {
    throw new Error(message || 'Expected true, got false')
  }
}

function assertThrows(fn: () => void | Promise<void>, expectedMessage?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const result = fn()
      if (result instanceof Promise) {
        result
          .then(() => {
            reject(new Error('Expected function to throw, but it did not'))
          })
          .catch((err) => {
            if (expectedMessage && !err.message.includes(expectedMessage)) {
              reject(new Error(`Expected error message to contain "${expectedMessage}", got "${err.message}"`))
            } else {
              resolve()
            }
          })
      } else {
        reject(new Error('Expected function to throw, but it did not'))
      }
    } catch (err) {
      if (expectedMessage && !(err as Error).message.includes(expectedMessage)) {
        reject(new Error(`Expected error message to contain "${expectedMessage}", got "${(err as Error).message}"`))
      } else {
        resolve()
      }
    }
  })
}

// ==================== ExaService Tests ====================
console.log('\n🔌 Testing ExaService...\n')

import { exaService } from '../index'

test('ExaService starts disconnected', () => {
  assertEqual(exaService.isConnected(), false)
})

test('ExaService getConnectionStatus returns correct status when disconnected', async () => {
  const status = await exaService.getConnectionStatus()
  assertEqual(status.connected, false)
  // apiKeyConfigured depends on whether EXA_API_KEY is set
  assertTrue(typeof status.apiKeyConfigured === 'boolean')
})

test('ExaService search throws when not connected', async () => {
  await assertThrows(
    () => exaService.search({ query: 'test' }),
    'not connected'
  )
})

test('ExaService createDataset throws when not connected', async () => {
  await assertThrows(
    () => exaService.createDataset({ query: 'test' }),
    'not connected'
  )
})

test('ExaService waitForDataset throws when not connected', async () => {
  await assertThrows(
    () => exaService.waitForDataset('fake-id'),
    'not connected'
  )
})

test('ExaService getDatasetItems throws when not connected', async () => {
  await assertThrows(
    () => exaService.getDatasetItems('fake-id'),
    'not connected'
  )
})

test('ExaService enrichDataset throws when not connected', async () => {
  await assertThrows(
    () => exaService.enrichDataset('fake-id', [{ description: 'test', format: 'text' }]),
    'not connected'
  )
})

test('ExaService connect throws without API key', async () => {
  await assertThrows(
    () => exaService.connect(),
    'No API key'
  )
})

test('ExaService onConnectionChange registers callback', () => {
  let callbackCalled = false
  const cleanup = exaService.onConnectionChange(() => {
    callbackCalled = true
  })

  // Cleanup should be a function
  assertTrue(typeof cleanup === 'function')

  // Clean up the callback
  cleanup()
})

test('ExaService disconnect works even when not connected', async () => {
  // Should not throw
  await exaService.disconnect()
  assertEqual(exaService.isConnected(), false)
})

test('ExaService shutdown works correctly', async () => {
  await exaService.shutdown()
  assertEqual(exaService.isConnected(), false)
})

// ==================== Dataset Store Integration ====================
console.log('\n💾 Testing Dataset Store Integration...\n')

import { storeDataset, getDataset, exportToCSV, getDatasetsDir } from '../dataset-store'
import type { DatasetInfo, DatasetItem } from '../types'

test('Full dataset workflow: store, update, export', () => {
  // Create dataset info
  const info: DatasetInfo = {
    id: 'integration-test-dataset',
    query: 'Full integration test query',
    status: 'idle',
    count: 3,
    createdAt: new Date().toISOString()
  }

  // Store
  storeDataset(info)

  // Verify stored
  const stored = getDataset('integration-test-dataset')
  assertEqual(stored?.id, 'integration-test-dataset')

  // Create items
  const items: DatasetItem[] = [
    {
      url: 'https://integration1.com',
      title: 'Integration Test Company 1',
      text: 'First company in integration test',
      ceo_name: 'Integration CEO 1',
      employee_count: 100
    },
    {
      url: 'https://integration2.com',
      title: 'Integration Test Company 2',
      text: 'Second company in integration test',
      ceo_name: 'Integration CEO 2',
      employee_count: 250
    },
    {
      url: 'https://integration3.com',
      title: 'Integration Test Company 3',
      text: 'Third company in integration test',
      ceo_name: 'Integration CEO 3',
      employee_count: 500
    }
  ]

  // Export to CSV
  const csvPath = exportToCSV(info.query, items)

  // Verify CSV exists
  assertTrue(existsSync(csvPath), 'CSV file should exist')

  // Read and verify content
  const content = readFileSync(csvPath, 'utf-8')
  const lines = content.split('\n')

  // Verify header
  const header = lines[0]
  assertTrue(header.includes('url'), 'Header should include url')
  assertTrue(header.includes('title'), 'Header should include title')
  assertTrue(header.includes('enrichment_ceo_name'), 'Header should include enrichment_ceo_name')
  assertTrue(header.includes('enrichment_employee_count'), 'Header should include enrichment_employee_count')

  // Verify data rows (header + 3 data rows)
  assertEqual(lines.filter(l => l.trim()).length, 4, 'Should have 4 rows (1 header + 3 data)')

  // Verify specific data
  assertTrue(content.includes('Integration Test Company 1'), 'Should include company 1')
  assertTrue(content.includes('Integration CEO 1'), 'Should include CEO 1')
  assertTrue(content.includes('100'), 'Should include employee count 100')

  console.log(`    Integration test CSV created at: ${csvPath}`)
})

test('Dataset directory is in expected location', () => {
  const dir = getDatasetsDir()
  const expectedDir = join(homedir(), '.openwork', 'datasets')
  assertEqual(dir, expectedDir)
})

// ==================== Summary ====================
setTimeout(() => {
  console.log('\n' + '='.repeat(50))
  console.log(`\n📊 Service Test Results: ${testsPassed} passed, ${testsFailed} failed\n`)

  if (testsFailed > 0) {
    process.exit(1)
  }
}, 500)
