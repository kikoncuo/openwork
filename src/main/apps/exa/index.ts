/**
 * Exa Service - Main entry point for Search and Datasets integration
 * Provides web search and dataset creation capabilities using the Exa API
 */

import Exa from 'exa-js'
import { getApiKey } from '../../storage'
import { storeDataset, updateDataset, exportToCSV } from './dataset-store'
import type {
  ExaConnectionStatus,
  SearchOptions,
  SearchResult,
  DatasetOptions,
  DatasetInfo,
  DatasetItem,
  EnrichmentConfig,
  ExaError
} from './types'

// Type definitions for Exa SDK types
interface ExaSearchResult {
  url: string
  title?: string
  publishedDate?: string
  author?: string
  score?: number
  text?: string
  highlights?: string[]
  summary?: string
}

interface ExaWebsetItem {
  url: string
  title?: string
  text?: string
  publishedDate?: string
  author?: string
  enrichmentResults?: Array<{
    enrichmentId: string
    value: unknown
  }>
  [key: string]: unknown
}

interface ExaWebset {
  id: string
  status: 'running' | 'idle' | 'paused' | 'canceled'
  numItems?: number
  searches?: Array<{ query: string }>
  createdAt?: string
  items?: ExaWebsetItem[]
}

type ConnectionCallback = (status: ExaConnectionStatus) => void

/**
 * Parse Exa API errors into a standardized format
 */
function parseExaError(error: unknown): ExaError {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('401') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('invalid api key')) {
    return { type: 'unauthorized', message: 'Invalid API key. Please check your API key.', retryable: false }
  }

  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return { type: 'rate_limit', message: 'Rate limit reached. Please wait and try again.', retryable: true }
  }

  if (message.includes('5') && message.includes('00')) {
    return { type: 'server_error', message: 'Service is temporarily unavailable. Please try again later.', retryable: true }
  }

  if (message.toLowerCase().includes('timeout')) {
    return { type: 'timeout', message: 'Operation timed out. The dataset may still be processing.', retryable: true }
  }

  if (message.toLowerCase().includes('credit') || message.toLowerCase().includes('insufficient')) {
    return { type: 'insufficient_credits', message: 'Insufficient credits. Please check your account.', retryable: false }
  }

  return { type: 'unknown', message, retryable: false }
}

class ExaService {
  private client: Exa | null = null
  private initialized = false
  private connectionCallbacks = new Set<ConnectionCallback>()

