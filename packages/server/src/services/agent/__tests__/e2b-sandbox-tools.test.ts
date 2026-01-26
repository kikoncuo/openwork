/**
 * E2B Sandbox Tools Tests (Backup-First)
 * Tests the backup-first implementation of filesystem tools
 * Run with: npx tsx packages/server/src/services/agent/__tests__/e2b-sandbox-tools.test.ts
 */

import {
  initializeDatabase,
  getAgentFileByPath,
  saveAgentFile,
  deleteAgentFile,
  listAgentBackupFiles,
  getAgentFileBackup,
  saveAgentFileBackup,
  clearAgentFileBackup,
} from '../../db/index.js'

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

// Test agent ID (we'll use a fake one for unit tests)
const TEST_AGENT_ID = 'test-agent-tools-' + Date.now()

// Test helper
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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

function assertContains(str: string, substring: string, message?: string): void {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to contain "${substring}"`)
  }
}

function assertArrayIncludes<T>(arr: T[], item: T, message?: string): void {
  if (!arr.includes(item)) {
    throw new Error(message || `Array does not include expected item`)
  }
}

// ============================================
// Mock E2bSandbox class for testing backup-first logic
// ============================================

class MockE2bSandbox {
  readonly agentId: string
  private workspacePath: string = '/home/user'

  constructor(agentId: string) {
    this.agentId = agentId
  }

  /**
   * List files and directories in a path with metadata.
   * BACKUP-FIRST: Reads from backup database, no sandbox needed.
   */
  async lsInfo(path: string): Promise<Array<{ path: string; is_dir: boolean; size?: number }>> {
    const backup = getAgentFileBackup(this.agentId)
    if (!backup || backup.length === 0) {
      return []
    }

    // Normalize path for comparison
    const normalizedPath = path.endsWith('/') ? path : path + '/'

    // Build a map of direct children (files and subdirs)
    const children = new Map<string, { path: string; is_dir: boolean; size?: number }>()

    for (const file of backup) {
      // Check if file is under the given path
      if (!file.path.startsWith(normalizedPath) && file.path !== path) continue

      // Get the relative path from the given directory
      const relativePath = file.path.substring(normalizedPath.length)
      if (!relativePath) continue

      // Get the first component of the relative path
      const parts = relativePath.split('/')
      const name = parts[0]
      const isDir = parts.length > 1
      const fullPath = `${normalizedPath}${name}`

      if (!children.has(fullPath)) {
        children.set(fullPath, {
          path: fullPath,
          is_dir: isDir,
          size: isDir ? undefined : file.content.length
        })
      }
    }

    return Array.from(children.values())
  }

  /**
   * Read file content with line numbers.
   * BACKUP-FIRST: Reads from backup database, no sandbox needed.
   */
  async read(filePath: string, offset = 0, limit = 500): Promise<string> {
    // Try backup first
    const file = getAgentFileByPath(this.agentId, filePath)
    if (file) {
      const lines = file.content.split('\n')
      const slice = lines.slice(offset, offset + limit)
      // Format with line numbers (1-indexed)
      return slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
    }

    return `Error: File not found: ${filePath}`
  }

  /**
   * Write content to a file.
   * BACKUP-FIRST: Writes to backup database first.
   */
  async write(filePath: string, content: string): Promise<{ path?: string; error?: string }> {
    try {
      // Write to backup first (always available)
      saveAgentFile(this.agentId, filePath, content)
      return { path: filePath }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Write failed'
      return { error: message }
    }
  }

  /**
   * Edit a file by replacing string occurrences.
   * BACKUP-FIRST: Reads from backup, performs replacement, writes back.
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<{ path?: string; error?: string }> {
    // Read from backup first
    const file = getAgentFileByPath(this.agentId, filePath)
    if (!file) {
      return { error: `File not found: ${filePath}` }
    }

    let newContent: string
    let occurrences: number

    if (replaceAll) {
      // Escape special regex characters in oldString
      const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, 'g')
      occurrences = (file.content.match(regex) || []).length
      newContent = file.content.replace(regex, newString)
    } else {
      occurrences = file.content.includes(oldString) ? 1 : 0
      newContent = file.content.replace(oldString, newString)
    }

    if (occurrences === 0) {
      return { error: 'String not found in file' }
    }

    // Save to backup
    saveAgentFile(this.agentId, filePath, newContent)

    return { path: filePath }
  }

  /**
   * Find files matching a glob pattern.
   * BACKUP-FIRST: Filters backup files using glob pattern, no sandbox needed.
   */
  async globInfo(pattern: string, path?: string): Promise<Array<{ path: string; is_dir: boolean; size?: number }>> {
    const backup = getAgentFileBackup(this.agentId)
    if (!backup || backup.length === 0) {
      return []
    }

    const basePath = path || this.workspacePath

    // Convert glob pattern to regex
    const globRegex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') + '$'
    )

    // Filter files matching the glob
    return backup
      .filter(f => {
        if (!f.path.startsWith(basePath)) return false
        // Match the pattern against the filename or relative path
        const fileName = f.path.split('/').pop() || f.path
        const relativePath = f.path.substring(basePath.length).replace(/^\//, '')
        return globRegex.test(fileName) || globRegex.test(relativePath) || globRegex.test(f.path)
      })
      .map(f => ({
        path: f.path,
        is_dir: false,
        size: f.content.length
      }))
  }

  /**
   * Search file contents for a pattern.
   * BACKUP-FIRST: Searches backup files in-memory, no sandbox needed.
   */
  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<Array<{ path: string; line: number; text: string }> | string> {
    const backup = getAgentFileBackup(this.agentId)
    if (!backup || backup.length === 0) {
      return []
    }

    const basePath = path || this.workspacePath
    const matches: Array<{ path: string; line: number; text: string }> = []

    // Create regex for pattern matching
    let regex: RegExp
    try {
      regex = new RegExp(pattern, 'g')
    } catch {
      // If invalid regex, treat as literal string
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    }

    // Create glob matcher if provided
    const globPattern = glob ? new RegExp(
      '^' + glob
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.') + '$'
    ) : null

    for (const file of backup) {
      // Check if file is under the base path
      if (!file.path.startsWith(basePath)) continue

      // Check glob pattern if provided
      if (globPattern && !globPattern.test(file.path)) continue

      // Search content
      const lines = file.content.split('\n')
      lines.forEach((line, i) => {
        regex.lastIndex = 0 // Reset for each line
        if (regex.test(line)) {
          matches.push({
            path: file.path,
            line: i + 1,
            text: line
          })
        }
      })
    }

    return matches
  }
}

// ============================================
// Test Suites
// ============================================

async function setupTestFiles(): Promise<void> {
  console.log('\n📁 Setting up test files in backup...')

  // Clear any existing backup
  clearAgentFileBackup(TEST_AGENT_ID)

  // Create test files
  const testFiles = [
    { path: '/home/user/file1.txt', content: 'Hello World\nThis is line 2\nAnd line 3' },
    { path: '/home/user/file2.ts', content: 'export const foo = "bar";\nexport const baz = 123;' },
    { path: '/home/user/src/index.ts', content: 'import { foo } from "./utils";\nconsole.log(foo);' },
    { path: '/home/user/src/utils.ts', content: 'export const foo = "hello";\nexport const bar = "world";' },
    { path: '/home/user/src/components/Button.tsx', content: 'export function Button() {\n  return <button>Click me</button>;\n}' },
    { path: '/home/user/docs/readme.md', content: '# Project\n\nThis is a test project.\n\n## Usage\n\nRun the tests.' },
  ]

  saveAgentFileBackup(TEST_AGENT_ID, testFiles)
  console.log(`  ✅ Created ${testFiles.length} test files\n`)
}

async function testLsInfo(): Promise<void> {
  console.log('📂 Testing lsInfo (list directory)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  await test('Lists files in root directory', async () => {
    const files = await sandbox.lsInfo('/home/user')
    assertTrue(files.length > 0, 'Should have files')

    const paths = files.map(f => f.path)
    assertArrayIncludes(paths, '/home/user/file1.txt')
    assertArrayIncludes(paths, '/home/user/file2.ts')
  })

  await test('Lists subdirectories correctly', async () => {
    const files = await sandbox.lsInfo('/home/user')

    const srcDir = files.find(f => f.path === '/home/user/src')
    assertTrue(srcDir !== undefined, 'Should find src directory')
    assertEqual(srcDir!.is_dir, true)
  })

  await test('Lists nested directory contents', async () => {
    const files = await sandbox.lsInfo('/home/user/src')
    assertTrue(files.length > 0, 'Should have files in src')

    const paths = files.map(f => f.path)
    assertArrayIncludes(paths, '/home/user/src/index.ts')
    assertArrayIncludes(paths, '/home/user/src/utils.ts')
  })

  await test('Returns empty for non-existent directory', async () => {
    const files = await sandbox.lsInfo('/home/user/nonexistent')
    assertEqual(files.length, 0)
  })

  await test('Files have size property', async () => {
    const files = await sandbox.lsInfo('/home/user')
    const file1 = files.find(f => f.path === '/home/user/file1.txt')

    assertTrue(file1 !== undefined, 'Should find file1.txt')
    assertTrue(typeof file1!.size === 'number', 'Should have size')
    assertTrue(file1!.size! > 0, 'Size should be positive')
  })
}

async function testRead(): Promise<void> {
  console.log('\n📖 Testing read (read file)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  await test('Reads file content with line numbers', async () => {
    const content = await sandbox.read('/home/user/file1.txt')

    assertContains(content, '1\t')  // Line 1
    assertContains(content, 'Hello World')
    assertContains(content, '2\t')  // Line 2
  })

  await test('Respects offset parameter', async () => {
    const content = await sandbox.read('/home/user/file1.txt', 1)  // Skip first line

    assertContains(content, '2\t')  // Should start at line 2
    assertTrue(!content.includes('1\tHello'), 'Should not include line 1')
  })

  await test('Respects limit parameter', async () => {
    const content = await sandbox.read('/home/user/file1.txt', 0, 1)  // Only first line

    const lines = content.split('\n')
    assertEqual(lines.length, 1)
    assertContains(content, 'Hello World')
  })

  await test('Returns error for non-existent file', async () => {
    const content = await sandbox.read('/home/user/nonexistent.txt')
    assertContains(content, 'Error')
    assertContains(content, 'File not found')
  })
}

async function testWrite(): Promise<void> {
  console.log('\n✏️ Testing write (write file)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  await test('Writes new file to backup', async () => {
    const result = await sandbox.write('/home/user/newfile.txt', 'New content here')

    assertEqual(result.path, '/home/user/newfile.txt')
    assertTrue(result.error === undefined, 'Should not have error')

    // Verify it was written
    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/newfile.txt')
    assertTrue(file !== null, 'File should exist in backup')
    assertEqual(file!.content, 'New content here')
  })

  await test('Overwrites existing file', async () => {
    await sandbox.write('/home/user/overwrite.txt', 'Original')
    const result = await sandbox.write('/home/user/overwrite.txt', 'Updated')

    assertEqual(result.path, '/home/user/overwrite.txt')

    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/overwrite.txt')
    assertEqual(file!.content, 'Updated')
  })

  await test('Creates nested directories implicitly', async () => {
    const result = await sandbox.write('/home/user/new/nested/dir/file.txt', 'Nested content')

    assertEqual(result.path, '/home/user/new/nested/dir/file.txt')

    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/new/nested/dir/file.txt')
    assertTrue(file !== null, 'Nested file should exist')
  })
}

async function testEdit(): Promise<void> {
  console.log('\n🔧 Testing edit (edit file)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  // Setup a file for editing
  await sandbox.write('/home/user/editable.txt', 'foo bar foo baz foo')

  await test('Replaces first occurrence by default', async () => {
    await sandbox.write('/home/user/edit1.txt', 'foo bar foo')
    const result = await sandbox.edit('/home/user/edit1.txt', 'foo', 'replaced')

    assertEqual(result.path, '/home/user/edit1.txt')

    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/edit1.txt')
    assertEqual(file!.content, 'replaced bar foo')  // Only first 'foo' replaced
  })

  await test('Replaces all occurrences with replaceAll=true', async () => {
    await sandbox.write('/home/user/edit2.txt', 'foo bar foo baz foo')
    const result = await sandbox.edit('/home/user/edit2.txt', 'foo', 'X', true)

    assertEqual(result.path, '/home/user/edit2.txt')

    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/edit2.txt')
    assertEqual(file!.content, 'X bar X baz X')  // All 'foo' replaced
  })

  await test('Returns error when string not found', async () => {
    await sandbox.write('/home/user/edit3.txt', 'hello world')
    const result = await sandbox.edit('/home/user/edit3.txt', 'notfound', 'X')

    assertTrue(result.error !== undefined, 'Should have error')
    assertContains(result.error!, 'not found')
  })

  await test('Returns error for non-existent file', async () => {
    const result = await sandbox.edit('/home/user/nonexistent.txt', 'foo', 'bar')

    assertTrue(result.error !== undefined, 'Should have error')
    assertContains(result.error!, 'File not found')
  })

  await test('Handles special regex characters in search string', async () => {
    await sandbox.write('/home/user/edit4.txt', 'price is $100.00')
    const result = await sandbox.edit('/home/user/edit4.txt', '$100.00', '$200.00')

    assertEqual(result.path, '/home/user/edit4.txt')

    const file = getAgentFileByPath(TEST_AGENT_ID, '/home/user/edit4.txt')
    assertEqual(file!.content, 'price is $200.00')
  })
}

async function testGlobInfo(): Promise<void> {
  console.log('\n🔍 Testing globInfo (glob search)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  await test('Finds files matching *.ts pattern', async () => {
    const files = await sandbox.globInfo('*.ts')

    assertTrue(files.length > 0, 'Should find TypeScript files')
    const paths = files.map(f => f.path)
    assertArrayIncludes(paths, '/home/user/file2.ts')
  })

  await test('Finds files matching *.tsx pattern', async () => {
    const files = await sandbox.globInfo('*.tsx')

    assertTrue(files.length > 0, 'Should find TSX files')
    const paths = files.map(f => f.path)
    assertTrue(paths.some(p => p.includes('Button.tsx')), 'Should find Button.tsx')
  })

  await test('Finds files matching *.md pattern', async () => {
    const files = await sandbox.globInfo('*.md')

    assertTrue(files.length > 0, 'Should find markdown files')
    const paths = files.map(f => f.path)
    assertTrue(paths.some(p => p.includes('readme.md')), 'Should find readme.md')
  })

  await test('Respects base path parameter', async () => {
    const files = await sandbox.globInfo('*.ts', '/home/user/src')

    assertTrue(files.length > 0, 'Should find files in src')
    for (const file of files) {
      assertTrue(file.path.startsWith('/home/user/src'), 'All files should be in src')
    }
  })

  await test('Returns empty for non-matching pattern', async () => {
    const files = await sandbox.globInfo('*.xyz')
    assertEqual(files.length, 0)
  })
}

async function testGrepRaw(): Promise<void> {
  console.log('\n🔎 Testing grepRaw (content search)...')

  const sandbox = new MockE2bSandbox(TEST_AGENT_ID)

  await test('Finds matches across files', async () => {
    const matches = await sandbox.grepRaw('export')

    assertTrue(Array.isArray(matches), 'Should return array')
    assertTrue((matches as Array<unknown>).length > 0, 'Should find matches')
  })

  await test('Returns correct line numbers', async () => {
    const matches = await sandbox.grepRaw('Hello World') as Array<{ path: string; line: number; text: string }>

    assertTrue(matches.length > 0, 'Should find Hello World')
    const match = matches.find(m => m.path === '/home/user/file1.txt')
    assertTrue(match !== undefined, 'Should find in file1.txt')
    assertEqual(match!.line, 1)  // First line
  })

  await test('Returns matching text', async () => {
    const matches = await sandbox.grepRaw('console.log') as Array<{ path: string; line: number; text: string }>

    assertTrue(matches.length > 0, 'Should find console.log')
    assertTrue(matches[0].text.includes('console.log'), 'Text should contain match')
  })

  await test('Respects path parameter', async () => {
    const matches = await sandbox.grepRaw('export', '/home/user/src') as Array<{ path: string; line: number; text: string }>

    for (const match of matches) {
      assertTrue(match.path.startsWith('/home/user/src'), 'All matches should be in src')
    }
  })

  await test('Respects glob filter', async () => {
    const matches = await sandbox.grepRaw('export', null, '*.ts') as Array<{ path: string; line: number; text: string }>

    for (const match of matches) {
      assertTrue(match.path.endsWith('.ts') || match.path.endsWith('.tsx'), 'All matches should be TypeScript files')
    }
  })

  await test('Returns empty for non-matching pattern', async () => {
    const matches = await sandbox.grepRaw('xyznonexistent123')
    assertTrue(Array.isArray(matches), 'Should return array')
    assertEqual((matches as Array<unknown>).length, 0)
  })

  await test('Handles regex patterns', async () => {
    const matches = await sandbox.grepRaw('export (const|function)') as Array<{ path: string; line: number; text: string }>

    assertTrue(matches.length > 0, 'Should find matches with regex')
  })
}

async function cleanup(): Promise<void> {
  console.log('\n🧹 Cleaning up...')
  clearAgentFileBackup(TEST_AGENT_ID)
  console.log('  ✅ Cleanup complete\n')
}

// ============================================
// Run Tests
// ============================================

async function runTests(): Promise<void> {
  console.log('🧪 E2B Sandbox Tools Test Suite (Backup-First)')
  console.log('='.repeat(50))

  // Initialize database for standalone test execution
  console.log('\n🗄️ Initializing database...')
  await initializeDatabase()
  console.log('  ✅ Database initialized')

  try {
    await setupTestFiles()
    await testLsInfo()
    await testRead()
    await testWrite()
    await testEdit()
    await testGlobInfo()
    await testGrepRaw()
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
