/**
 * Exa Agent Tools
 * Tools for the agent to perform web search and dataset operations
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { exaService } from './index'
import type { ExaToolInfo } from './types'

/**
 * Create Exa tools for the agent
 * These tools allow the agent to search the web and create datasets
 */
export function createExaTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = []

  // Tool 1: Web Search
  tools.push(
    new DynamicStructuredTool({
      name: 'web_search',
      description: `Search the web for current information using natural language queries.
This tool provides real-time web search results with content from the pages.
Use this to find recent information, research topics, or discover companies/people.

Categories available:
- company: Business websites and company pages
- research paper: Academic publications
- news: News articles (recent events)
- github: Code repositories
- tweet: Twitter/X posts
- personal site: Blogs and personal websites
- pdf: PDF documents
- financial report: SEC filings and financial reports

IMPORTANT: This tool only works if Search and Datasets is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('The search query - use natural language to describe what you\'re looking for'),
        category: z.enum([
          'company',
          'research paper',
          'news',
          'github',
          'tweet',
          'personal site',
          'pdf',
          'financial report'
        ]).optional().describe('Optional category to filter results'),
        numResults: z.number().min(1).max(50).optional().default(10).describe('Number of results to return (default: 10, max: 50)'),
        includeDomains: z.array(z.string()).optional().describe('Only include results from these domains (e.g., ["github.com", "arxiv.org"])'),
        excludeDomains: z.array(z.string()).optional().describe('Exclude results from these domains'),
        useHighlights: z.boolean().optional().default(true).describe('Include highlighted excerpts from pages (default: true)')
      }),
      func: async ({ query, category, numResults, includeDomains, excludeDomains, useHighlights }) => {
        if (!exaService.isConnected()) {
          return 'Search and Datasets is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          const results = await exaService.search({
            query,
            category,
            numResults,
            includeDomains,
            excludeDomains,
            useHighlights
          })

          if (results.length === 0) {
            return `No results found for "${query}". Try broadening your search query.`
          }

          // Format results for display
          const formattedResults = results.map((r, i) => {
            let result = `${i + 1}. **${r.title || 'Untitled'}**\n   URL: ${r.url}`
            if (r.publishedDate) {
              result += `\n   Published: ${r.publishedDate}`
            }
            if (r.author) {
              result += `\n   Author: ${r.author}`
            }
            if (r.highlights && r.highlights.length > 0) {
              result += `\n   Highlights: ${r.highlights.slice(0, 2).join(' ... ')}`
            } else if (r.text) {
              result += `\n   Preview: ${r.text.slice(0, 200)}...`
            }
            return result
          })

          return `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${query}":\n\n${formattedResults.join('\n\n')}`
        } catch (error) {
          return `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 2: Create Dataset
  tools.push(
    new DynamicStructuredTool({
      name: 'create_dataset',
      description: `Create a dataset (list of items) matching a search query.
The dataset is automatically exported to a CSV file in ~/.openwork/datasets/.
This is useful for building lists of companies, people, papers, etc.

If no enrichments are provided, relevant enrichments will be suggested based on the query type.
For example, a query about companies might suggest CEO name and founding year enrichments.

The tool will wait up to 3 minutes for the dataset to complete.
If it times out, you'll receive the dataset ID to check on it later.

IMPORTANT: This tool only works if Search and Datasets is connected in Settings > Apps.`,
      schema: z.object({
        query: z.string().describe('Natural language description of what items to find (e.g., "AI startups in San Francisco founded after 2020")'),
        count: z.number().min(1).max(100).optional().default(10).describe('Number of items to find (default: 10, max: 100)'),
        enrichments: z.array(z.object({
          description: z.string().describe('What data to extract (e.g., "CEO name", "founding year", "company description")'),
          format: z.enum(['text', 'date', 'number', 'email', 'phone', 'url']).describe('Data format for the enrichment')
        })).optional().describe('Optional enrichments to add to each item in the dataset')
      }),
      func: async ({ query, count, enrichments }) => {
        if (!exaService.isConnected()) {
          return 'Search and Datasets is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          // Create the dataset
          const datasetInfo = await exaService.createDataset({ query, count })

          // Wait for completion
          let finalInfo = await exaService.waitForDataset(datasetInfo.id)

          // Apply enrichments if provided
          if (enrichments && enrichments.length > 0) {
            finalInfo = await exaService.enrichDataset(datasetInfo.id, enrichments)
          }

          // Export to CSV
          let csvPath = ''
          try {
            csvPath = await exaService.exportDatasetAsCSV(datasetInfo.id)
          } catch (exportError) {
            console.error('[Exa Tools] CSV export error:', exportError)
          }

          // Prepare response
          let response = `Dataset created successfully!\n\n`
          response += `- **Query**: ${query}\n`
          response += `- **ID**: ${finalInfo.id}\n`
          response += `- **Status**: ${finalInfo.status}\n`
          response += `- **Items**: ${finalInfo.count}\n`

          if (csvPath) {
            response += `- **CSV exported to**: ${csvPath}\n`
          }

          // Suggest enrichments if none were provided
          if (!enrichments || enrichments.length === 0) {
            const suggestions = suggestEnrichments(query)
            if (suggestions.length > 0) {
              response += `\n**Suggested enrichments** for this dataset:\n`
              suggestions.forEach(s => {
                response += `- ${s.description} (${s.format})\n`
              })
              response += `\nUse the \`enrich_dataset\` tool to add these enrichments.`
            }
          }

          return response
        } catch (error) {
          return `Failed to create dataset: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  // Tool 3: Enrich Dataset
  tools.push(
    new DynamicStructuredTool({
      name: 'enrich_dataset',
      description: `Add enrichments to an existing dataset to extract additional data for each item.
Enrichments are AI-extracted data fields like CEO names, founding years, contact info, etc.
After enrichment, the CSV file is automatically updated with the new columns.

IMPORTANT: This tool only works if Search and Datasets is connected in Settings > Apps.`,
      schema: z.object({
        websetId: z.string().describe('The ID of the dataset/webset to enrich'),
        enrichments: z.array(z.object({
          description: z.string().describe('What data to extract (e.g., "CEO name", "founding year", "email address")'),
          format: z.enum(['text', 'date', 'number', 'email', 'phone', 'url']).describe('Data format: text, date, number, email, phone, or url')
        })).min(1).describe('Array of enrichments to add')
      }),
      func: async ({ websetId, enrichments }) => {
        if (!exaService.isConnected()) {
          return 'Search and Datasets is not connected. Please connect in Settings > Apps to use this tool.'
        }

        try {
          // Apply enrichments
          const finalInfo = await exaService.enrichDataset(websetId, enrichments)

          // Re-export CSV
          let csvPath = ''
          try {
            csvPath = await exaService.exportDatasetAsCSV(websetId)
          } catch (exportError) {
            console.error('[Exa Tools] CSV export error:', exportError)
          }

          let response = `Dataset enriched successfully!\n\n`
          response += `- **ID**: ${websetId}\n`
          response += `- **Status**: ${finalInfo.status}\n`
          response += `- **Items**: ${finalInfo.count}\n`
          response += `- **Enrichments added**: ${enrichments.map(e => e.description).join(', ')}\n`

          if (csvPath) {
            response += `- **CSV updated at**: ${csvPath}\n`
          }

          return response
        } catch (error) {
          return `Failed to enrich dataset: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    })
  )

  return tools
}