  /**
   * Initialize the Exa service
   * Called lazily on first use
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[Search & Datasets] Initializing service...')

    const apiKey = getApiKey('exa')
    if (apiKey) {
      console.log('[Search & Datasets] Found API key, creating client...')
      this.client = new Exa(apiKey)
    }

    this.initialized = true
    console.log('[Search & Datasets] Service initialized')
  }

  /**
   * Connect with API key
   * @param apiKey - The API key
   */
  async connect(apiKey?: string): Promise<void> {
    const key = apiKey || getApiKey('exa')

    if (!key) {
      throw new Error('No API key provided. Please configure your API key in Settings > Apps.')
    }

    console.log('[Search & Datasets] Connecting...')

    // Create new client with the API key
    this.client = new Exa(key)

    // Test the connection with a simple search
    try {
      await this.client.searchAndContents('test', { numResults: 1 })
      console.log('[Search & Datasets] Connection successful')
      this.notifyConnectionChange()
    } catch (error) {
      this.client = null
      const exaError = parseExaError(error)
      console.error('[Search & Datasets] Connection failed:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Disconnect and clear client
   */
  async disconnect(): Promise<void> {
    this.client = null
    this.notifyConnectionChange()
    console.log('[Search & Datasets] Disconnected')
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client !== null
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<ExaConnectionStatus> {
    const apiKeyConfigured = !!getApiKey('exa')
    return {
      connected: this.isConnected(),
      apiKeyConfigured
    }
  }

  /**
   * Register connection change callback
   */
  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback)
    return () => {
      this.connectionCallbacks.delete(callback)
    }
  }

  /**
   * Notify all connection change callbacks
   */
  private async notifyConnectionChange(): Promise<void> {
    const status = await this.getConnectionStatus()
    for (const callback of this.connectionCallbacks) {
      try {
        callback(status)
      } catch (error) {
        console.error('[Search & Datasets] Connection callback error:', error)
      }
    }
  }

  /**
   * Search the web
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.client) {
      throw new Error('Search and Datasets is not connected. Please connect in Settings > Apps.')
    }

    console.log('[Search & Datasets] Searching:', options.query)

    try {
      const searchParams: Record<string, unknown> = {
        numResults: options.numResults || 10
      }

      if (options.category) {
        searchParams.category = options.category
      }
      if (options.includeDomains && options.includeDomains.length > 0) {
        searchParams.includeDomains = options.includeDomains
      }
      if (options.excludeDomains && options.excludeDomains.length > 0) {
        searchParams.excludeDomains = options.excludeDomains
      }
      if (options.startPublishedDate) {
        searchParams.startPublishedDate = options.startPublishedDate
      }
      if (options.endPublishedDate) {
        searchParams.endPublishedDate = options.endPublishedDate
      }

      // Use highlights if requested
      if (options.useHighlights) {
        searchParams.highlights = true
      }

      const response = await this.client.searchAndContents(options.query, searchParams)

      const results: SearchResult[] = (response.results as ExaSearchResult[]).map((r) => ({
        url: r.url,
        title: r.title || '',
        publishedDate: r.publishedDate,
        author: r.author,
        score: r.score,
        text: r.text,
        highlights: r.highlights,
        summary: r.summary
      }))

      console.log(`[Search & Datasets] Search returned ${results.length} results`)
      return results
    } catch (error) {
      const exaError = parseExaError(error)
      console.error('[Search & Datasets] Search error:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Create a dataset (webset) for the given query
   */
  async createDataset(options: DatasetOptions): Promise<DatasetInfo> {
    if (!this.client) {
      throw new Error('Search and Datasets is not connected. Please connect in Settings > Apps.')
    }

    console.log('[Search & Datasets] Creating dataset:', options.query)

    try {
      // Create webset using the websets API
      const webset = await this.client.websets.create({
        search: {
          query: options.query,
          count: options.count || 10
        }
      }) as unknown as ExaWebset

      const info: DatasetInfo = {
        id: webset.id,
        query: options.query,
        status: webset.status,
        count: webset.numItems || 0,
        createdAt: webset.createdAt || new Date().toISOString()
      }

      // Store in memory
      storeDataset(info)

      console.log(`[Search & Datasets] Dataset created with ID: ${webset.id}`)
      return info
    } catch (error) {
      const exaError = parseExaError(error)
      console.error('[Search & Datasets] Create dataset error:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Wait for a dataset to complete processing
   * @param id - Dataset/Webset ID
   * @param timeout - Timeout in milliseconds (default 180000 = 3 minutes)
   */
  async waitForDataset(id: string, timeout: number = 180000): Promise<DatasetInfo> {
    if (!this.client) {
      throw new Error('Search and Datasets is not connected. Please connect in Settings > Apps.')
    }

    console.log(`[Search & Datasets] Waiting for dataset ${id} to complete...`)

    try {
      // Wait for webset to be idle using the websets API
      await this.client.websets.waitUntilIdle(id, { timeout })

      // Get updated webset data
      const updatedWebset = await this.client.websets.get(id) as unknown as ExaWebset

      const info: DatasetInfo = {
        id: updatedWebset.id,
        query: updatedWebset.searches?.[0]?.query || '',
        status: updatedWebset.status,
        count: updatedWebset.numItems || 0,
        createdAt: updatedWebset.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString()
      }

      updateDataset(id, info)
      console.log(`[Search & Datasets] Dataset ${id} completed with ${info.count} items`)
      return info
    } catch (error) {
      const exaError = parseExaError(error)
      if (exaError.type === 'timeout') {
        console.log(`[Search & Datasets] Dataset ${id} timed out but may still be processing`)
        return {
          id,
          query: '',
          status: 'running',
          count: 0,
          createdAt: new Date().toISOString()
        }
      }
      console.error('[Search & Datasets] Wait for dataset error:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Get items from a dataset
   */
  async getDatasetItems(id: string): Promise<DatasetItem[]> {
    if (!this.client) {
      throw new Error('Search and Datasets is not connected. Please connect in Settings > Apps.')
    }

    console.log(`[Search & Datasets] Getting items for dataset ${id}`)

    try {
      // Get items using the websets.items API
      const response = await this.client.websets.items.list(id)

      // Access items from the response
      const items: ExaWebsetItem[] = (response as unknown as { data: ExaWebsetItem[] }).data || []

      const datasetItems: DatasetItem[] = items.map((item) => {
        const datasetItem: DatasetItem = {
          url: item.url,
          title: item.title,
          text: item.text,
          publishedDate: item.publishedDate,
          author: item.author
        }

        // Add enrichment results if present
        if (item.enrichmentResults) {
          for (const enrichment of item.enrichmentResults) {
            datasetItem[enrichment.enrichmentId] = enrichment.value
          }
        }

        return datasetItem
      })

      console.log(`[Search & Datasets] Retrieved ${datasetItems.length} items from dataset ${id}`)
      return datasetItems
    } catch (error) {
      const exaError = parseExaError(error)
      console.error('[Search & Datasets] Get dataset items error:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Add enrichments to a dataset
   */
  async enrichDataset(id: string, enrichments: EnrichmentConfig[]): Promise<DatasetInfo> {
    if (!this.client) {
      throw new Error('Search and Datasets is not connected. Please connect in Settings > Apps.')
    }

    console.log(`[Search & Datasets] Adding ${enrichments.length} enrichments to dataset ${id}`)

    try {
      // Add each enrichment using the websets.enrichments API
      for (const enrichment of enrichments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.client.websets.enrichments.create(id, {
          description: enrichment.description,
          format: enrichment.format
        } as any)
      }

      // Wait for enrichment to complete
      const updatedInfo = await this.waitForDataset(id)
      updatedInfo.enrichments = enrichments.map(e => e.description)

      updateDataset(id, updatedInfo)
      return updatedInfo
    } catch (error) {
      const exaError = parseExaError(error)
      console.error('[Search & Datasets] Enrich dataset error:', exaError.message)
      throw new Error(exaError.message)
    }
  }

  /**
   * Export a dataset to CSV file
   * @returns The path to the exported CSV file
   */
  async exportDatasetAsCSV(id: string): Promise<string> {
    console.log(`[Search & Datasets] Exporting dataset ${id} to CSV`)

    // Get items
    const items = await this.getDatasetItems(id)

    // Get the query from stored dataset info
    const storedInfo = (await import('./dataset-store')).getDataset(id)
    const query = storedInfo?.query || `dataset-${id}`

    // Export to CSV
    const filepath = exportToCSV(query, items)

    console.log(`[Search & Datasets] Dataset exported to: ${filepath}`)
    return filepath
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.client = null
    this.initialized = false
    console.log('[Search & Datasets] Service shutdown')
  }
}

// Singleton instance
export const exaService = new ExaService()

// Re-export types
export type { ExaConnectionStatus, SearchResult, DatasetInfo, DatasetItem, EnrichmentConfig }
