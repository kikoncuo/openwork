/**
 * Markdown-to-Google-Docs Converter
 *
 * Uses the `marked` lexer to parse markdown into structured tokens, then
 * walks the token tree to produce plain text + Google Docs API formatting
 * requests. Tables and images are extracted as metadata so the caller can
 * handle them in separate batchUpdate phases.
 */

import { docs_v1 } from 'googleapis'
import { marked, type Token, type Tokens } from 'marked'

export interface ImageReference {
  /** Character index in the output text where the image placeholder sits */
  index: number
  /** Original file path from the markdown */
  filePath: string
  /** Alt text from the markdown */
  altText: string
}

export interface TableReference {
  /** Character index in the output text where the table placeholder sits */
  index: number
  /** Header cells with parsed text and formatting ranges */
  headers: TableCellContent[]
  /** Data rows — each row is an array of parsed cell content */
  rows: TableCellContent[][]
  /** Number of columns */
  columns: number
  /** Alignment per column */
  alignments: ('left' | 'center' | 'right' | null)[]
}

export interface MarkdownToDocsResult {
  text: string
  requests: docs_v1.Schema$Request[]
  images: ImageReference[]
  tables: TableReference[]
}

// ============================================
// Inline token walker
// ============================================

export interface InlineRange {
  startOffset: number
  endOffset: number
  bold?: boolean
  italic?: boolean
  monospace?: boolean
  link?: string
}

export interface TableCellContent {
  text: string
  ranges: InlineRange[]
}

interface InlineResult {
  text: string
  ranges: InlineRange[]
  images: { offset: number; filePath: string; altText: string }[]
}

/**
 * Walk inline tokens (strong, em, codespan, link, image, text, etc.)
 * and produce clean text + formatting ranges.
 */
function walkInlineTokens(tokens: Token[]): InlineResult {
  const ranges: InlineRange[] = []
  const images: { offset: number; filePath: string; altText: string }[] = []
  let text = ''

  function walk(tokenList: Token[], bold = false, italic = false, link?: string) {
    for (const token of tokenList) {
      switch (token.type) {
        case 'text': {
          const t = token as Tokens.Text
          const content = t.text
          if ((bold || italic || link) && content.length > 0) {
            const start = text.length
            text += content
            const range: InlineRange = { startOffset: start, endOffset: text.length }
            if (bold) range.bold = true
            if (italic) range.italic = true
            if (link) range.link = link
            ranges.push(range)
          } else {
            text += content
          }
          break
        }
        case 'strong': {
          const t = token as Tokens.Strong
          walk(t.tokens, true, italic, link)
          break
        }
        case 'em': {
          const t = token as Tokens.Em
          walk(t.tokens, bold, true, link)
          break
        }
        case 'codespan': {
          const t = token as Tokens.Codespan
          const start = text.length
          text += t.text
          ranges.push({ startOffset: start, endOffset: text.length, monospace: true })
          break
        }
        case 'link': {
          const t = token as Tokens.Link
          walk(t.tokens, bold, italic, t.href)
          break
        }
        case 'image': {
          const t = token as Tokens.Image
          const offset = text.length
          text += '\n'
          images.push({ offset, filePath: t.href, altText: t.text })
          break
        }
        case 'br': {
          text += '\n'
          break
        }
        case 'escape': {
          const t = token as Tokens.Escape
          text += t.text
          break
        }
        default: {
          // Fallback: if token has text property, use it
          if ('text' in token && typeof token.text === 'string') {
            text += token.text
          }
          break
        }
      }
    }
  }

  walk(tokens)
  return { text, ranges, images }
}

// ============================================
// Block token walker
// ============================================

const HEADING_STYLES: Record<number, string> = {
  1: 'HEADING_1', 2: 'HEADING_2', 3: 'HEADING_3',
  4: 'HEADING_4', 5: 'HEADING_5', 6: 'HEADING_6',
}

/**
 * Convert markdown text to Google Docs API plain text + formatting requests.
 *
 * @param markdown - Raw markdown content
 * @param startIndex - Document index where text will be inserted (1 for new/replaced docs)
 * @returns Plain text with markers stripped, formatting requests, and image/table references
 */
