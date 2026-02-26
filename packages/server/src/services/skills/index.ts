/**
 * Skills service for managing agent skills
 * Following the Agent Skills standard: https://agentskills.io/
 */

import { v4 as uuidv4 } from 'uuid'
import type { Skill, SkillFile, DownloadSkillResult } from './types.js'
import {
  downloadSkillFolder,
  parseSkillMetadata,
  extractSkillNameFromUrl,
  isGitHubUrl
} from './github-downloader.js'
import {
  createSkill,
  getSkill,
  getSkillsByUserId,
  getSkillBySourceUrl,
  deleteSkill as deleteSkillFromDb,
  getSkillsByIds
} from '../db/skills.js'
import { saveAgentFile, getAgentFileBackup, deleteAgentFile } from '../db/index.js'

// Re-export types
export type { Skill, SkillFile, DownloadSkillResult }

// System agent ID for storing skills (per-user)
function getSkillsAgentId(userId: string): string {
  return `skills-library-${userId}`
}

/**
 * Download a skill from GitHub and store it
 */
export async function downloadSkill(url: string, userId: string): Promise<Skill> {
  // Validate URL
  if (!isGitHubUrl(url)) {
    throw new Error('Only GitHub URLs are supported')
  }

  // Check for duplicate
  const existing = await getSkillBySourceUrl(userId, url)
  if (existing) {
    throw new Error('This skill is already installed')
  }

  console.log(`[Skills] Downloading skill from ${url}`)

  // Download files from GitHub
  const files = await downloadSkillFolder(url)

  // Parse metadata from SKILL.md
  const skillMdFile = files.find(f => f.path === 'SKILL.md' || f.path.toLowerCase() === 'skill.md')
  let metadata = { name: extractSkillNameFromUrl(url), description: '' }

  if (skillMdFile) {
    metadata = parseSkillMetadata(skillMdFile.content)
    // If name wasn't found in metadata, use URL-based name
    if (metadata.name === 'Unknown Skill') {
      metadata.name = extractSkillNameFromUrl(url)
    }
  }

  // Generate folder path for this skill
  const skillFolderName = metadata.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
  const folderPath = `/home/user/skills/${skillFolderName}`

  // Store files in the skills library agent backup
  const skillsAgentId = getSkillsAgentId(userId)
  console.log(`[Skills] Storing files to skills library with ID: ${skillsAgentId}`)

  for (const file of files) {
    const fullPath = `${folderPath}/${file.path}`
    console.log(`[Skills] Saving file: ${fullPath}`)
    await saveAgentFile(skillsAgentId, fullPath, file.content)
  }

  // Verify the files were stored
  const verifyBackup = await getAgentFileBackup(skillsAgentId)
  console.log(`[Skills] Verification - backup now has ${verifyBackup?.length || 0} files`)

  console.log(`[Skills] Stored ${files.length} files for skill "${metadata.name}"`)

  // Create skill record in database
  const skill = await createSkill({
    name: metadata.name,
    description: metadata.description || null,
    source_url: url,
    folder_path: folderPath,
    file_count: files.length,
    user_id: userId
  })

  console.log(`[Skills] Created skill: ${skill.skill_id} - ${skill.name}`)

  return skill
}

/**
 * List all skills for a user
 */
export async function listSkills(userId: string): Promise<Skill[]> {
  return getSkillsByUserId(userId)
}

/**
 * Get a skill by ID
 */
export async function getSkillById(skillId: string): Promise<Skill | null> {
  return getSkill(skillId)
}

/**
 * Get skill files for a skill
 */
export async function getSkillFiles(skillId: string, userId: string): Promise<SkillFile[]> {
  const skill = await getSkill(skillId)
  if (!skill || skill.user_id !== userId) {
    return []
  }

  const skillsAgentId = getSkillsAgentId(userId)
  const backup = await getAgentFileBackup(skillsAgentId)
  if (!backup) {
    return []
  }

  // Filter files that belong to this skill
  const skillFiles: SkillFile[] = []
  for (const file of backup) {
    if (file.path.startsWith(skill.folder_path + '/')) {
      skillFiles.push({
        path: file.path.replace(skill.folder_path + '/', ''),
        content: file.content
      })
    }
  }

  return skillFiles
}

/**
 * Delete a skill and its files
 */
