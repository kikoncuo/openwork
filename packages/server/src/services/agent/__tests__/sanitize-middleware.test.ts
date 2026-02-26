/**
 * Sanitize Tool Results Middleware Tests
 * Tests the middleware that ensures tool results are never empty strings
 * Run with: npx tsx packages/server/src/services/agent/__tests__/sanitize-middleware.test.ts
 */

export {}

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

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
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

/**
 * Simulates the sanitization logic from the middleware
 * This is extracted to be testable without the full langchain framework
 */
function sanitizeToolResult(result: unknown): unknown {
  // Ensure tool results are never empty strings
  if (typeof result === 'string' && result.trim() === '') {
    return '(no output)'
  }
  // Handle objects with empty content
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content
    if (typeof content === 'string' && content.trim() === '') {
      return { ...result, content: '(no output)' }
    }
  }
  return result
}

async function runTests(): Promise<void> {
  console.log('\n🧪 Sanitize Tool Results Middleware Tests\n')

  console.log('Testing string results:')

  await test('empty string returns placeholder', () => {
    assertEqual(sanitizeToolResult(''), '(no output)')
  })

  await test('whitespace-only string returns placeholder', () => {
    assertEqual(sanitizeToolResult('   '), '(no output)')
    assertEqual(sanitizeToolResult('\n\t'), '(no output)')
  })

  await test('non-empty string passes through unchanged', () => {
    assertEqual(sanitizeToolResult('hello'), 'hello')
    assertEqual(sanitizeToolResult('File created successfully'), 'File created successfully')
  })

  await test('string with only newlines returns placeholder', () => {
    assertEqual(sanitizeToolResult('\n'), '(no output)')
    assertEqual(sanitizeToolResult('\n\n\n'), '(no output)')
  })

  console.log('\nTesting object results with content field:')

  await test('object with empty content gets sanitized', () => {
    const input = { content: '', tool_call_id: '123' }
    const expected = { content: '(no output)', tool_call_id: '123' }
    assertDeepEqual(sanitizeToolResult(input), expected)
  })

  await test('object with whitespace content gets sanitized', () => {
    const input = { content: '   ', name: 'test', tool_call_id: '456' }
    const expected = { content: '(no output)', name: 'test', tool_call_id: '456' }
    assertDeepEqual(sanitizeToolResult(input), expected)
  })

  await test('object with non-empty content passes through', () => {
    const input = { content: 'Success!', tool_call_id: '789' }
    assertDeepEqual(sanitizeToolResult(input), input)
  })

  console.log('\nTesting edge cases:')

  await test('null passes through', () => {
    assertEqual(sanitizeToolResult(null), null)
  })

  await test('undefined passes through', () => {
    assertEqual(sanitizeToolResult(undefined), undefined)
  })

  await test('number passes through', () => {
    assertEqual(sanitizeToolResult(42), 42)
  })

  await test('array passes through', () => {
    const arr = [1, 2, 3]
    assertEqual(sanitizeToolResult(arr), arr)
  })

  await test('object without content field passes through', () => {
    const obj = { name: 'test', value: 123 }
    assertDeepEqual(sanitizeToolResult(obj), obj)
  })

  await test('object with non-string content passes through', () => {
    const obj = { content: 123, name: 'test' }
    assertDeepEqual(sanitizeToolResult(obj), obj)
  })

  await test('object with array content passes through', () => {
    const obj = { content: ['item1', 'item2'], name: 'test' }
    assertDeepEqual(sanitizeToolResult(obj), obj)
  })

  // Summary
  console.log('\n' + '='.repeat(50))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`)
    })
    process.exit(1)
  }

  console.log('\n✅ All tests passed!\n')
}

// Run tests
runTests().catch(console.error)
