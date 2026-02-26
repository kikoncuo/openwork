/**
 * Exa Tools for Agent
 * Provides web search and dataset creation capabilities
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { exaService } from './index.js'
import type { EnrichmentConfig, ExaToolInfo } from './types.js'
import type { SandboxFileAccess } from '../../agent/sandbox-file-access.js'

/**
 * Create Exa tools for the agent
 * @param userId - The user ID for API access
 * @param agentId - The agent ID for file storage (files appear in agent's Files panel)
 * @param fileAccess - File access abstraction for reading/writing sandbox files
 */
export function createExaTools(userId: string, agentId: string, fileAccess?: SandboxFileAccess): DynamicStructuredTool[] {
  // Web Search Tool
  const webSearchTool = new DynamicStructuredTool({
    name: 'web_search',
    description: `Search the web for current information. Returns relevant web pages with their content.
Use this to find recent news, research, company information, or any web content.

Categories available (optional):
- company: For finding companies and startups
- people: For finding people and profiles
- research paper: For academic papers
- news: For news articles
- github: For GitHub repositories
- pdf: For PDF documents
- tweet: For tweets
- personal site: For personal websites/blogs
- financial report: For financial documents`,
    schema: z.object({
      query: z.string().describe('The search query'),
      category: z.enum([
        'company',
        'people',
        'research paper',
        'news',
        'github',
        'pdf',
        'tweet',
        'personal site',
        'financial report'
      ]).optional().describe('Category to filter results'),
      numResults: z.number().min(1).max(100).optional().default(10).describe('Number of results (1-100, default 10)'),
      includeDomains: z.array(z.string()).optional().describe('Only include results from these domains'),
      excludeDomains: z.array(z.string()).optional().describe('Exclude results from these domains'),
      useHighlights: z.boolean().optional().default(true).describe('Include highlighted text snippets')
    }),
    func: async ({ query, category, numResults, includeDomains, excludeDomains, useHighlights }) => {
      try {
        const results = await exaService.search(userId, {
          query,
          category: category as any,
          numResults,
          includeDomains,
          excludeDomains,
          useHighlights
        })

        if (results.length === 0) {
          return 'No results found for this search.'
        }

        // Format results for the agent
        const formatted = results.map((r, i) => {
          let result = `## Result ${i + 1}: ${r.title || 'Untitled'}\n`
          result += `URL: ${r.url}\n`
          if (r.publishedDate) result += `Date: ${r.publishedDate}\n`
          if (r.author) result += `Author: ${r.author}\n`
          if (r.highlights && r.highlights.length > 0) {
            result += `Highlights:\n${r.highlights.map(h => `- ${h}`).join('\n')}\n`
          } else if (r.text) {
            result += `Content: ${r.text.substring(0, 500)}${r.text.length > 500 ? '...' : ''}\n`
          }
          return result
        }).join('\n---\n')

        return `Found ${results.length} results:\n\n${formatted}`
      } catch (error) {
        return `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Create Dataset Tool
  const createDatasetTool = new DynamicStructuredTool({
    name: 'create_dataset',
    description: `Create a dataset by searching for entities (companies, people, products, etc.).
The dataset will be searched, optionally enriched with additional fields, and exported as a CSV file.

This is useful for:
- Building lists of companies in a specific sector
- Finding people with certain characteristics
- Creating research datasets
- Competitive analysis

If no enrichments are provided, suggestions will be made based on the query type.`,
    schema: z.object({
      query: z.string().describe('Natural language query describing what to find (e.g., "AI startups in San Francisco founded after 2020")'),
      count: z.number().min(1).max(100).optional().default(10).describe('Number of items to find (1-100, default 10)'),
      enrichments: z.array(z.object({
        description: z.string().describe('Description of the data to extract (e.g., "CEO name", "founding year")'),
        format: z.enum(['text', 'date', 'number', 'email', 'phone', 'url']).describe('Data format')
      })).optional().describe('Optional enrichments to add to each result')
    }),
    func: async ({ query, count, enrichments }) => {
      try {
        // Create the dataset
        const info = await exaService.createDataset(userId, { query, count })
        let response = `Dataset created with ID: ${info.id}\n`
        response += `Query: "${query}"\n`
        response += `Status: ${info.status}\n`

        // Wait for completion
        response += 'Waiting for dataset to complete...\n'
        const completedInfo = await exaService.waitForDataset(userId, info.id)
        response += `Completed with ${completedInfo.count} items.\n`

        // Add enrichments if provided
        if (enrichments && enrichments.length > 0) {
          response += `Adding ${enrichments.length} enrichments...\n`
          await exaService.enrichDataset(userId, info.id, enrichments as EnrichmentConfig[])
          response += 'Enrichments completed.\n'
        }

        // Export to CSV (saved to agent's sandbox)
        if (!fileAccess) {
          return 'ERROR: File access not available. Cannot export CSV.'
        }
        const csvPath = await exaService.exportDatasetAsCSV(userId, fileAccess, info.id)
        response += `\nDataset exported to: ${csvPath}\n`

        // Get and show preview
        const items = await exaService.getDatasetItems(userId, info.id)
        if (items.length > 0) {
          response += '\nPreview (first 3 items):\n'
          items.slice(0, 3).forEach((item, i) => {
            response += `\n${i + 1}. ${item.title || item.url}\n`
            Object.entries(item).forEach(([key, value]) => {
              if (key !== 'url' && key !== 'title' && key !== 'text' && value) {
                response += `   ${key}: ${value}\n`
              }
            })
          })
        }

        // Suggest enrichments if none were provided
        if (!enrichments || enrichments.length === 0) {
          response += '\n---\nTip: You can add enrichments to extract more data from each result.\n'
          response += 'Use enrich_dataset with the websetId to add fields like:\n'
          if (query.toLowerCase().includes('compan') || query.toLowerCase().includes('startup')) {
            response += '- CEO name (text)\n- Founding year (number)\n- Employee count (number)\n- Funding raised (text)\n'
          } else if (query.toLowerCase().includes('people') || query.toLowerCase().includes('person')) {
            response += '- Job title (text)\n- Company (text)\n- Email (email)\n- LinkedIn URL (url)\n'
          } else {
            response += '- Description (text)\n- Date (date)\n- Related URL (url)\n'
          }
        }

        return response
      } catch (error) {
        return `Failed to create dataset: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  // Enrich Dataset Tool
  const enrichDatasetTool = new DynamicStructuredTool({
    name: 'enrich_dataset',
    description: `Add enrichments to an existing dataset to extract additional data fields.
Enrichments use AI to analyze each item and extract the requested information.

Available formats:
- text: Free text (e.g., names, descriptions)
- date: Dates
- number: Numbers (e.g., employee count, revenue)
- email: Email addresses
- phone: Phone numbers
- url: URLs`,
    schema: z.object({
      websetId: z.string().describe('The dataset/webset ID to enrich'),
      enrichments: z.array(z.object({
        description: z.string().describe('Description of data to extract'),
        format: z.enum(['text', 'date', 'number', 'email', 'phone', 'url']).describe('Data format')
      })).describe('Enrichments to add')
    }),
    func: async ({ websetId, enrichments }) => {
      try {
        let response = `Adding ${enrichments.length} enrichments to dataset ${websetId}...\n`

        await exaService.enrichDataset(userId, websetId, enrichments as EnrichmentConfig[])
        response += 'Enrichments completed.\n'

        // Re-export to CSV (saved to agent's sandbox)
        if (!fileAccess) {
          return 'ERROR: File access not available. Cannot export CSV.'
        }
        const csvPath = await exaService.exportDatasetAsCSV(userId, fileAccess, websetId)
        response += `Updated CSV exported to: ${csvPath}\n`

        // Show preview
        const items = await exaService.getDatasetItems(userId, websetId)
        if (items.length > 0) {
          response += '\nPreview (first 2 items):\n'
          items.slice(0, 2).forEach((item, i) => {
            response += `\n${i + 1}. ${item.title || item.url}\n`
            Object.entries(item).forEach(([key, value]) => {
              if (key !== 'url' && key !== 'title' && key !== 'text' && value) {
                response += `   ${key}: ${value}\n`
              }
            })
          })
        }

        return response
      } catch (error) {
        return `Failed to enrich dataset: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })

  return [webSearchTool, createDatasetTool, enrichDatasetTool]
}

/**
 * Get tools that require human approval before execution
 */
export function getExaInterruptTools(): string[] {
  // None of the Exa tools require approval by default
  // They are read-only search operations
  return []
}

/**
 * Get tool info for the UI
 */
export function getExaToolInfo(): ExaToolInfo[] {
  return [
    {
      id: 'web_search',
      name: 'Web Search',
      description: 'Search the web for current information',
      requireApproval: false
    },
    {
      id: 'create_dataset',
      name: 'Create Dataset',
      description: 'Create and export a dataset from web searches',
      requireApproval: false
    },
    {
      id: 'enrich_dataset',
      name: 'Enrich Dataset',
      description: 'Add enrichment fields to an existing dataset',
      requireApproval: false
    }
  ]
}
