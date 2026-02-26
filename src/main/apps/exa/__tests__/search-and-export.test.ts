/**
 * Search and Export Test
 * Tests the full flow: search -> export to CSV
 * Run with: npx tsx src/main/apps/exa/__tests__/search-and-export.test.ts
 */

import { existsSync, readFileSync } from 'fs'
import { exaService } from '../index'
import { exportToCSV, storeDataset } from '../dataset-store'
import { getApiKey } from '../../../storage'
import type { DatasetInfo, DatasetItem } from '../types'

async function main(): Promise<void> {
  console.log('\n🔍 Search and Export Test\n')

  // Check API key
  const apiKey = getApiKey('exa')
  if (!apiKey) {
    console.log('❌ No EXA_API_KEY found in ~/.openwork/.env')
    return
  }

  try {
    // Connect
    console.log('1. Connecting to API...')
    await exaService.connect(apiKey)
    console.log('   ✓ Connected\n')

    // Search
    console.log('2. Searching for "climate tech startups 2024"...')
    const results = await exaService.search({
      query: 'climate tech startups 2024',
      numResults: 10,
      useHighlights: true
    })
    console.log(`   ✓ Found ${results.length} results\n`)

    // Display results
    console.log('3. Search Results:')
    console.log('   ' + '-'.repeat(60))
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.title || 'Untitled'}`)
      console.log(`      URL: ${r.url}`)
      if (r.publishedDate) console.log(`      Date: ${r.publishedDate}`)
      console.log()
    })

    // Convert search results to dataset items
    const items: DatasetItem[] = results.map(r => ({
      url: r.url,
      title: r.title,
      text: r.text?.substring(0, 500), // Truncate for CSV
      publishedDate: r.publishedDate,
      author: r.author
    }))

    // Store dataset info
    const datasetInfo: DatasetInfo = {
      id: `search-${Date.now()}`,
      query: 'climate tech startups 2024',
      status: 'idle',
      count: items.length,
      createdAt: new Date().toISOString()
    }
    storeDataset(datasetInfo)

    // Export to CSV
    console.log('4. Exporting to CSV...')
    const csvPath = exportToCSV('climate-tech-startups-2024', items)
    console.log(`   ✓ Exported to: ${csvPath}\n`)

    // Verify CSV
    console.log('5. Verifying CSV content:')
    const csvContent = readFileSync(csvPath, 'utf-8')
    const lines = csvContent.split('\n').filter(l => l.trim())
    console.log(`   ✓ CSV has ${lines.length} lines (1 header + ${lines.length - 1} data rows)`)
    console.log(`   ✓ File size: ${csvContent.length} bytes\n`)

    // Show CSV preview
    console.log('6. CSV Preview (first 5 lines):')
    console.log('   ' + '-'.repeat(60))
    lines.slice(0, 5).forEach((line, i) => {
      const truncated = line.length > 100 ? line.substring(0, 100) + '...' : line
      console.log(`   ${truncated}`)
    })
    console.log()

    // Disconnect
    await exaService.disconnect()
    console.log('✅ Test completed successfully!')
    console.log(`\n📁 CSV file saved at: ${csvPath}\n`)

  } catch (error) {
    console.error('❌ Error:', (error as Error).message)
    await exaService.disconnect()
  }
}

main()
