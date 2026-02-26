/**
 * Docs Service - API wrapper for Google Docs and Sheets operations
 */

import { docs_v1, sheets_v4, google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { DocumentContent, SpreadsheetData, SheetData } from '../types'

export class DocsService {
  private docs: docs_v1.Docs
  private sheets: sheets_v4.Sheets

  constructor(auth: OAuth2Client) {
    this.docs = google.docs({ version: 'v1', auth })
    this.sheets = google.sheets({ version: 'v4', auth })
  }

  /**
   * Read a Google Doc and return its content as plain text
   * @param documentId The document ID
   */
  async readDocument(documentId: string): Promise<DocumentContent> {
    try {
      const response = await this.docs.documents.get({
        documentId
      })

      const doc = response.data
      const title = doc.title || 'Untitled Document'
      const body = this.extractDocumentText(doc)

      return {
        documentId,
        title,
        body
      }
    } catch (error) {
      console.error('[Docs] Read document error:', error)
      throw error
    }
  }

  /**
   * Read a Google Spreadsheet and return its data
   * @param spreadsheetId The spreadsheet ID
   * @param range Optional range (e.g., "Sheet1!A1:D10"). If not provided, reads all sheets.
   */
  async readSpreadsheet(spreadsheetId: string, range?: string): Promise<SpreadsheetData> {
    try {
      // Get spreadsheet metadata
      const metadata = await this.sheets.spreadsheets.get({
        spreadsheetId
      })

      const title = metadata.data.properties?.title || 'Untitled Spreadsheet'
      const sheetNames = metadata.data.sheets?.map(s => ({
        id: s.properties?.sheetId || 0,
        name: s.properties?.title || 'Sheet'
      })) || []

      const sheets: SheetData[] = []

      if (range) {
        // Read specific range
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId,
          range
        })

        sheets.push({
          sheetId: 0, // Unknown for specific range
          title: range,
          data: (response.data.values as string[][]) || []
        })
      } else {
        // Read all sheets
        for (const sheet of sheetNames) {
          try {
            const response = await this.sheets.spreadsheets.values.get({
              spreadsheetId,
              range: sheet.name
            })

            sheets.push({
              sheetId: sheet.id,
              title: sheet.name,
              data: (response.data.values as string[][]) || []
            })
          } catch (err) {
            console.warn(`[Docs] Failed to read sheet ${sheet.name}:`, err)
            // Continue with other sheets
          }
        }
      }

      return {
        spreadsheetId,
        title,
        sheets
      }
    } catch (error) {
      console.error('[Docs] Read spreadsheet error:', error)
      throw error
    }
  }

  /**
   * Extract plain text from a Google Doc
   */
  private extractDocumentText(doc: docs_v1.Schema$Document): string {
    const content = doc.body?.content || []
    let text = ''

    for (const element of content) {
      if (element.paragraph) {
        text += this.extractParagraphText(element.paragraph) + '\n'
      } else if (element.table) {
        text += this.extractTableText(element.table) + '\n'
      } else if (element.sectionBreak) {
        text += '\n---\n'
      }
    }

    return text.trim()
  }

  /**
   * Extract text from a paragraph element
   */
  private extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
    const elements = paragraph.elements || []
    let text = ''

    for (const element of elements) {
      if (element.textRun?.content) {
        text += element.textRun.content
      } else if (element.inlineObjectElement) {
        text += '[Image]'
      }
    }

    return text
  }

  /**
   * Extract text from a table element
   */
  private extractTableText(table: docs_v1.Schema$Table): string {
    const rows = table.tableRows || []
    const lines: string[] = []

    for (const row of rows) {
      const cells = row.tableCells || []
      const cellTexts: string[] = []

      for (const cell of cells) {
        const content = cell.content || []
        let cellText = ''

        for (const element of content) {
          if (element.paragraph) {
            cellText += this.extractParagraphText(element.paragraph)
          }
        }

        cellTexts.push(cellText.trim())
      }

      lines.push('| ' + cellTexts.join(' | ') + ' |')
    }

    return lines.join('\n')
  }
}
