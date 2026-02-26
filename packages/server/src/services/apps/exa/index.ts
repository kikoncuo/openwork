/**
 * Exa Service - Search and Datasets integration
 * Server-side implementation using exa-js SDK
 */

import Exa from 'exa-js'
import type { SandboxFileAccess } from '../../agent/sandbox-file-access.js'
import { getExaAuthStore } from './auth-store.js'
import type {
  ExaConnectionStatus,
  SearchOptions,
  SearchResult,
  DatasetOptions,
  DatasetInfo,
  DatasetItem,
  EnrichmentConfig
} from './types.js'

export type {
  ExaConnectionStatus,
  SearchOptions,
  SearchResult,
  DatasetOptions,
  DatasetInfo,
  DatasetItem,
  EnrichmentConfig
}

// API key from environment
const EXA_API_KEY = process.env.EXA_API_KEY || ''

// E2B workspace path for files
const E2B_WORKSPACE = '/home/user'

// Log credential status at module load
console.log('[Exa] API key configured:', EXA_API_KEY ? 'SET' : 'NOT SET')

type ConnectionCallback = (status: ExaConnectionStatus) => void

interface UserConnection {
  client: Exa
  callbacks: Set<ConnectionCallback>
}

// In-memory dataset store (per user)
const datasets = new Map<string, Map<string, DatasetInfo>>()

function getUserDatasets(userId: string): Map<string, DatasetInfo> {
  let userDatasets = datasets.get(userId)
  if (!userDatasets) {
    userDatasets = new Map()
    datasets.set(userId, userDatasets)
  }
  return userDatasets
}

/**
 * Generate a filename from query slug
 */
function generateFilename(query: string): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  const date = new Date().toISOString().split('T')[0]
  return `${slug}-${date}.csv`
}

/**
 * Escape CSV field value
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const str = String(value)
  // If contains comma, newline, or quotes, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Export dataset items to CSV file via file access abstraction
 * @returns The path to the exported CSV file (in workspace format)
 */
async function exportToCSV(fileAccess: SandboxFileAccess, query: string, items: DatasetItem[]): Promise<string> {
  const filename = generateFilename(query)
  const filepath = `${E2B_WORKSPACE}/${filename}`

  if (items.length === 0) {
    await fileAccess.saveFile(filepath, '')
    return filepath
  }

  // Collect all unique column names
  const standardColumns = ['url', 'title', 'text', 'publishedDate', 'author']
  const enrichmentColumns: string[] = []

  // Find enrichment columns (any key not in standard columns)
  for (const item of items) {
    for (const key of Object.keys(item)) {
      const enrichmentColName = `enrichment_${key}`
      if (!standardColumns.includes(key) && !enrichmentColumns.includes(enrichmentColName)) {
        enrichmentColumns.push(enrichmentColName)
      }
    }
  }

  const allColumns = [...standardColumns, ...enrichmentColumns]

  // Create CSV header
  const header = allColumns.map(escapeCsvField).join(',')

  // Create CSV rows
  const rows = items.map(item => {
    return allColumns.map(col => {
      if (col.startsWith('enrichment_')) {
        const enrichmentKey = col.replace('enrichment_', '')
        return escapeCsvField(item[enrichmentKey])
      }
      return escapeCsvField(item[col as keyof DatasetItem])
    }).join(',')
  })

  const csvContent = [header, ...rows].join('\n')
  await fileAccess.saveFile(filepath, csvContent)

  console.log(`[Exa] Exported ${items.length} items to ${filepath}`)
  return filepath
}

class ExaService {
  // Map of userId -> connection
  private connections = new Map<string, UserConnection>()
  private initialized = false

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    console.log('[Exa] Initializing service...')

    if (!EXA_API_KEY) {
      console.warn('[Exa] API key not configured. Set EXA_API_KEY in .env')
    } else {
      console.log('[Exa] API key configured')
    }

