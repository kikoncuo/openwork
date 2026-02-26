/**
 * Token counting and smart truncation utilities for tool results.
 *
 * Manages context window usage by:
 * 1. Estimating token counts for text
 * 2. Truncating large outputs while preserving relevance
 * 3. Adding clear truncation markers
 */

const MAX_TOKENS = parseInt(process.env.EXECUTE_RESULT_MAX_TOKENS || '4000', 10)
const CHARS_PER_TOKEN = parseInt(process.env.CHARS_PER_TOKEN || '4', 10)

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function getMaxResultTokens(): number {
  return MAX_TOKENS
}

/**
 * Truncate text while preserving most relevant content.
 * Keeps head + tail, adds truncation marker in middle.
 */
export function smartTruncate(
  text: string,
  maxTokens: number,
  options: {
    preserveHeadLines?: number
    preserveTailLines?: number
    label?: string
  } = {}
): { text: string; wasTruncated: boolean; originalLines: number } {
  const {
    preserveHeadLines = 10,
    preserveTailLines = 20,
    label = 'output'
  } = options

  const maxChars = maxTokens * CHARS_PER_TOKEN
  const lines = text.split('\n')

  if (text.length <= maxChars) {
    return { text, wasTruncated: false, originalLines: lines.length }
  }

  const truncationMarker = `\n\n[... ${label}: ${lines.length - preserveHeadLines - preserveTailLines} lines truncated ...]\n\n`
  const markerChars = truncationMarker.length
  const availableChars = maxChars - markerChars

  const headChars = Math.floor(availableChars * 0.4)
  const tailChars = availableChars - headChars

  // Get head lines
  let headText = ''
  for (let i = 0; i < Math.min(preserveHeadLines, lines.length) && headText.length < headChars; i++) {
    headText += lines[i] + '\n'
  }

  // Get tail lines
  let tailText = ''
  for (let i = lines.length - 1; i >= 0 && tailText.length < tailChars; i--) {
    tailText = lines[i] + '\n' + tailText
  }

  return {
    text: headText.trim() + truncationMarker + tailText.trim(),
    wasTruncated: true,
    originalLines: lines.length
  }
}

/**
 * Format execute result with token limits.
 *
 * Priority:
 * 1. Exit code and execution status
 * 2. Error messages (always full)
 * 3. Image file paths (tiny, always include)
 * 4. stdout (truncated if needed)
 * 5. Truncation notice
 */
export function formatExecuteResultWithTokenLimit(
  result: {
    output: string
    exitCode: number | null
    imagePaths?: string[]
    error?: string
  }
): string {
  const maxTokens = getMaxResultTokens()
  const parts: string[] = []
  let usedTokens = 0
  let wasTruncated = false

  // 1. Status line
  const status = result.exitCode === 0 ? 'OK' : `Exit code: ${result.exitCode}`
  parts.push(status)
  usedTokens += estimateTokens(status)

  // 2. Error messages (high priority)
  if (result.error) {
    parts.push(`Error: ${result.error}`)
    usedTokens += estimateTokens(result.error)
  }

  // 3. Image paths (tiny, always include)
  if (result.imagePaths && result.imagePaths.length > 0) {
    const imageText = `Images saved:\n${result.imagePaths.map(p => `  - ${p}`).join('\n')}`
    parts.push(imageText)
    usedTokens += estimateTokens(imageText)
  }

  // 4. Output (truncate if needed)
  const remainingTokens = maxTokens - usedTokens - 100
  if (result.output && remainingTokens > 0) {
    const truncated = smartTruncate(result.output, remainingTokens, { label: 'output' })
    parts.push(truncated.text)
    wasTruncated = truncated.wasTruncated
  }

  // 5. Truncation notice
  if (wasTruncated) {
    parts.push('\n[Output truncated to fit token limit. Check sandbox files for full output.]')
  }

  return parts.join('\n')
}
