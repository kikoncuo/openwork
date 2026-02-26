/**
 * Skills types for the Agent Skills feature
 * Following the Agent Skills standard: https://agentskills.io/
 */

export interface Skill {
  skill_id: string
  name: string
  description: string | null
  source_url: string
  folder_path: string
  file_count: number
  user_id: string
  created_at: number
  updated_at: number
}

export interface SkillFile {
  path: string
  content: string
}

export interface DownloadSkillResult {
  skill: Skill
  files: SkillFile[]
}

export interface SkillMetadata {
  name: string
  description: string
}

export interface GitHubUrlParts {
  owner: string
  repo: string
  branch: string
  path: string
}

export interface GitHubContentItem {
  name: string
  path: string
  sha: string
  size: number
  url: string
  html_url: string
  git_url: string
  download_url: string | null
  type: 'file' | 'dir'
}
