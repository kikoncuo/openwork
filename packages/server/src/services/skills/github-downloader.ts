/**
 * GitHub downloader for Agent Skills
 * Parses GitHub URLs and downloads skill folders
 */

import type { GitHubUrlParts, GitHubContentItem, SkillFile, SkillMetadata } from './types.js'

/**
 * Parse a GitHub tree URL into its components
 * Supports format: https://github.com/{owner}/{repo}/tree/{branch}/{path}
 */
export function parseGitHubUrl(url: string): GitHubUrlParts {
  // Clean up the URL
  const cleanUrl = url.trim()

  // Parse the URL
  const urlPattern = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/
  const match = cleanUrl.match(urlPattern)

  if (!match) {
    throw new Error('Invalid GitHub URL format. Expected: https://github.com/{owner}/{repo}/tree/{branch}/{path}')
  }

  const [, owner, repo, branch, path] = match

  return {
    owner,
    repo,
    branch,
    path: path.replace(/\/$/, '') // Remove trailing slash if present
  }
}

/**
 * Validate that a URL is a GitHub URL
 */
export function isGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

/**
 * Fetch contents from GitHub API
 */
async function fetchGitHubContents(owner: string, repo: string, path: string, branch: string): Promise<GitHubContentItem[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`

  const response = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OpenWork-Skills-Downloader'
    }
  })

  if (response.status === 404) {
    throw new Error('Skill folder not found')
  }

  if (response.status === 403) {
    const remaining = response.headers.get('X-RateLimit-Remaining')
    if (remaining === '0') {
      throw new Error('GitHub rate limit reached. Try again later.')
    }
    throw new Error('GitHub API access denied')
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`)
  }

  const data = await response.json()

  // If it's a single file, wrap it in an array
  if (!Array.isArray(data)) {
    return [data as GitHubContentItem]
  }

  return data as GitHubContentItem[]
}

/**
 * Download a file from GitHub
 */
async function downloadFile(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'OpenWork-Skills-Downloader'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`)
  }

  return await response.text()
}

/**
 * Recursively download all files from a GitHub folder
 */
export async function downloadSkillFolder(url: string): Promise<SkillFile[]> {
  if (!isGitHubUrl(url)) {
    throw new Error('Only GitHub URLs are supported')
  }

  const { owner, repo, branch, path } = parseGitHubUrl(url)
  const files: SkillFile[] = []

  async function downloadRecursive(currentPath: string, basePath: string): Promise<void> {
    const contents = await fetchGitHubContents(owner, repo, currentPath, branch)

    for (const item of contents) {
      if (item.type === 'file' && item.download_url) {
        const content = await downloadFile(item.download_url)
        // Create relative path from the base skill folder
        const relativePath = item.path.replace(basePath, '').replace(/^\//, '')
        files.push({
          path: relativePath || item.name,
          content
        })
      } else if (item.type === 'dir') {
        await downloadRecursive(item.path, basePath)
      }
    }
  }

  await downloadRecursive(path, path)

  // Verify SKILL.md exists
  const hasSkillMd = files.some(f => f.path === 'SKILL.md' || f.path.toLowerCase() === 'skill.md')
  if (!hasSkillMd) {
    throw new Error('Invalid skill: SKILL.md file required')
  }

  return files
}

/**
 * Parse SKILL.md frontmatter to extract metadata
 * SKILL.md format:
 * ---
 * name: Skill Name
 * description: Skill description
 * ---
 * ... rest of content
 */
export function parseSkillMetadata(skillMdContent: string): SkillMetadata {
  const frontmatterPattern = /^---\n([\s\S]*?)\n---/
  const match = skillMdContent.match(frontmatterPattern)

  let name = 'Unknown Skill'
  let description = ''

  if (match) {
    const frontmatter = match[1]
    const lines = frontmatter.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim().toLowerCase()
        const value = line.slice(colonIndex + 1).trim()

        if (key === 'name') {
          name = value
        } else if (key === 'description') {
          description = value
        }
      }
    }
  }

  // If no frontmatter, try to extract name from first heading
  if (name === 'Unknown Skill') {
    const headingPattern = /^#\s+(.+)$/m
    const headingMatch = skillMdContent.match(headingPattern)
    if (headingMatch) {
      name = headingMatch[1].trim()
    }
  }

  // If still no name, try to extract from file path/URL
  return { name, description }
}

/**
 * Extract skill name from GitHub URL path (fallback)
 */
export function extractSkillNameFromUrl(url: string): string {
  try {
    const { path } = parseGitHubUrl(url)
    const parts = path.split('/')
    return parts[parts.length - 1] || 'unknown-skill'
  } catch {
    return 'unknown-skill'
  }
}
