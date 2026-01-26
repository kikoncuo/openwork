/**
 * Backup-First File Management Tests
 * Run with: npx tsx packages/server/src/services/db/__tests__/backup-files.test.ts
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3001'

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []
let authToken: string = ''
let testAgentId: string = ''

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
    email: 'backuptest@test.com',
    password: 'testpass123',
  })

  if (response.status !== 200) {
    // Register new user
    response = await api('POST', '/api/auth/register', {
      email: 'backuptest@test.com',
      password: 'testpass123',
      name: 'Backup Test User',
    })
  }

  const data = response.data as { accessToken?: string }
  if (!data?.accessToken) {
    throw new Error('Failed to authenticate')
  }

  authToken = data.accessToken
  console.log('  ✅ Authenticated successfully\n')
}

async function setupTestAgent(): Promise<void> {
  console.log('🤖 Setting up test agent...')

  // Create a test agent
  const { status, data } = await api('POST', '/api/agents', {
    name: 'Backup Test Agent',
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    systemPrompt: 'Test agent for backup tests',
  })

  if (status !== 200 && status !== 201) {
    // Try to get existing agents
    const listResponse = await api('GET', '/api/agents')
    const agents = listResponse.data as Array<{ agent_id: string; name: string }>

    if (agents && agents.length > 0) {
      testAgentId = agents[0].agent_id
      console.log(`  ✅ Using existing agent: ${testAgentId}\n`)
      return
    }
    throw new Error(`Failed to create agent: ${JSON.stringify(data)}`)
  }

  const agent = data as { agent_id: string }
  testAgentId = agent.agent_id
  console.log(`  ✅ Created test agent: ${testAgentId}\n`)
}

async function testBackupWriteFile(): Promise<void> {
  console.log('📝 Testing Backup Write File...')

  await test('Can write a file to backup', async () => {
    const { status, data } = await api('POST', '/api/workspace/backup/file', {
      agentId: testAgentId,
      path: '/home/user/test.txt',
      content: 'Hello, backup world!',
    })
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
    assertEqual((data as { path: string }).path, '/home/user/test.txt')
  })

  await test('Can write a nested file to backup', async () => {
    const { status, data } = await api('POST', '/api/workspace/backup/file', {
      agentId: testAgentId,
      path: '/home/user/nested/dir/file.ts',
      content: 'export const hello = "world";',
    })
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
  })

  await test('Rejects write without agentId', async () => {
    const { status } = await api('POST', '/api/workspace/backup/file', {
      path: '/home/user/test.txt',
      content: 'Hello',
    })
    assertEqual(status, 400)
  })

  await test('Rejects write without path', async () => {
    const { status } = await api('POST', '/api/workspace/backup/file', {
      agentId: testAgentId,
      content: 'Hello',
    })
    assertEqual(status, 400)
  })
}

async function testBackupReadFile(): Promise<void> {
  console.log('\n📖 Testing Backup Read File...')

  await test('Can read a file from backup', async () => {
    const { status, data } = await api(
      'GET',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/test.txt')}`
    )
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
    assertEqual((data as { content: string }).content, 'Hello, backup world!')
  })

  await test('Can read nested file from backup', async () => {
    const { status, data } = await api(
      'GET',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/nested/dir/file.ts')}`
    )
    assertEqual(status, 200)
    assertEqual((data as { content: string }).content, 'export const hello = "world";')
  })

  await test('Returns 404 for non-existent file', async () => {
    const { status } = await api(
      'GET',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/nonexistent.txt')}`
    )
    assertEqual(status, 404)
  })

  await test('Rejects read without agentId', async () => {
    const { status } = await api(
      'GET',
      `/api/workspace/backup/file?path=${encodeURIComponent('/home/user/test.txt')}`
    )
    assertEqual(status, 400)
  })
}

async function testBackupListFiles(): Promise<void> {
  console.log('\n📋 Testing Backup List Files...')

  await test('Can list files from backup', async () => {
    const { status, data } = await api(
      'GET',
      `/api/workspace/backup/files?agentId=${testAgentId}`
    )
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
    assertTrue(Array.isArray((data as { files: unknown[] }).files), 'files should be an array')
  })

  await test('List includes created files', async () => {
    const { data } = await api(
      'GET',
      `/api/workspace/backup/files?agentId=${testAgentId}`
    )
    const files = (data as { files: Array<{ path: string }> }).files

    const paths = files.map(f => f.path)
    assertTrue(paths.includes('/home/user/test.txt'), 'Should include test.txt')
    assertTrue(paths.includes('/home/user/nested/dir/file.ts'), 'Should include nested file')
  })

  await test('List includes directory entries', async () => {
    const { data } = await api(
      'GET',
      `/api/workspace/backup/files?agentId=${testAgentId}`
    )
    const files = (data as { files: Array<{ path: string; is_dir: boolean }> }).files

    const dirs = files.filter(f => f.is_dir)
    assertTrue(dirs.length > 0, 'Should have directory entries')
  })

  await test('Files have size property', async () => {
    const { data } = await api(
      'GET',
      `/api/workspace/backup/files?agentId=${testAgentId}`
    )
    const files = (data as { files: Array<{ path: string; size: number; is_dir: boolean }> }).files

    const testFile = files.find(f => f.path === '/home/user/test.txt')
    assertTrue(testFile !== undefined, 'Should find test.txt')
    assertTrue(typeof testFile!.size === 'number', 'Size should be a number')
    assertTrue(testFile!.size > 0, 'Size should be positive')
  })
}

async function testBackupDeleteFile(): Promise<void> {
  console.log('\n🗑️ Testing Backup Delete File...')

  // First create a file to delete
  await api('POST', '/api/workspace/backup/file', {
    agentId: testAgentId,
    path: '/home/user/to-delete.txt',
    content: 'Delete me!',
  })

  await test('Can delete a file from backup', async () => {
    const { status, data } = await api(
      'DELETE',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/to-delete.txt')}`
    )
    assertEqual(status, 200)
    assertEqual((data as { success: boolean }).success, true)
    assertEqual((data as { deleted: boolean }).deleted, true)
  })

  await test('Deleted file no longer exists', async () => {
    const { status } = await api(
      'GET',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/to-delete.txt')}`
    )
    assertEqual(status, 404)
  })

  await test('Delete returns false for non-existent file', async () => {
    const { status, data } = await api(
      'DELETE',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/nonexistent.txt')}`
    )
    assertEqual(status, 200)
    assertEqual((data as { deleted: boolean }).deleted, false)
  })
}

async function testFileOverwrite(): Promise<void> {
  console.log('\n🔄 Testing File Overwrite...')

  await test('Can overwrite existing file', async () => {
    // Write initial content
    await api('POST', '/api/workspace/backup/file', {
      agentId: testAgentId,
      path: '/home/user/overwrite.txt',
      content: 'Original content',
    })

    // Overwrite with new content
    const { status } = await api('POST', '/api/workspace/backup/file', {
      agentId: testAgentId,
      path: '/home/user/overwrite.txt',
      content: 'Updated content',
    })
    assertEqual(status, 200)

    // Read and verify
    const { data } = await api(
      'GET',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent('/home/user/overwrite.txt')}`
    )
    assertEqual((data as { content: string }).content, 'Updated content')
  })
}

async function cleanup(): Promise<void> {
  console.log('\n🧹 Cleaning up...')

  // Delete test files
  const testPaths = [
    '/home/user/test.txt',
    '/home/user/nested/dir/file.ts',
    '/home/user/overwrite.txt',
  ]

  for (const path of testPaths) {
    await api(
      'DELETE',
      `/api/workspace/backup/file?agentId=${testAgentId}&path=${encodeURIComponent(path)}`
    )
  }

  console.log('  ✅ Cleanup complete\n')
}

// ============================================
// Run Tests
// ============================================

async function runTests(): Promise<void> {
  console.log('🧪 Backup-First File Management Test Suite')
  console.log('='.repeat(50))

  try {
    await setupAuth()
    await setupTestAgent()
    await testBackupWriteFile()
    await testBackupReadFile()
    await testBackupListFiles()
    await testBackupDeleteFile()
    await testFileOverwrite()
    await cleanup()
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