export async function removeSkill(skillId: string, userId: string): Promise<boolean> {
  const skill = await getSkill(skillId)
  if (!skill || skill.user_id !== userId) {
    return false
  }

  // Delete skill files from the backup
  const skillsAgentId = getSkillsAgentId(userId)
  const backup = await getAgentFileBackup(skillsAgentId)
  if (backup) {
    for (const file of backup) {
      if (file.path.startsWith(skill.folder_path + '/')) {
        await deleteAgentFile(skillsAgentId, file.path)
      }
    }
  }

  // Delete skill record from database
  const deleted = await deleteSkillFromDb(skillId)

  console.log(`[Skills] Deleted skill: ${skillId} - ${skill.name}`)

  return deleted
}

/**
 * Get skills by their IDs
 */
export async function getSkillsForAgent(skillIds: string[]): Promise<Skill[]> {
  return getSkillsByIds(skillIds)
}

/**
 * Sync skills to an E2B sandbox
 * This writes the skill files to the sandbox at /home/user/skills/
 */
export async function syncSkillsToSandbox(
  enabledSkillIds: string[],
  userId: string,
  sandboxWrite: (path: string, content: string) => Promise<void>
): Promise<string[]> {
  if (enabledSkillIds.length === 0) {
    console.log('[Skills] No enabled skills to sync')
    return []
  }

  console.log(`[Skills] Syncing ${enabledSkillIds.length} skills for user ${userId}`)

  const skills = await getSkillsByIds(enabledSkillIds)
  console.log(`[Skills] Found ${skills.length} skill records:`, skills.map(s => s.name))

  const skillsAgentId = getSkillsAgentId(userId)
  console.log(`[Skills] Looking for backup with ID: ${skillsAgentId}`)

  const backup = await getAgentFileBackup(skillsAgentId)

  if (!backup || backup.length === 0) {
    console.log('[Skills] No skill files found in backup for skills library')
    return []
  }

  console.log(`[Skills] Found ${backup.length} total files in skills library backup`)

  const syncedPaths: string[] = []

  for (const skill of skills) {
    console.log(`[Skills] Processing skill "${skill.name}" with folder_path: ${skill.folder_path}`)

    // Filter files for this skill
    const skillFiles = backup.filter(f => f.path.startsWith(skill.folder_path + '/'))
    console.log(`[Skills] Found ${skillFiles.length} files for skill "${skill.name}":`, skillFiles.map(f => f.path))

    for (const file of skillFiles) {
      try {
        console.log(`[Skills] Writing file: ${file.path}`)
        await sandboxWrite(file.path, file.content)
        syncedPaths.push(file.path)
      } catch (error) {
        console.error(`[Skills] Failed to sync file ${file.path}:`, error)
      }
    }

    console.log(`[Skills] Synced ${skillFiles.length} files for skill "${skill.name}"`)
  }

  console.log(`[Skills] Total synced paths: ${syncedPaths.length}`)
  return syncedPaths
}

/**
 * Get enabled skill paths for an agent (for passing to createDeepAgent)
 */
export async function getEnabledSkillPaths(skillIds: string[]): Promise<string[]> {
  const skills = await getSkillsByIds(skillIds)
  return skills.map(s => s.folder_path)
}

/**
 * Clean skill files from an agent's backup that are not in the enabled skills list.
 * This ensures disabled/deleted skills are removed from the agent's filesystem.
 */
export async function cleanDisabledSkillsFromAgentBackup(
  agentId: string,
  enabledSkillIds: string[]
): Promise<number> {
  const backup = await getAgentFileBackup(agentId)
  if (!backup) {
    return 0
  }

  // Get the folder paths of enabled skills
  const enabledSkills = await getSkillsByIds(enabledSkillIds)
  const enabledPaths = new Set(enabledSkills.map(s => s.folder_path))

  // Find all skill files in the backup (files under /home/user/skills/)
  const skillFiles = backup.filter(f => f.path.startsWith('/home/user/skills/'))

  let deletedCount = 0
  for (const file of skillFiles) {
    // Check if this file belongs to an enabled skill
    const belongsToEnabledSkill = Array.from(enabledPaths).some(
      skillPath => file.path.startsWith(skillPath + '/')
    )

    if (!belongsToEnabledSkill) {
      // This file is from a disabled/deleted skill, remove it
      console.log(`[Skills] Removing disabled skill file: ${file.path}`)
      await deleteAgentFile(agentId, file.path)
      deletedCount++
    }
  }

  if (deletedCount > 0) {
    console.log(`[Skills] Cleaned ${deletedCount} files from disabled skills for agent ${agentId}`)
  }

  return deletedCount
}
