/**
 * Cronjobs service types
 */

// Re-export types from db
export type { Cronjob, CronjobThreadMapping } from '../db/index.js'

/**
 * Input for creating a new cronjob
 */
export interface CreateCronjobInput {
  name: string
  cron_expression: string
  message: string
  agent_id: string
  thread_mode?: 'new' | 'reuse'
  thread_timeout_minutes?: number
}

/**
 * Input for updating an existing cronjob
 */
export interface UpdateCronjobInput {
  name?: string
  cron_expression?: string
  message?: string
  agent_id?: string
  thread_mode?: 'new' | 'reuse'
  thread_timeout_minutes?: number
  enabled?: boolean
}

/**
 * Cron validation result
 */
export interface CronValidationResult {
  valid: boolean
  error?: string
  nextRuns?: number[]  // Array of timestamps for next scheduled runs
  humanReadable?: string  // Human-readable description of the schedule
}

/**
 * Cronjob execution result
 */
export interface CronjobExecutionResult {
  success: boolean
  thread_id?: string
  response?: string
  error?: string
}
