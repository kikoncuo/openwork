/**
 * Drive Service - API wrapper for Google Drive operations
 */

import { drive_v3, google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { DriveFile } from '../types'

export class DriveService {
  private drive: drive_v3.Drive

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: 'v3', auth })
  }

  /**
   * List files in Drive, optionally filtered by query or folder
   * @param query Optional Drive API query (e.g., "name contains 'report'", "mimeType='application/pdf'")
   * @param folderId Optional folder ID to list files from
   * @param maxResults Maximum number of results (default: 50)
   */
  async listFiles(
    query?: string,
    folderId?: string,
    maxResults: number = 50
  ): Promise<DriveFile[]> {
    try {
      let q = "trashed = false"

      if (folderId) {
        q += ` and '${folderId}' in parents`
      }

      if (query) {
        q += ` and ${query}`
      }

      const response = await this.drive.files.list({
        q,
        pageSize: maxResults,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
        orderBy: 'modifiedTime desc'
      })

      const files = response.data.files || []
      return files.map(file => this.mapFile(file))
    } catch (error) {
      console.error('[Drive] List files error:', error)
      throw error
    }
  }

  /**
   * Search files by name
   * @param searchTerm Term to search for in file names
   * @param maxResults Maximum number of results (default: 50)
   */
  async searchFiles(searchTerm: string, maxResults: number = 50): Promise<DriveFile[]> {
    return this.listFiles(`name contains '${searchTerm.replace(/'/g, "\\'")}'`, undefined, maxResults)
  }

  /**
   * Get file content by ID
   * Only works for text-based files (documents, sheets, code files, etc.)
   * @param fileId File ID
   */
  async getFileContent(fileId: string): Promise<string> {
    try {
      // First get file metadata to determine type
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'mimeType, name'
      })

      const mimeType = metadata.data.mimeType || ''

      // Handle Google Docs native formats by exporting
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain'
        })
        return String(response.data)
      }

      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/csv'
        })
        return String(response.data)
      }

      if (mimeType === 'application/vnd.google-apps.presentation') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain'
        })
        return String(response.data)
      }

      // For regular files, download content
      const response = await this.drive.files.get({
        fileId,
        alt: 'media'
      }, {
        responseType: 'text'
      })

      return String(response.data)
    } catch (error) {
      console.error('[Drive] Get file content error:', error)
      throw error
    }
  }

  /**
   * Get file metadata by ID
   */
  async getFileMetadata(fileId: string): Promise<DriveFile> {
    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, modifiedTime, webViewLink'
      })

      return this.mapFile(response.data)
    } catch (error) {
      console.error('[Drive] Get file metadata error:', error)
      throw error
    }
  }

  /**
   * Map Google Drive file to our DriveFile type
   */
  private mapFile(file: drive_v3.Schema$File): DriveFile {
    return {
      id: file.id || '',
      name: file.name || 'Untitled',
      mimeType: file.mimeType || 'application/octet-stream',
      size: file.size ? parseInt(file.size, 10) : undefined,
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      webViewLink: file.webViewLink || undefined
    }
  }
}
