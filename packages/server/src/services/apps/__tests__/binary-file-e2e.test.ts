/**
 * End-to-End Binary File Handling Test
 * Tests the actual database functions to verify binary files are preserved
 * Run with: npx tsx src/services/apps/__tests__/binary-file-e2e.test.ts
 */

import fs from 'fs'
import path from 'path'
import assert from 'node:assert'
import { fileURLToPath } from 'url'

// Import the actual functions
import { saveAgentFile, getAgentFileByPath, getAgentFileBackup, initializeDatabase, closeDatabase } from '../../db/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Simple test framework
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

const TEST_AGENT_ID = 'test-binary-agent-' + Date.now()

async function runTests() {
  const testDataDir = path.join(__dirname, '../../../../../..', 'test_data')
  const testFile = path.join(testDataDir, '1.webp')

  // Initialize database
  console.log('Initializing test database...')
  await initializeDatabase()

  await describe('Database Binary File Storage', async () => {
    await it('saves binary file with base64 encoding', async () => {
      // Simulate what the frontend does: read file as base64
      const originalBuffer = fs.readFileSync(testFile)
      const base64Content = originalBuffer.toString('base64')

      // Save using the actual function
      await saveAgentFile(TEST_AGENT_ID, '/home/user/test.webp', base64Content, 'base64')

      // Verify it was saved
      const backup = await getAgentFileBackup(TEST_AGENT_ID)
      assert(backup !== null, 'Backup should exist')
      assert(backup.length === 1, 'Should have 1 file')
      assert(backup[0].path === '/home/user/test.webp', 'Path should match')
      assert(backup[0].encoding === 'base64', 'Encoding should be base64')
    })

    await it('retrieves file with encoding info', async () => {
      const file = await getAgentFileByPath(TEST_AGENT_ID, '/home/user/test.webp')
      assert(file !== null, 'File should exist')
      assert(file.encoding === 'base64', 'Should have encoding info')
    })

    await it('decodes base64 to get original content', async () => {
      // Read original file
      const originalBuffer = fs.readFileSync(testFile)

      // Get from database
      const file = await getAgentFileByPath(TEST_AGENT_ID, '/home/user/test.webp')
      assert(file !== null, 'File should exist')

      // Decode base64 (this is what downloadFiles does)
      const decoded = Buffer.from(file.content, 'base64')

      // Compare
      assert(decoded.length === originalBuffer.length,
        `Size mismatch: ${decoded.length} vs ${originalBuffer.length}`)

      // Check byte-by-byte
      let mismatches = 0
      for (let i = 0; i < originalBuffer.length; i++) {
        if (decoded[i] !== originalBuffer[i]) {
          mismatches++
        }
      }
      assert(mismatches === 0, `${mismatches} byte mismatches found`)
      console.log(`      Original size: ${originalBuffer.length} bytes`)
      console.log(`      Decoded size: ${decoded.length} bytes`)
      console.log(`      Byte mismatches: ${mismatches}`)
    })

    await it('saves and retrieves text file without encoding', async () => {
      const textContent = 'Hello, this is a text file!\nWith multiple lines.\n'

      // Save without encoding (default for text)
      await saveAgentFile(TEST_AGENT_ID, '/home/user/readme.txt', textContent)

      // Retrieve
      const file = await getAgentFileByPath(TEST_AGENT_ID, '/home/user/readme.txt')
      assert(file !== null, 'File should exist')
      assert(file.encoding === undefined, 'Text files should not have encoding field')
      assert(file.content === textContent, 'Content should match')
    })

    await it('handles multiple files with mixed encodings', async () => {
      const backup = await getAgentFileBackup(TEST_AGENT_ID)
      assert(backup !== null, 'Backup should exist')
      assert(backup.length === 2, 'Should have 2 files')

      const binaryFile = backup.find(f => f.path === '/home/user/test.webp')
      const textFile = backup.find(f => f.path === '/home/user/readme.txt')

      assert(binaryFile?.encoding === 'base64', 'Binary file should be base64')
      assert(textFile?.encoding === undefined, 'Text file should not have encoding')
    })
  })

  await describe('Full Upload/Download Simulation', async () => {
    // Simulate the exact flow that happens when a user uploads a file

    await it('simulates complete upload flow for webp file', async () => {
      // Step 1: Frontend reads file and base64 encodes (for binary)
      const originalBuffer = fs.readFileSync(testFile)
      const base64Content = originalBuffer.toString('base64')

      // Step 2: POST /backup/file with encoding='base64'
      await saveAgentFile(TEST_AGENT_ID, '/home/user/uploaded.webp', base64Content, 'base64')

      console.log(`      Uploaded ${originalBuffer.length} bytes as ${base64Content.length} base64 chars`)
    })

    await it('simulates complete download flow for webp file', async () => {
      // Step 1: Get file from backup
      const file = await getAgentFileByPath(TEST_AGENT_ID, '/home/user/uploaded.webp')
      assert(file !== null, 'File should exist')

      // Step 2: Check encoding and decode if needed (what downloadFiles does)
      let contentBytes: Uint8Array
      if (file.encoding === 'base64') {
        contentBytes = new Uint8Array(Buffer.from(file.content, 'base64'))
      } else {
        contentBytes = new TextEncoder().encode(file.content)
      }

      // Step 3: Verify against original
      const originalBuffer = fs.readFileSync(testFile)

      assert(contentBytes.length === originalBuffer.length,
        `Size mismatch: ${contentBytes.length} vs ${originalBuffer.length}`)

      let mismatches = 0
      for (let i = 0; i < originalBuffer.length; i++) {
        if (contentBytes[i] !== originalBuffer[i]) {
          mismatches++
        }
      }
      assert(mismatches === 0, `${mismatches} byte mismatches - file is corrupted!`)

      console.log(`      Downloaded and verified ${contentBytes.length} bytes`)
      console.log(`      File integrity: OK`)
    })

    await it('can write downloaded content to disk unchanged', async () => {
      // Get from database
      const file = await getAgentFileByPath(TEST_AGENT_ID, '/home/user/uploaded.webp')
      assert(file !== null, 'File should exist')

      // Decode
      const contentBytes = Buffer.from(file.content, 'base64')

      // Write to temp file
      const tempFile = path.join(__dirname, 'temp-output.webp')
      fs.writeFileSync(tempFile, contentBytes)

      // Read back and compare with original
      const writtenBuffer = fs.readFileSync(tempFile)
      const originalBuffer = fs.readFileSync(testFile)

      assert(writtenBuffer.length === originalBuffer.length, 'Size should match')

      let match = true
      for (let i = 0; i < originalBuffer.length && match; i++) {
        if (writtenBuffer[i] !== originalBuffer[i]) {
          match = false
        }
      }
      assert(match, 'Written file should match original')

      // Cleanup
      fs.unlinkSync(tempFile)
      console.log(`      Written file matches original: OK`)
    })
  })

  // Cleanup
  await closeDatabase()

  // Summary
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Tests: ${testCount} | Passed: ${passCount} | Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(console.error)