export function convertMarkdownToDocs(markdown: string, startIndex: number): MarkdownToDocsResult {
  if (!markdown || !markdown.trim()) {
    return { text: markdown || '', requests: [], images: [], tables: [] }
  }

  const tokens = marked.lexer(markdown)

  let text = ''
  let currentIndex = startIndex
  const paragraphRequests: docs_v1.Schema$Request[] = []
  const bulletRequests: docs_v1.Schema$Request[] = []
  const textStyleRequests: docs_v1.Schema$Request[] = []
  const allImages: ImageReference[] = []
  const allTables: TableReference[] = []

  function emitLine(lineText: string) {
    text += lineText + '\n'
  }

  function processInlineResult(
    result: InlineResult,
    lineStartIndex: number
  ) {
    // Record inline formatting ranges
    for (const range of result.ranges) {
      const rangeStart = lineStartIndex + range.startOffset
      const rangeEnd = lineStartIndex + range.endOffset

      if (range.monospace) {
        textStyleRequests.push({
          updateTextStyle: {
            range: { startIndex: rangeStart, endIndex: rangeEnd },
            textStyle: { weightedFontFamily: { fontFamily: 'Courier New' } },
            fields: 'weightedFontFamily',
          },
        })
      }
      if (range.bold && range.italic) {
        textStyleRequests.push({
          updateTextStyle: {
            range: { startIndex: rangeStart, endIndex: rangeEnd },
            textStyle: { bold: true, italic: true },
            fields: 'bold,italic',
          },
        })
      } else if (range.bold) {
        textStyleRequests.push({
          updateTextStyle: {
            range: { startIndex: rangeStart, endIndex: rangeEnd },
            textStyle: { bold: true },
            fields: 'bold',
          },
        })
      } else if (range.italic) {
        textStyleRequests.push({
          updateTextStyle: {
            range: { startIndex: rangeStart, endIndex: rangeEnd },
            textStyle: { italic: true },
            fields: 'italic',
          },
        })
      }
      if (range.link) {
        textStyleRequests.push({
          updateTextStyle: {
            range: { startIndex: rangeStart, endIndex: rangeEnd },
            textStyle: {
              link: { url: range.link },
              foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.06, green: 0.36 } } },
              underline: true,
            },
            fields: 'link,foregroundColor,underline',
          },
        })
      }
    }

    // Record image references
    for (const img of result.images) {
      allImages.push({
        index: lineStartIndex + img.offset,
        filePath: img.filePath,
        altText: img.altText,
      })
    }
  }

  function walkBlock(tokenList: Token[]) {
    for (const token of tokenList) {
      switch (token.type) {
        case 'heading': {
          const t = token as Tokens.Heading
          const inline = walkInlineTokens(t.tokens)
          const lineStart = currentIndex
          emitLine(inline.text)
          const lineEnd = currentIndex + inline.text.length + 1 // +1 for \n

          paragraphRequests.push({
            updateParagraphStyle: {
              range: { startIndex: lineStart, endIndex: lineEnd },
              paragraphStyle: { namedStyleType: HEADING_STYLES[t.depth] || 'HEADING_1' },
              fields: 'namedStyleType',
            },
          })

          processInlineResult(inline, lineStart)
          currentIndex = lineEnd
          break
        }

        case 'paragraph': {
          const t = token as Tokens.Paragraph
          const inline = walkInlineTokens(t.tokens)
          const lineStart = currentIndex
          emitLine(inline.text)
          const lineEnd = currentIndex + inline.text.length + 1

          processInlineResult(inline, lineStart)
          currentIndex = lineEnd
          break
        }

        case 'list': {
          const t = token as Tokens.List
          const bulletPreset = t.ordered
            ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
            : 'BULLET_DISC_CIRCLE_SQUARE'

          for (const item of t.items) {
            // List items have block-level tokens; the first is usually a 'text' token
            const firstToken = item.tokens?.[0]
            const inlineTokens = firstToken && 'tokens' in firstToken && Array.isArray(firstToken.tokens)
              ? firstToken.tokens as Token[]
              : []
            const inline = walkInlineTokens(
              inlineTokens.length > 0
                ? inlineTokens
                : [{ type: 'text', raw: item.text, text: item.text, escaped: false } as Tokens.Text]
            )
            const lineStart = currentIndex
            emitLine(inline.text)
            const lineEnd = currentIndex + inline.text.length + 1

            bulletRequests.push({
              createParagraphBullets: {
                range: { startIndex: lineStart, endIndex: lineEnd },
                bulletPreset,
              },
            })

            processInlineResult(inline, lineStart)
            currentIndex = lineEnd
          }
          break
        }

        case 'table': {
          const t = token as Tokens.Table
          const tableIndex = currentIndex

          // Walk cell tokens to get clean text + formatting ranges
          const headers = t.header.map((cell: Tokens.TableCell) => {
            const inline = walkInlineTokens(cell.tokens)
            return { text: inline.text, ranges: inline.ranges }
          })
          const columns = headers.length

          const rows = t.rows.map((row: Tokens.TableCell[]) =>
            row.map((cell: Tokens.TableCell) => {
              const inline = walkInlineTokens(cell.tokens)
              return { text: inline.text, ranges: inline.ranges }
            })
          )

          // Extract alignments
          const alignments = t.align.map((a: 'left' | 'center' | 'right' | null) => a)

          // Emit a single \n placeholder
          text += '\n'
          currentIndex += 1

          allTables.push({
            index: tableIndex,
            headers,
            rows,
            columns,
            alignments,
          })
          break
        }

        case 'hr': {
          const hrLine = '───────────────────────────────────────'
          const lineStart = currentIndex
          emitLine(hrLine)
          const lineEnd = currentIndex + hrLine.length + 1

          // Style the hr line with light gray color
          textStyleRequests.push({
            updateTextStyle: {
              range: { startIndex: lineStart, endIndex: lineEnd - 1 },
              textStyle: {
                foregroundColor: { color: { rgbColor: { red: 0.7, green: 0.7, blue: 0.7 } } },
                fontSize: { magnitude: 8, unit: 'PT' },
              },
              fields: 'foregroundColor,fontSize',
            },
          })

          currentIndex = lineEnd
          break
        }

        case 'code': {
          const t = token as Tokens.Code
          const lineStart = currentIndex
          emitLine(t.text)
          const lineEnd = currentIndex + t.text.length + 1

          // Apply monospace font to the entire code block
          textStyleRequests.push({
            updateTextStyle: {
              range: { startIndex: lineStart, endIndex: lineEnd - 1 },
              textStyle: {
                weightedFontFamily: { fontFamily: 'Courier New' },
                fontSize: { magnitude: 9, unit: 'PT' },
              },
              fields: 'weightedFontFamily,fontSize',
            },
          })

          currentIndex = lineEnd
          break
        }

        case 'blockquote': {
          const t = token as Tokens.Blockquote
          // Walk the blockquote's inner tokens
          if (t.tokens) {
            const startPos = currentIndex
            walkBlock(t.tokens)
            // Apply indent to the blockquote content
            if (currentIndex > startPos) {
              paragraphRequests.push({
                updateParagraphStyle: {
                  range: { startIndex: startPos, endIndex: currentIndex },
                  paragraphStyle: { indentStart: { magnitude: 36, unit: 'PT' } },
                  fields: 'indentStart',
                },
              })
            }
          }
          break
        }

        case 'space': {
          // Emit an empty line
          text += '\n'
          currentIndex += 1
          break
        }

        default: {
          // Fallback for unknown token types: emit raw text if available
          if ('text' in token && typeof token.text === 'string' && token.text.trim()) {
            const lineStart = currentIndex
            emitLine(token.text)
            currentIndex = lineStart + token.text.length + 1
          }
          break
        }
      }
    }
  }

  walkBlock(tokens)

  // Remove trailing newline if present (to match previous behavior)
  if (text.endsWith('\n')) {
    text = text.slice(0, -1)
  }

  return {
    text,
    requests: [...paragraphRequests, ...bulletRequests, ...textStyleRequests],
    images: allImages,
    tables: allTables,
  }
}
