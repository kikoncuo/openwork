/**
 * Exa Service Types
 * TypeScript interfaces for search options, results, dataset info, and enrichment configs
 */

// Search categories supported by Exa
export type SearchCategory =
  | 'company'
  | 'research paper'
  | 'news'
  | 'github'
  | 'tweet'
  | 'movie'
  | 'song'
  | 'personal site'
  | 'pdf'
  | 'financial report'
  | 'linkedin profile'

// Search options for web_search tool
export interface SearchOptions {
  query: string
  category?: SearchCategory
  numResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  useHighlights?: boolean
  startPublishedDate?: string
  endPublishedDate?: string
}

// Individual search result
export interface SearchResult {
  url: string
  title: string
  publishedDate?: string
  author?: string
  score?: number
  text?: string
  highlights?: string[]
  summary?: string
}

// Search response from Exa API
export interface SearchResponse {
  results: SearchResult[]
  requestId?: string
}

// Dataset/Webset creation options
export interface DatasetOptions {
  query: string
  count?: number
  enrichments?: EnrichmentConfig[]
}

// Enrichment configuration
export interface EnrichmentConfig {
  description: string
  format: EnrichmentFormat
}

// Enrichment data formats
export type EnrichmentFormat = 'text' | 'date' | 'number' | 'email' | 'phone' | 'url'

// Dataset item from webset
export interface DatasetItem {
  url: string
  title?: string
  text?: string
  publishedDate?: string
  author?: string
  [key: string]: unknown // For enrichment data
}

// Dataset/Webset info
export interface DatasetInfo {
  id: string
  query: string
  status: 'running' | 'idle' | 'paused' | 'canceled'
  count: number
  createdAt: string
  completedAt?: string
  items?: DatasetItem[]
  enrichments?: string[]
}

// Connection status for the Exa service
export interface ExaConnectionStatus {
  connected: boolean
  apiKeyConfigured: boolean
  error?: string
}

// Tool info for UI display
export interface ExaToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
}

// Error types for better error handling
export type ExaErrorType =
  | 'unauthorized'
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'insufficient_credits'
  | 'not_connected'
  | 'unknown'

export interface ExaError {
  type: ExaErrorType
  message: string
  retryable: boolean
}
