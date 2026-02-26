/**
 * Types for Exa Search and Datasets Service
 */

// Search options
export interface SearchOptions {
  query: string
  category?: 'company' | 'people' | 'research paper' | 'news' | 'github' | 'pdf' | 'tweet' | 'personal site' | 'financial report'
  numResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  useHighlights?: boolean
}

// Search result
export interface SearchResult {
  url: string
  title?: string
  text?: string
  publishedDate?: string
  author?: string
  highlights?: string[]
  score?: number
}

// Dataset/Webset options
export interface DatasetOptions {
  query: string
  count?: number
  enrichments?: EnrichmentConfig[]
}

// Dataset info
export interface DatasetInfo {
  id: string
  query: string
  status: 'idle' | 'running' | 'completed' | 'error'
  count: number
  createdAt: string
  completedAt?: string
  error?: string
}

// Dataset item
export interface DatasetItem {
  url: string
  title?: string
  text?: string
  publishedDate?: string
  author?: string
  // Enrichment fields are dynamic
  [key: string]: unknown
}

// Enrichment config
export interface EnrichmentConfig {
  description: string
  format: 'text' | 'date' | 'number' | 'email' | 'phone' | 'url'
}

// Connection status
export interface ExaConnectionStatus {
  connected: boolean
  apiKeyConfigured: boolean
}

// Tool info for UI
export interface ExaToolInfo {
  id: string
  name: string
  description: string
  requireApproval: boolean
}