    this.initialized = true
    console.log('[Exa] Service initialized')
  }

  /**
   * Connect to Exa API for a user
   */
  async connect(userId: string, apiKey?: string): Promise<void> {
    await this.initialize()

    const key = apiKey || EXA_API_KEY
    if (!key) {
      throw new Error('No API key provided. Set EXA_API_KEY in .env or provide one.')
    }

    try {
      // Create Exa client
      const client = new Exa(key)

      // Test connection with a simple search
      await client.searchAndContents('test', { numResults: 1, text: true })

      // Persist API key to DB for session restore
      const authStore = getExaAuthStore()
      await authStore.saveApiKey(userId, key)

      // Store connection - preserve existing callbacks
      const existing = this.connections.get(userId)
      this.connections.set(userId, {
        client,
        callbacks: existing?.callbacks || new Set()
      })

      // Notify connection change
      await this.notifyConnectionChange(userId)
      console.log(`[Exa] Connected for user ${userId}`)
    } catch (error) {
      console.error('[Exa] Connection failed:', error)
      throw new Error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Disconnect from Exa API for a user
   */
  async disconnect(userId: string): Promise<void> {
    // Clear persisted credentials
    const authStore = getExaAuthStore()
    await authStore.clearApiKey(userId)

    this.connections.delete(userId)
    await this.notifyConnectionChange(userId)
    console.log(`[Exa] Disconnected user ${userId}`)
  }

  /**
   * Check if user is connected
   */
  isConnected(userId: string): boolean {
    const connection = this.connections.get(userId)
    return connection?.client != null
  }

  /**
   * Restore session from stored API key
   */
  private async restoreSession(userId: string): Promise<boolean> {
    console.log(`[Exa] Attempting to restore session for user ${userId}`)
    try {
      const authStore = getExaAuthStore()
      const apiKey = await authStore.getApiKey(userId)

      if (!apiKey) {
        return false
      }

      const client = new Exa(apiKey)

      // Test connection to verify the key is still valid
      try {
        await client.searchAndContents('test', { numResults: 1, text: true })
      } catch (testError) {
        console.warn(`[Exa] Stored API key is no longer valid for user ${userId}:`, testError)
        await authStore.clearApiKey(userId)
        return false
      }

      // Store connection - preserve existing callbacks
      const existing = this.connections.get(userId)
      this.connections.set(userId, {
        client,
        callbacks: existing?.callbacks || new Set()
      })

      console.log(`[Exa] Session restored for user ${userId}`)
      return true
    } catch (error) {
      console.error(`[Exa] restoreSession error for user ${userId}:`, error)
      return false
    }
  }

  /**
   * Get connection status for a user
   * If not connected in memory, attempts to restore from stored credentials
   */
  async getConnectionStatus(userId: string): Promise<ExaConnectionStatus> {
    const connected = this.isConnected(userId)

    if (!connected) {
      try {
        const restored = await this.restoreSession(userId)
        if (!restored) {
          return {
            connected: false,
            apiKeyConfigured: !!EXA_API_KEY
          }
        }
      } catch (restoreError) {
        console.error('[Exa] Error restoring session:', restoreError)
        return {
          connected: false,
          apiKeyConfigured: !!EXA_API_KEY
        }
      }
    }

    return {
      connected: true,
      apiKeyConfigured: true
    }
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(userId: string, callback: ConnectionCallback): () => void {
    let connection = this.connections.get(userId)
    if (!connection) {
      connection = { client: null as unknown as Exa, callbacks: new Set() }
      this.connections.set(userId, connection)
    }
    connection.callbacks.add(callback)

    return () => {
      const conn = this.connections.get(userId)
      if (conn) {
        conn.callbacks.delete(callback)
      }
    }
  }

  /**
   * Notify connection change callbacks
   */
  private async notifyConnectionChange(userId: string): Promise<void> {
    const status = await this.getConnectionStatus(userId)
    const connection = this.connections.get(userId)
    if (connection) {
      for (const callback of connection.callbacks) {
        try {
          callback(status)
        } catch (error) {
          console.error('[Exa] Connection callback error:', error)
        }
      }
    }
  }

  /**
   * Get Exa client for a user
   */
  private getClient(userId: string): Exa {
    const connection = this.connections.get(userId)
    if (!connection?.client) {
      throw new Error('Exa is not connected. Please connect in Settings > Apps.')
    }
    return connection.client
  }

  // ============= SEARCH METHODS =============

  /**
   * Perform a web search
   */
  async search(userId: string, options: SearchOptions): Promise<SearchResult[]> {
    const client = this.getClient(userId)

    // Build search options - use any to avoid complex type issues with SDK
    const searchOptions: any = {
      numResults: options.numResults || 10,
      text: true
    }

    if (options.category) {
      searchOptions.category = options.category
    }
    if (options.includeDomains && options.includeDomains.length > 0) {
      searchOptions.includeDomains = options.includeDomains
    }
    if (options.excludeDomains && options.excludeDomains.length > 0) {
      searchOptions.excludeDomains = options.excludeDomains
    }
    if (options.useHighlights) {
      searchOptions.highlights = true
    }

    const response = await client.searchAndContents(options.query, searchOptions)

    return response.results.map((result: any) => ({
      url: result.url,
      title: result.title || undefined,
      text: result.text || undefined,
      publishedDate: result.publishedDate || undefined,
      author: result.author || undefined,
      highlights: result.highlights || undefined,
      score: result.score || undefined
    }))
  }

  // ============= DATASET METHODS =============

  /**
   * Create a dataset (webset)
   */
  async createDataset(userId: string, options: DatasetOptions): Promise<DatasetInfo> {
    const client = this.getClient(userId)

    try {
      // Create webset
      const webset = await client.websets.create({
        search: {
          query: options.query,
          count: options.count || 10
        }
      })

      const info: DatasetInfo = {
        id: webset.id,
        query: options.query,
        status: webset.status as DatasetInfo['status'],
        count: 0,
        createdAt: new Date().toISOString()
      }

      // Store in memory
      const userDatasets = getUserDatasets(userId)
      userDatasets.set(info.id, info)

      return info
    } catch (error) {
      console.error('[Exa] Create dataset error:', error)
      throw new Error(`Failed to create dataset: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Wait for dataset to complete
   */
  async waitForDataset(userId: string, datasetId: string, timeout = 180000): Promise<DatasetInfo> {
    const client = this.getClient(userId)

    try {
      const webset = await client.websets.waitUntilIdle(datasetId, { timeout })

      const userDatasets = getUserDatasets(userId)
      const existingInfo = userDatasets.get(datasetId)

      // Get item count from searches if available
      const searches = (webset as any).searches
      const itemCount = searches?.[0]?.count || searches?.[0]?.numResults || 0

      const info: DatasetInfo = {
        id: webset.id,
        query: existingInfo?.query || 'Unknown',
        status: webset.status as DatasetInfo['status'],
        count: itemCount,
        createdAt: existingInfo?.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString()
      }

      userDatasets.set(datasetId, info)
      return info
    } catch (error) {
      console.error('[Exa] Wait for dataset error:', error)
      throw new Error(`Failed to wait for dataset: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get dataset items
   */
  async getDatasetItems(userId: string, datasetId: string): Promise<DatasetItem[]> {
    const client = this.getClient(userId)

    try {
      const response = await client.websets.items.list(datasetId)

      return response.data.map((item: any) => {
        // Extract properties from the item - the structure may vary
        const source = item.source || item.sourceUrl || ''
        const properties = item.entity?.properties || item.properties || {}

        return {
          url: source,
          title: properties.title as string | undefined,
          text: properties.text as string | undefined,
          publishedDate: properties.publishedDate as string | undefined,
          author: properties.author as string | undefined,
          // Include enrichment results if present
          ...(item.enrichments ? Object.fromEntries(
            item.enrichments
              .filter((e: any) => e.result && e.result.length > 0)
              .map((e: any) => [e.enrichmentId || 'enrichment', e.result[0]])
          ) : {}),
          ...Object.fromEntries(
            Object.entries(properties).filter(
              ([key]) => !['title', 'text', 'publishedDate', 'author'].includes(key)
            )
          )
        }
      })
    } catch (error) {
      console.error('[Exa] Get dataset items error:', error)
      throw new Error(`Failed to get dataset items: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Add enrichments to a dataset
   */
  async enrichDataset(
    userId: string,
    datasetId: string,
    enrichments: EnrichmentConfig[]
  ): Promise<DatasetInfo> {
    const client = this.getClient(userId)

    try {
      // Add each enrichment
      for (const enrichment of enrichments) {
        await client.websets.enrichments.create(datasetId, {
          description: enrichment.description,
          format: enrichment.format as any
        })
      }

      // Wait for webset to process enrichments
      const webset = await client.websets.waitUntilIdle(datasetId, { timeout: 180000 })

      const userDatasets = getUserDatasets(userId)
      const existingInfo = userDatasets.get(datasetId)

      // Get item count from searches if available
      const searches = (webset as any).searches
      const itemCount = searches?.[0]?.count || searches?.[0]?.numResults || 0

      const info: DatasetInfo = {
        id: webset.id,
        query: existingInfo?.query || 'Unknown',
        status: webset.status as DatasetInfo['status'],
        count: itemCount,
        createdAt: existingInfo?.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString()
      }

      userDatasets.set(datasetId, info)
      return info
    } catch (error) {
      console.error('[Exa] Enrich dataset error:', error)
      throw new Error(`Failed to enrich dataset: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Export dataset to CSV via file access abstraction
   */
  async exportDatasetAsCSV(userId: string, fileAccess: SandboxFileAccess, datasetId: string): Promise<string> {
    const items = await this.getDatasetItems(userId, datasetId)
    const userDatasets = getUserDatasets(userId)
    const info = userDatasets.get(datasetId)
    const query = info?.query || `dataset-${datasetId}`

    return exportToCSV(fileAccess, query, items)
  }

  /**
   * Export search results to CSV via file access abstraction
   */
  async exportSearchResultsAsCSV(fileAccess: SandboxFileAccess, query: string, results: SearchResult[]): Promise<string> {
    const items: DatasetItem[] = results.map(r => ({
      url: r.url,
      title: r.title,
      text: r.text?.substring(0, 500), // Truncate for CSV
      publishedDate: r.publishedDate,
      author: r.author
    }))
    return exportToCSV(fileAccess, query, items)
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.connections.clear()
    this.initialized = false
    console.log('[Exa] Service shutdown')
  }
}

// Singleton instance
export const exaService = new ExaService()