/**
 * Suggest relevant enrichments based on query type
 */
function suggestEnrichments(query: string): Array<{ description: string; format: 'text' | 'date' | 'number' | 'email' | 'phone' | 'url' }> {
  const lowerQuery = query.toLowerCase()

  // Company-related queries
  if (lowerQuery.includes('company') || lowerQuery.includes('startup') || lowerQuery.includes('business')) {
    return [
      { description: 'CEO or founder name', format: 'text' },
      { description: 'Year founded', format: 'number' },
      { description: 'Company description (one sentence)', format: 'text' },
      { description: 'Contact email', format: 'email' }
    ]
  }

  // People-related queries
  if (lowerQuery.includes('people') || lowerQuery.includes('person') || lowerQuery.includes('founder') || lowerQuery.includes('ceo')) {
    return [
      { description: 'Current job title', format: 'text' },
      { description: 'Current company', format: 'text' },
      { description: 'LinkedIn profile URL', format: 'url' },
      { description: 'Email address', format: 'email' }
    ]
  }

  // Research-related queries
  if (lowerQuery.includes('research') || lowerQuery.includes('paper') || lowerQuery.includes('study')) {
    return [
      { description: 'Lead author name', format: 'text' },
      { description: 'Publication date', format: 'date' },
      { description: 'Key findings summary', format: 'text' }
    ]
  }

  // News-related queries
  if (lowerQuery.includes('news') || lowerQuery.includes('article')) {
    return [
      { description: 'Article author', format: 'text' },
      { description: 'Publication date', format: 'date' },
      { description: 'Key topic summary', format: 'text' }
    ]
  }

  // Default suggestions
  return [
    { description: 'Main topic or subject', format: 'text' },
    { description: 'Relevant date', format: 'date' }
  ]
}

/**
 * Get the names of Exa tools that require human approval
 * Currently none - all Exa tools are read-only
 */
export function getExaInterruptTools(): string[] {
  return []
}

/**
 * Get Exa tool info for the UI settings
 */
export function getExaToolInfo(): ExaToolInfo[] {
  return [
    {
      id: 'web_search',
      name: 'Web Search',
      description: 'Search the web for current information using natural language queries',
      requireApproval: false
    },
    {
      id: 'create_dataset',
      name: 'Create Dataset',
      description: 'Create a dataset of items matching a query and export to CSV',
      requireApproval: false
    },
    {
      id: 'enrich_dataset',
      name: 'Enrich Dataset',
      description: 'Add enrichments to extract additional data from dataset items',
      requireApproval: false
    }
  ]
}
