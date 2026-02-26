/**
 * Gmail Service - API wrapper for Gmail operations
 */

import { gmail_v1, google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { EmailInfo, EmailDetail, SendEmailResult, AttachmentInfo } from '../types'

export class GmailService {
  private gmail: gmail_v1.Gmail

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  /**
   * Search emails using Gmail query syntax
   * @param query Gmail search query (e.g., "from:example@gmail.com", "is:unread", "subject:meeting")
   * @param maxResults Maximum number of results (default: 20)
   */
  async searchEmails(query: string, maxResults: number = 20): Promise<EmailInfo[]> {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
      })

      const messages = response.data.messages || []
      const results: EmailInfo[] = []

      for (const msg of messages) {
        if (!msg.id) continue

        const detail = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        })

        const headers = detail.data.payload?.headers || []
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)'
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown'
        const dateStr = headers.find(h => h.name === 'Date')?.value
        const date = dateStr ? new Date(dateStr).getTime() : Date.now()

        results.push({
          id: msg.id,
          threadId: msg.threadId || msg.id,
          subject,
          from,
          date,
          snippet: detail.data.snippet || ''
        })
      }

      return results
    } catch (error) {
      console.error('[Gmail] Search error:', error)
      throw error
    }
  }

  /**
   * Get full email content by message ID
   */
  async getEmail(messageId: string): Promise<EmailDetail> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      })

      const msg = response.data
      const headers = msg.payload?.headers || []

      const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)'
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown'
      const to = headers.find(h => h.name === 'To')?.value?.split(',').map(s => s.trim()) || []
      const cc = headers.find(h => h.name === 'Cc')?.value?.split(',').map(s => s.trim())
      const dateStr = headers.find(h => h.name === 'Date')?.value
      const date = dateStr ? new Date(dateStr).getTime() : Date.now()

      // Extract body
      const body = this.extractBody(msg.payload)

      // Extract attachments info
      const attachments = this.extractAttachments(msg.payload)

      return {
        id: messageId,
        threadId: msg.threadId || messageId,
        subject,
        from,
        to,
        cc,
        date,
        snippet: msg.snippet || '',
        body,
        attachments: attachments.length > 0 ? attachments : undefined
      }
    } catch (error) {
      console.error('[Gmail] Get email error:', error)
      throw error
    }
  }

  /**
   * Send an email
   */
  async sendEmail(
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string
  ): Promise<SendEmailResult> {
    try {
      // Build email message
      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0'
      ]

      if (cc) {
        messageParts.push(`Cc: ${cc}`)
      }
      if (bcc) {
        messageParts.push(`Bcc: ${bcc}`)
      }

      messageParts.push('', body)
      const message = messageParts.join('\r\n')

      // Encode as base64url
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      })

      return {
        messageId: response.data.id || '',
        threadId: response.data.threadId || ''
      }
    } catch (error) {
      console.error('[Gmail] Send email error:', error)
      throw error
    }
  }

  /**
   * Extract body text from message payload
   */
  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return ''

    // Check for plain text part
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8')
    }

    // Check for HTML part (convert to plain text)
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      const html = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      // Simple HTML to text conversion
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim()
    }

    // Check multipart
    if (payload.parts) {
      // Prefer plain text over HTML
      const plainPart = payload.parts.find(p => p.mimeType === 'text/plain')
      if (plainPart) {
        return this.extractBody(plainPart)
      }

      const htmlPart = payload.parts.find(p => p.mimeType === 'text/html')
      if (htmlPart) {
        return this.extractBody(htmlPart)
      }

      // Recursively check nested parts
      for (const part of payload.parts) {
        const body = this.extractBody(part)
        if (body) return body
      }
    }

    return ''
  }

  /**
   * Extract attachment info from message payload
   */
  private extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
    const attachments: AttachmentInfo[] = []
    if (!payload) return attachments

    // Check current part
    if (payload.filename && payload.body?.attachmentId) {
      attachments.push({
        filename: payload.filename,
        mimeType: payload.mimeType || 'application/octet-stream',
        size: payload.body.size || 0,
        attachmentId: payload.body.attachmentId
      })
    }

    // Check nested parts
    if (payload.parts) {
      for (const part of payload.parts) {
        attachments.push(...this.extractAttachments(part))
      }
    }

    return attachments
  }
}
