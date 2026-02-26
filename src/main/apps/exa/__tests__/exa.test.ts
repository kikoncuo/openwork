/**
 * Tests for Exa Service Implementation
 * Run with: npx ts-node --esm src/main/apps/exa/__tests__/exa.test.ts
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'

// Test utilities
let testsPassed = 0
let testsFailed = 0

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn()
    if (result instanceof Promise) {
      result
        .then(() => {
          console.log(`  ✓ ${name}`)
          testsPassed++
        })
        .catch((err) => {
          console.error(`  ✗ ${name}`)
          console.error(`    Error: ${err.message}`)
          testsFailed++
        })
    } else {
      console.log(`  ✓ ${name}`)
      testsPassed++
    }
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    Error: ${(err as Error).message}`)
    testsFailed++
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`)
  }
}

function assertTrue(value: boolean, message?: string): void {
  if (!value) {
    throw new Error(message || 'Expected true, got false')
  }
}

function assertContains(str: string, substring: string, message?: string): void {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected string to contain "${substring}"`)
  }
}

// ==================== Dataset Store Tests ====================
console.log('\n📦 Testing Dataset Store...\n')

import {
  storeDataset,
  getDataset,
  updateDataset,
  listDatasets,
  removeDataset,
  exportToCSV,
  getDatasetsDir
} from '../dataset-store'
import type { DatasetInfo, DatasetItem } from '../types'

// Test: getDatasetsDir creates directory
test('getDatasetsDir creates the datasets directory', () => {
  const dir = getDatasetsDir()
  const expectedDir = join(homedir(), '.openwork', 'datasets')
  assertEqual(dir, expectedDir)
  assertTrue(existsSync(dir), 'Datasets directory should exist')
})

// Test: storeDataset and getDataset
test('storeDataset and getDataset work correctly', () => {
  const info: DatasetInfo = {
    id: 'test-dataset-1',
    query: 'AI startups in San Francisco',
    status: 'running',
    count: 0,
    createdAt: new Date().toISOString()
  }
  storeDataset(info)
  const retrieved = getDataset('test-dataset-1')
  assertEqual(retrieved?.id, 'test-dataset-1')
  assertEqual(retrieved?.query, 'AI startups in San Francisco')
})

// Test: updateDataset
test('updateDataset updates dataset info', () => {
  updateDataset('test-dataset-1', { status: 'idle', count: 10 })
  const retrieved = getDataset('test-dataset-1')
  assertEqual(retrieved?.status, 'idle')
  assertEqual(retrieved?.count, 10)
})

// Test: listDatasets
test('listDatasets returns all datasets', () => {
  const info2: DatasetInfo = {
    id: 'test-dataset-2',
    query: 'Climate tech companies',
    status: 'idle',
    count: 5,
    createdAt: new Date().toISOString()
  }
  storeDataset(info2)
  const datasets = listDatasets()
  assertTrue(datasets.length >= 2, 'Should have at least 2 datasets')
})

// Test: removeDataset
test('removeDataset removes a dataset', () => {
  removeDataset('test-dataset-2')
  const retrieved = getDataset('test-dataset-2')
  assertEqual(retrieved, undefined)
})

// Test: exportToCSV with basic data
test('exportToCSV creates CSV file with correct content', () => {
  const items: DatasetItem[] = [
    {
      url: 'https://example1.com',
      title: 'Example Company 1',
      text: 'Description of company 1',
      publishedDate: '2024-01-15',
      author: 'John Doe'
    },
    {
      url: 'https://example2.com',
      title: 'Example Company 2',
      text: 'Description of company 2',
      publishedDate: '2024-02-20',
      author: 'Jane Smith'
    }
  ]

  const filepath = exportToCSV('test-companies', items)
  assertTrue(existsSync(filepath), 'CSV file should exist')

  const content = readFileSync(filepath, 'utf-8')
  assertContains(content, 'url,title,text,publishedDate,author')
  assertContains(content, 'https://example1.com')
  assertContains(content, 'Example Company 1')
  assertContains(content, 'https://example2.com')

  console.log(`    CSV file created at: ${filepath}`)
})

// Test: exportToCSV handles special characters
test('exportToCSV escapes special characters correctly', () => {
  const items: DatasetItem[] = [
    {
      url: 'https://example.com',
      title: 'Company with "quotes" and, commas',
      text: 'Description with\nnewlines',
      publishedDate: '2024-01-15',
      author: 'John "JD" Doe'
    }
  ]

  const filepath = exportToCSV('test-special-chars', items)
  const content = readFileSync(filepath, 'utf-8')

  // Quoted fields should have escaped quotes
  assertContains(content, '"Company with ""quotes"" and, commas"')
  assertContains(content, '"John ""JD"" Doe"')

  console.log(`    CSV with special chars created at: ${filepath}`)
})

// Test: exportToCSV handles enrichment columns
test('exportToCSV includes enrichment columns', () => {
  const items: DatasetItem[] = [
    {
      url: 'https://company1.com',
      title: 'Company 1',
      ceo_name: 'Alice Johnson',
      founding_year: 2020
    },
    {
      url: 'https://company2.com',
      title: 'Company 2',
      ceo_name: 'Bob Williams',
      founding_year: 2018
    }
  ]

  const filepath = exportToCSV('test-enrichments', items)
  const content = readFileSync(filepath, 'utf-8')

  // Should have enrichment_ prefixed columns
  assertContains(content, 'enrichment_ceo_name')
  assertContains(content, 'enrichment_founding_year')
  assertContains(content, 'Alice Johnson')
  assertContains(content, '2020')

  console.log(`    CSV with enrichments created at: ${filepath}`)
})

// Test: exportToCSV handles empty items array
test('exportToCSV handles empty items array', () => {
  const items: DatasetItem[] = []
  const filepath = exportToCSV('test-empty', items)
  assertTrue(existsSync(filepath), 'Empty CSV file should exist')

  const content = readFileSync(filepath, 'utf-8')
  assertEqual(content, '')

  console.log(`    Empty CSV file created at: ${filepath}`)
})

// ==================== Types Tests ====================
console.log('\n📋 Testing Types...\n')

import type {
  SearchCategory,
  SearchOptions,
  SearchResult,
  EnrichmentConfig,
  EnrichmentFormat,
  ExaConnectionStatus,
  ExaToolInfo
} from '../types'

test('SearchCategory type includes expected values', () => {
  const categories: SearchCategory[] = [
    'company',
    'research paper',
    'news',
    'github',
    'tweet',
    'personal site',
    'pdf',
    'financial report'
  ]
  assertTrue(categories.length === 8, 'Should have 8 search categories')
})

test('EnrichmentFormat type includes expected values', () => {
  const formats: EnrichmentFormat[] = ['text', 'date', 'number', 'email', 'phone', 'url']
  assertTrue(formats.length === 6, 'Should have 6 enrichment formats')
})

test('SearchOptions interface works correctly', () => {
  const options: SearchOptions = {
    query: 'AI startups',
    category: 'company',
    numResults: 10,
    includeDomains: ['techcrunch.com'],
    excludeDomains: ['wikipedia.org'],
    useHighlights: true
  }
  assertEqual(options.query, 'AI startups')
  assertEqual(options.category, 'company')
})

test('EnrichmentConfig interface works correctly', () => {
  const config: EnrichmentConfig = {
    description: 'CEO name',
    format: 'text'
  }
  assertEqual(config.description, 'CEO name')
  assertEqual(config.format, 'text')
})

// ==================== Tools Tests ====================
console.log('\n🔧 Testing Tools...\n')

import { createExaTools, getExaInterruptTools, getExaToolInfo } from '../tools'

test('createExaTools returns 3 tools', () => {
  const tools = createExaTools()
  assertEqual(tools.length, 3, 'Should create 3 tools')
})

test('createExaTools includes web_search tool', () => {
  const tools = createExaTools()
  const webSearch = tools.find(t => t.name === 'web_search')
  assertTrue(webSearch !== undefined, 'web_search tool should exist')
  assertContains(webSearch!.description, 'Search the web')
})

test('createExaTools includes create_dataset tool', () => {
  const tools = createExaTools()
  const createDataset = tools.find(t => t.name === 'create_dataset')
  assertTrue(createDataset !== undefined, 'create_dataset tool should exist')
  assertContains(createDataset!.description, 'Create a dataset')
})

test('createExaTools includes enrich_dataset tool', () => {
  const tools = createExaTools()
  const enrichDataset = tools.find(t => t.name === 'enrich_dataset')
  assertTrue(enrichDataset !== undefined, 'enrich_dataset tool should exist')
  assertContains(enrichDataset!.description, 'enrichment')
})

test('getExaInterruptTools returns empty array', () => {
  const interruptTools = getExaInterruptTools()
  assertEqual(interruptTools.length, 0, 'Should return empty array (no approval needed)')
})

test('getExaToolInfo returns correct tool info', () => {
  const toolInfo = getExaToolInfo()
  assertEqual(toolInfo.length, 3, 'Should return info for 3 tools')

  const webSearchInfo = toolInfo.find(t => t.id === 'web_search')
  assertTrue(webSearchInfo !== undefined)
  assertEqual(webSearchInfo!.name, 'Web Search')
  assertEqual(webSearchInfo!.requireApproval, false)

  const createDatasetInfo = toolInfo.find(t => t.id === 'create_dataset')
  assertTrue(createDatasetInfo !== undefined)
  assertEqual(createDatasetInfo!.name, 'Create Dataset')

  const enrichDatasetInfo = toolInfo.find(t => t.id === 'enrich_dataset')
  assertTrue(enrichDatasetInfo !== undefined)
  assertEqual(enrichDatasetInfo!.name, 'Enrich Dataset')
})

// ==================== Summary ====================
setTimeout(() => {
  console.log('\n' + '='.repeat(50))
  console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`)

  if (testsFailed > 0) {
    process.exit(1)
  }
}, 100)

// Cleanup test datasets
removeDataset('test-dataset-1')
