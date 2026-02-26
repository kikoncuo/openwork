/**
 * Dataset Store
 * Tracks websets in memory and exports datasets to CSV
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import type { DatasetInfo, DatasetItem } from './types'

// Directory for storing datasets
const DATASETS_DIR = join(homedir(), '.openwork', 'datasets')

// In-memory store for tracking datasets
const datasets = new Map<string, DatasetInfo>()

/**
 * Ensure the datasets directory exists
 */
function ensureDatasetDir(): string {
  if (!existsSync(DATASETS_DIR)) {
    mkdirSync(DATASETS_DIR, { recursive: true })
  }
  return DATASETS_DIR
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
 * Store dataset info in memory
 */
export function storeDataset(info: DatasetInfo): void {
  datasets.set(info.id, info)
}

/**
 * Get dataset info from memory
 */
export function getDataset(id: string): DatasetInfo | undefined {
  return datasets.get(id)
}

/**
 * Update dataset info
 */
export function updateDataset(id: string, updates: Partial<DatasetInfo>): void {
  const existing = datasets.get(id)
  if (existing) {
    datasets.set(id, { ...existing, ...updates })
  }
}

/**
 * List all tracked datasets
 */
export function listDatasets(): DatasetInfo[] {
  return Array.from(datasets.values())
}

/**
 * Remove dataset from memory
 */
export function removeDataset(id: string): void {
  datasets.delete(id)
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
 * Export dataset items to CSV file
 * @returns The path to the exported CSV file
 */
export function exportToCSV(query: string, items: DatasetItem[]): string {
  const dir = ensureDatasetDir()
  const filename = generateFilename(query)
  const filepath = join(dir, filename)

  if (items.length === 0) {
    writeFileSync(filepath, '')
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
  writeFileSync(filepath, csvContent, 'utf-8')

  console.log(`[Dataset Store] Exported ${items.length} items to ${filepath}`)
  return filepath
}

/**
 * Get the datasets directory path
 */
export function getDatasetsDir(): string {
  return ensureDatasetDir()
}
