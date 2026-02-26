/**
 * Real API Tests for Exa Service
 * These tests make actual API calls to validate the integration
 * Run with: npx tsx src/main/apps/exa/__tests__/api.test.ts
 */

import { existsSync, readFileSync } from 'fs'

// Test utilities
let testsPassed = 0
let testsFailed = 0

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    testsPassed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    Error: ${(err as Error).message}`)
    testsFailed++
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

// ==================== Real API Tests ====================
console.log('\n🌐 Testing Exa API (Real Calls)...\n')

import { exaService } from '../index'
import { getApiKey } from '../../../storage'

async function runTests(): Promise<void> {
  // Check if API key is available
  const apiKey = getApiKey('exa')
  if (!apiKey) {
    console.log('⚠️  No EXA_API_KEY found. Skipping real API tests.')
    console.log('   Add your API key to ~/.openwork/.env as EXA_API_KEY=your-key')
    return
  }

  console.log('✓ API key found\n')

  // Test: Connect to Exa
  await test('Connect to Exa API', async () => {
    await exaService.connect(apiKey)
    assertTrue(exaService.isConnected(), 'Should be connected after connect()')
  })

  // Test: Connection status
  await test('Connection status is correct', async () => {
    const status = await exaService.getConnectionStatus()
    assertEqual(status.connected, true)
    assertEqual(status.apiKeyConfigured, true)
  })

  // Test: Web search
  await test('Web search returns results', async () => {
    const results = await exaService.search({
      query: 'artificial intelligence startups 2024',
      numResults: 5,
      useHighlights: true
    })

    assertTrue(results.length > 0, 'Should return at least 1 result')
    assertTrue(results.length <= 5, 'Should return at most 5 results')

    // Verify result structure
    const firstResult = results[0]
    assertTrue(typeof firstResult.url === 'string', 'Result should have url')
    assertTrue(typeof firstResult.title === 'string', 'Result should have title')

    console.log(`    Found ${results.length} results`)
    console.log(`    First result: ${firstResult.title}`)
  })

  // Test: Web search with category filter
  await test('Web search with category filter works', async () => {
    const results = await exaService.search({
      query: 'machine learning research',
      category: 'research paper',
      numResults: 3
    })

    assertTrue(results.length > 0, 'Should return at least 1 result')
    console.log(`    Found ${results.length} research papers`)
  })

  // Test: Web search with domain filter
  await test('Web search with domain filter works', async () => {
    const results = await exaService.search({
      query: 'technology news',
      numResults: 3,
      includeDomains: ['techcrunch.com', 'theverge.com', 'wired.com']
    })

    // Results should only be from specified domains
    for (const result of results) {
      const url = new URL(result.url)
      const domain = url.hostname.replace('www.', '')
      assertTrue(
        ['techcrunch.com', 'theverge.com', 'wired.com'].includes(domain),
        `Result domain ${domain} should be in filter list`
      )
    }

    console.log(`    Found ${results.length} results from filtered domains`)
  })

  // Test: Create dataset (webset)
  let datasetId: string | null = null

  await test('Create dataset returns valid info', async () => {
    try {
      const info = await exaService.createDataset({
        query: 'AI companies in San Francisco founded after 2020',
        count: 5
      })

      assertTrue(typeof info.id === 'string', 'Should return dataset ID')
      assertTrue(info.id.length > 0, 'Dataset ID should not be empty')
      assertEqual(info.query, 'AI companies in San Francisco founded after 2020')

      datasetId = info.id
      console.log(`    Created dataset with ID: ${info.id}`)
      console.log(`    Status: ${info.status}`)
    } catch (err) {
      // Websets API might not be available on all plans
      const message = (err as Error).message
      if (message.includes('403') || message.includes('not available') || message.includes('upgrade')) {
        console.log(`    ⚠️  Websets API not available (may require paid plan)`)
        console.log(`    Skipping dataset tests...`)
      } else {
        throw err
      }
    }
  })

  // Only run dataset tests if creation succeeded
  if (datasetId) {
    await test('Wait for dataset completion', async () => {
      const info = await exaService.waitForDataset(datasetId!, 60000) // 1 minute timeout for test

      console.log(`    Dataset status: ${info.status}`)
      console.log(`    Item count: ${info.count}`)
    })

    await test('Get dataset items', async () => {
      const items = await exaService.getDatasetItems(datasetId!)

      console.log(`    Retrieved ${items.length} items`)

      if (items.length > 0) {
        const firstItem = items[0]
        assertTrue(typeof firstItem.url === 'string', 'Item should have url')
        console.log(`    First item: ${firstItem.title || firstItem.url}`)
      }
    })

    await test('Export dataset to CSV', async () => {
      const csvPath = await exaService.exportDatasetAsCSV(datasetId!)

      assertTrue(existsSync(csvPath), 'CSV file should exist')

      const content = readFileSync(csvPath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())

      console.log(`    Exported to: ${csvPath}`)
      console.log(`    CSV has ${lines.length} lines (including header)`)
    })
  }

  // Test: Disconnect
  await test('Disconnect from Exa API', async () => {
    await exaService.disconnect()
    assertEqual(exaService.isConnected(), false)
  })

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log(`\n📊 API Test Results: ${testsPassed} passed, ${testsFailed} failed\n`)
}

// Run tests
runTests().catch(console.error)
