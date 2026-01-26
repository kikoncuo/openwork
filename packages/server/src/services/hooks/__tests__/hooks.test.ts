/**
 * Hook System Tests
 * Run with: npx tsx packages/server/src/services/hooks/__tests__/hooks.test.ts
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3001'

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []
let authToken: string = ''
let testWebhookId: string = ''

// Helper to make API requests
async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

// Test helper
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    results.push({ name, passed: true })
    console.log(`  ✅ ${name}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, error: errorMsg })
    console.log(`  ❌ ${name}: ${errorMsg}`)
  }
}

// Assertion helpers
function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`)
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

function assertArrayLength(arr: unknown[], expected: number, message?: string): void {
  if (arr.length !== expected) {
    throw new Error(message || `Expected array length ${expected}, got ${arr.length}`)
  }
}

// ============================================
// Test Suites
// ============================================

async function setupAuth(): Promise<void> {
  console.log('\n🔐 Setting up authentication...')

  // Try to login first
  let response = await api('POST', '/api/auth/login', {
    email: 'hooktest@test.com',
    password: 'testpass123',
  })

  if (response.status !== 200) {
    // Register new user
    response = await api('POST', '/api/auth/register', {
      email: 'hooktest@test.com',
      password: 'testpass123',
      name: 'Hook Test User',
    })
  }

  const data = response.data as { accessToken?: string }
  if (!data?.accessToken) {
    throw new Error('Failed to authenticate')
  }

  authToken = data.accessToken
  console.log('  ✅ Authenticated successfully\n')
}

async function testHandlerListing(): Promise<void> {
  console.log('📋 Testing Handler Listing...')

  await test('GET /api/hooks returns handlers array', async () => {
    const { status, data } = await api('GET', '/api/hooks')
    assertEqual(status, 200)
    assertTrue(Array.isArray(data), 'Response should be an array')
  })

  await test('Built-in handlers are registered', async () => {
    const { data } = await api('GET', '/api/hooks')
    const handlers = data as Array<{ id: string; isBuiltin: boolean }>

    const builtinIds = handlers.filter(h => h.isBuiltin).map(h => h.id)
    assertTrue(builtinIds.includes('builtin:debug'), 'Debug handler should exist')
    assertTrue(builtinIds.includes('builtin:agent'), 'Agent handler should exist')
    assertTrue(builtinIds.includes('builtin:sender'), 'Sender handler should exist')
  })

  await test('Handlers have correct structure', async () => {
    const { data } = await api('GET', '/api/hooks')
    const handlers = data as Array<Record<string, unknown>>

    for (const handler of handlers) {
      assertTrue('id' in handler, 'Handler should have id')
      assertTrue('name' in handler, 'Handler should have name')
      assertTrue('eventTypes' in handler, 'Handler should have eventTypes')
      assertTrue('enabled' in handler, 'Handler should have enabled')
      assertTrue('priority' in handler, 'Handler should have priority')
    }
  })
}

async function testHandlerToggle(): Promise<void> {
  console.log('\n🔄 Testing Handler Toggle...')

  await test('Can enable debug handler', async () => {
    const { status, data } = await api('PATCH', '/api/hooks/builtin:debug', {
      enabled: true,
    })
    assertEqual(status, 200)
    assertEqual((data as { enabled: boolean }).enabled, true)
  })

  await test('Can disable debug handler', async () => {
    const { status, data } = await api('PATCH', '/api/hooks/builtin:debug', {
      enabled: false,
    })
    assertEqual(status, 200)
    assertEqual((data as { enabled: boolean }).enabled, false)
  })

  await test('Returns 404 for non-existent handler', async () => {
    const { status } = await api('PATCH', '/api/hooks/nonexistent:handler', {
      enabled: true,
    })
    assertEqual(status, 404)
  })
}

async function testEventEmission(): Promise<void> {
  console.log('\n📤 Testing Event Emission...')

  // Clear event log first
  await api('DELETE', '/api/hooks/events')

  await test('Can emit test event', async () => {
    const { status, data } = await api('POST', '/api/hooks/test', {
      eventType: 'message:received',
      source: 'test',
      payload: { testKey: 'testValue' },
    })
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
  })

  await test('Event appears in log', async () => {
    const { status, data } = await api('GET', '/api/hooks/events?limit=1')
    assertEqual(status, 200)

    const events = data as Array<{ type: string; source: string }>
    assertArrayLength(events, 1)
    assertEqual(events[0].type, 'message:received')
    assertEqual(events[0].source, 'test')
  })

  await test('Event has correct structure', async () => {
    const { data } = await api('GET', '/api/hooks/events?limit=1')
    const event = (data as Array<Record<string, unknown>>)[0]

    assertTrue('id' in event, 'Event should have id')
    assertTrue('type' in event, 'Event should have type')
    assertTrue('timestamp' in event, 'Event should have timestamp')
    assertTrue('source' in event, 'Event should have source')
    assertTrue('payload' in event, 'Event should have payload')
  })

  await test('Returns error for missing eventType', async () => {
    const { status } = await api('POST', '/api/hooks/test', {
      source: 'test',
    })
    assertEqual(status, 400)
  })
}

async function testEventLog(): Promise<void> {
  console.log('\n📜 Testing Event Log...')

  // Clear and add multiple events
  await api('DELETE', '/api/hooks/events')
  await api('POST', '/api/hooks/test', { eventType: 'message:received', source: 'test1' })
  await api('POST', '/api/hooks/test', { eventType: 'agent:response', source: 'test2' })
  await api('POST', '/api/hooks/test', { eventType: 'message:sent', source: 'test3' })

  await test('Can retrieve multiple events', async () => {
    const { status, data } = await api('GET', '/api/hooks/events')
    assertEqual(status, 200)
    assertTrue((data as unknown[]).length >= 3, 'Should have at least 3 events')
  })

  await test('Events are ordered most recent first', async () => {
    const { data } = await api('GET', '/api/hooks/events')
    const events = data as Array<{ timestamp: string }>

    for (let i = 0; i < events.length - 1; i++) {
      const current = new Date(events[i].timestamp).getTime()
      const next = new Date(events[i + 1].timestamp).getTime()
      assertTrue(current >= next, 'Events should be in reverse chronological order')
    }
  })

  await test('Limit parameter works', async () => {
    const { data } = await api('GET', '/api/hooks/events?limit=2')
    assertArrayLength(data as unknown[], 2)
  })

  await test('Can clear event log', async () => {
    const { status } = await api('DELETE', '/api/hooks/events')
    assertEqual(status, 200)

    const { data } = await api('GET', '/api/hooks/events')
    assertArrayLength(data as unknown[], 0)
  })
}

async function testWebhookCRUD(): Promise<void> {
  console.log('\n🔗 Testing Webhook CRUD...')

  await test('Can create webhook', async () => {
    const { status, data } = await api('POST', '/api/hooks/webhooks', {
      name: 'Test Webhook',
      url: 'https://example.com/webhook',
      eventTypes: ['message:received'],
      secret: 'testsecret',
    })
    assertEqual(status, 201)

    const webhook = data as { id: string; name: string; hasSecret: boolean }
    assertTrue(!!webhook.id, 'Webhook should have id')
    assertEqual(webhook.name, 'Test Webhook')
    assertEqual(webhook.hasSecret, true)

    testWebhookId = webhook.id
  })

  await test('Webhook is registered as handler', async () => {
    const { data } = await api('GET', '/api/hooks')
    const handlers = data as Array<{ id: string; isWebhook: boolean }>

    const webhookHandler = handlers.find(h => h.id === `webhook:${testWebhookId}`)
    assertTrue(!!webhookHandler, 'Webhook should be registered as handler')
    assertEqual(webhookHandler!.isWebhook, true)
  })

  await test('Can list webhooks', async () => {
    const { status, data } = await api('GET', '/api/hooks/webhooks')
    assertEqual(status, 200)

    const webhooks = data as Array<{ id: string }>
    assertTrue(webhooks.some(w => w.id === testWebhookId), 'Created webhook should be in list')
  })

  await test('Can get specific webhook', async () => {
    const { status, data } = await api('GET', `/api/hooks/webhooks/${testWebhookId}`)
    assertEqual(status, 200)
    assertEqual((data as { id: string }).id, testWebhookId)
  })

  await test('Can update webhook', async () => {
    const { status, data } = await api('PATCH', `/api/hooks/webhooks/${testWebhookId}`, {
      name: 'Updated Webhook',
      enabled: false,
    })
    assertEqual(status, 200)

    const webhook = data as { name: string; enabled: boolean }
    assertEqual(webhook.name, 'Updated Webhook')
    assertEqual(webhook.enabled, false)
  })

  await test('Can delete webhook', async () => {
    const { status } = await api('DELETE', `/api/hooks/webhooks/${testWebhookId}`)
    assertEqual(status, 200)
  })

  await test('Webhook is unregistered from handlers', async () => {
    const { data } = await api('GET', '/api/hooks')
    const handlers = data as Array<{ id: string }>

    const webhookHandler = handlers.find(h => h.id === `webhook:${testWebhookId}`)
    assertTrue(!webhookHandler, 'Webhook should be removed from handlers')
  })

  await test('Deleted webhook returns 404', async () => {
    const { status } = await api('GET', `/api/hooks/webhooks/${testWebhookId}`)
    assertEqual(status, 404)
  })
}

async function testWebhookValidation(): Promise<void> {
  console.log('\n🔒 Testing Webhook Validation...')

  await test('Rejects webhook without name', async () => {
    const { status } = await api('POST', '/api/hooks/webhooks', {
      url: 'https://example.com/webhook',
      eventTypes: ['message:received'],
    })
    assertEqual(status, 400)
  })

  await test('Rejects webhook without url', async () => {
    const { status } = await api('POST', '/api/hooks/webhooks', {
      name: 'Test',
      eventTypes: ['message:received'],
    })
    assertEqual(status, 400)
  })

  await test('Rejects webhook without eventTypes', async () => {
    const { status } = await api('POST', '/api/hooks/webhooks', {
      name: 'Test',
      url: 'https://example.com/webhook',
    })
    assertEqual(status, 400)
  })

  await test('Rejects webhook with invalid url', async () => {
    const { status } = await api('POST', '/api/hooks/webhooks', {
      name: 'Test',
      url: 'not-a-valid-url',
      eventTypes: ['message:received'],
    })
    assertEqual(status, 400)
  })

  await test('Rejects webhook with empty eventTypes', async () => {
    const { status } = await api('POST', '/api/hooks/webhooks', {
      name: 'Test',
      url: 'https://example.com/webhook',
      eventTypes: [],
    })
    assertEqual(status, 400)
  })
}

// ============================================
// Run Tests
// ============================================

async function runTests(): Promise<void> {
  console.log('🧪 Hook System Test Suite')
  console.log('='.repeat(50))

  try {
    await setupAuth()
    await testHandlerListing()
    await testHandlerToggle()
    await testEventEmission()
    await testEventLog()
    await testWebhookCRUD()
    await testWebhookValidation()
  } catch (error) {
    console.error('\n💥 Test suite error:', error)
  }

  // Print summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 Test Summary')
  console.log('='.repeat(50))

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length

  console.log(`\n  Total:  ${total}`)
  console.log(`  Passed: ${passed} ✅`)
  console.log(`  Failed: ${failed} ❌`)

  if (failed > 0) {
    console.log('\n❌ Failed Tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`)
    })
  }

  console.log('\n' + '='.repeat(50))

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0)
}

// Run
runTests()
