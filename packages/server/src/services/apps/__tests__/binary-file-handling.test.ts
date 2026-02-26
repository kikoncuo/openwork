/**
 * Binary File Handling Tests
 * Tests the upload/download cycle for binary files to ensure data integrity
 * Run with: npx tsx src/services/apps/__tests__/binary-file-handling.test.ts
 */

import fs from 'fs'
import path from 'path'
import assert from 'node:assert'
import { fileURLToPath } from 'url'

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

// Binary file detection (same as in e2b-sandbox.ts)
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.tiff', '.tif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma',
  '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.sqlite', '.db', '.pickle', '.pkl', '.npy', '.npz', '.parquet', '.avro',
  '.class', '.jar', '.war', '.pyc', '.pyo', '.wasm'
])

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

// Simulate the upload process (what happens in e2b-sandbox.ts uploadFiles)
function simulateUpload(content: Uint8Array, filePath: string): { content: string; encoding?: 'utf8' | 'base64' } {
  const binary = isBinaryFile(filePath)

  if (binary) {
    // Base64 encode for binary files
    const base64 = Buffer.from(content).toString('base64')
    return { content: base64, encoding: 'base64' }
  } else {
    // Text decode for text files
    const text = new TextDecoder().decode(content)
    return { content: text }
  }
}

// Simulate the download process (what happens in e2b-sandbox.ts downloadFiles)
function simulateDownload(stored: { content: string; encoding?: 'utf8' | 'base64' }): Uint8Array {
  if (stored.encoding === 'base64') {
    // Decode base64 for binary files
    return new Uint8Array(Buffer.from(stored.content, 'base64'))
  } else {
    // Text encode for text files
    return new TextEncoder().encode(stored.content)
  }
}

// Test the round-trip
async function runTests() {
  const testDataDir = path.join(__dirname, '../../../../../..', 'test_data')
  const testFile = path.join(testDataDir, '1.webp')

  await describe('Binary File Detection', async () => {
    await it('detects .webp as binary', () => {
      assert(isBinaryFile('test.webp') === true, '.webp should be binary')
    })

    await it('detects .docx as binary', () => {
      assert(isBinaryFile('document.docx') === true, '.docx should be binary')
    })

    await it('detects .pdf as binary', () => {
      assert(isBinaryFile('file.pdf') === true, '.pdf should be binary')
    })

    await it('detects .png as binary', () => {
      assert(isBinaryFile('image.png') === true, '.png should be binary')
    })

    await it('detects .txt as text', () => {
      assert(isBinaryFile('readme.txt') === false, '.txt should be text')
    })

    await it('detects .js as text', () => {
      assert(isBinaryFile('script.js') === false, '.js should be text')
    })

    await it('detects .json as text', () => {
      assert(isBinaryFile('data.json') === false, '.json should be text')
    })
  })

  await describe('Binary File Round-Trip (Simulated)', async () => {
    await it('preserves binary data through upload/download cycle', () => {
      // Create some binary data with bytes that would be corrupted by TextDecoder
      const originalData = new Uint8Array([0x00, 0x01, 0xFF, 0xFE, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

      // Simulate upload
      const stored = simulateUpload(originalData, 'test.png')
      assert(stored.encoding === 'base64', 'Should be stored as base64')

      // Simulate download
      const downloaded = simulateDownload(stored)

      // Verify data integrity
      assert(downloaded.length === originalData.length, `Length mismatch: ${downloaded.length} vs ${originalData.length}`)
      for (let i = 0; i < originalData.length; i++) {
        assert(downloaded[i] === originalData[i], `Byte mismatch at position ${i}: ${downloaded[i]} vs ${originalData[i]}`)
      }
    })

    await it('shows how TextDecoder corrupts binary data', () => {
      // Binary data with invalid UTF-8 sequences
      const binaryData = new Uint8Array([0xFF, 0xFE, 0x00, 0x01])

      // This is what was happening before (corrupts data)
      const corruptedText = new TextDecoder().decode(binaryData)
      const corruptedBack = new TextEncoder().encode(corruptedText)

      // Verify that the old method corrupts data
      let corrupted = false
      if (corruptedBack.length !== binaryData.length) {
        corrupted = true
      } else {
        for (let i = 0; i < binaryData.length; i++) {
          if (corruptedBack[i] !== binaryData[i]) {
            corrupted = true
            break
          }
        }
      }

      assert(corrupted === true, 'TextDecoder should corrupt binary data (this proves the bug)')
      console.log(`      Original bytes: [${Array.from(binaryData).join(', ')}]`)
      console.log(`      After TextDecoder/TextEncoder: [${Array.from(corruptedBack).join(', ')}]`)
    })

    await it('base64 encoding preserves binary data', () => {
      // Same binary data
      const binaryData = new Uint8Array([0xFF, 0xFE, 0x00, 0x01])

      // New method using base64
      const base64 = Buffer.from(binaryData).toString('base64')
      const restored = new Uint8Array(Buffer.from(base64, 'base64'))

      // Verify data is preserved
      assert(restored.length === binaryData.length, 'Length should match')
      for (let i = 0; i < binaryData.length; i++) {
        assert(restored[i] === binaryData[i], `Byte ${i} should match`)
      }
    })
  })

  await describe('Real File Test (test_data/1.webp)', async () => {
    // Check if test file exists
    if (!fs.existsSync(testFile)) {
      console.log(`  ⚠ Skipping: Test file not found at ${testFile}`)
      return
    }

    const originalBuffer = fs.readFileSync(testFile)
    const originalData = new Uint8Array(originalBuffer)
    console.log(`  File size: ${originalData.length} bytes`)
    console.log(`  First 16 bytes: [${Array.from(originalData.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`)

    await it('correctly identifies 1.webp as binary', () => {
      assert(isBinaryFile(testFile) === true, 'Should detect .webp as binary')
    })

    await it('preserves 1.webp through simulated upload/download', () => {
      // Simulate upload
      const stored = simulateUpload(originalData, testFile)
      assert(stored.encoding === 'base64', 'Should be stored as base64')
      console.log(`      Stored as base64, length: ${stored.content.length} chars`)

      // Simulate download
      const downloaded = simulateDownload(stored)

      // Verify size
      assert(downloaded.length === originalData.length,
        `Size mismatch: downloaded ${downloaded.length} vs original ${originalData.length}`)

      // Verify content byte-by-byte
      let mismatches = 0
      for (let i = 0; i < originalData.length; i++) {
        if (downloaded[i] !== originalData[i]) {
          mismatches++
          if (mismatches <= 5) {
            console.log(`      Mismatch at byte ${i}: got ${downloaded[i]}, expected ${originalData[i]}`)
          }
        }
      }

      assert(mismatches === 0, `${mismatches} byte mismatches found`)
    })

    await it('demonstrates corruption with old TextDecoder method', () => {
      // This shows what was happening before
      const corruptedText = new TextDecoder().decode(originalData)
      const corruptedBack = new TextEncoder().encode(corruptedText)

      console.log(`      Original size: ${originalData.length} bytes`)
      console.log(`      After TextDecoder/TextEncoder: ${corruptedBack.length} bytes`)

      // Count mismatches
      let mismatches = 0
      const checkLength = Math.min(originalData.length, corruptedBack.length)
      for (let i = 0; i < checkLength; i++) {
        if (corruptedBack[i] !== originalData[i]) {
          mismatches++
        }
      }
      mismatches += Math.abs(originalData.length - corruptedBack.length)

      console.log(`      Byte differences: ${mismatches}`)
      assert(mismatches > 0, 'TextDecoder should corrupt this binary file')
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
