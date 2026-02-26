/**
 * Cronjobs Service
 * Business logic for managing cronjobs
 */

import {
  createCronjob as dbCreateCronjob,
  getCronjob,
  getCronjobsByUserId,
  updateCronjob as dbUpdateCronjob,
  deleteCronjob as dbDeleteCronjob,
  deleteCronjobThreadMapping
} from '../db/cronjobs.js'
import {
  scheduleCronjob,
  unscheduleCronjob,
  executeCronjob as executeScheduledCronjob,
  testCronjobConfig as testCronjobConfigInScheduler,
  validateCronExpression,
  getNextRunTime
} from './scheduler.js'
import type { Cronjob } from '../db/index.js'
import type { CreateCronjobInput, UpdateCronjobInput, CronValidationResult, CronjobExecutionResult } from './types.js'

// Re-export for convenience
export { initializeCronjobScheduler, validateCronExpression, getNextRunTime } from './scheduler.js'
export type { Cronjob, CreateCronjobInput, UpdateCronjobInput, CronValidationResult, CronjobExecutionResult }

// Configurable limits (could be loaded from env)
const MAX_CRONJOBS_PER_USER = parseInt(process.env.CRONJOB_MAX_PER_USER || '10', 10)
const MIN_INTERVAL_MINUTES = parseInt(process.env.CRONJOB_MIN_INTERVAL_MINUTES || '1', 10)

/**
 * Create a new cronjob.
 */
export async function createCronjob(input: CreateCronjobInput, userId: string): Promise<Cronjob> {
  // Validate cron expression
  const validation = validateCronExpression(input.cron_expression)
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid cron expression')
  }

  // Check interval if configured
  if (MIN_INTERVAL_MINUTES > 1) {
    const nextRuns = validation.nextRuns
    if (nextRuns && nextRuns.length >= 2) {
      const interval = (nextRuns[1] - nextRuns[0]) / (60 * 1000)
      if (interval < MIN_INTERVAL_MINUTES) {
        throw new Error(`Cronjob interval must be at least ${MIN_INTERVAL_MINUTES} minute(s)`)
      }
    }
  }

  // Check user's cronjob count
  const existingCronjobs = await getCronjobsByUserId(userId)
  if (existingCronjobs.length >= MAX_CRONJOBS_PER_USER) {
    throw new Error(`Maximum cronjobs limit reached (${MAX_CRONJOBS_PER_USER})`)
  }

  const cronjob = await dbCreateCronjob({
    name: input.name,
    cron_expression: input.cron_expression,
    message: input.message,
    agent_id: input.agent_id,
    thread_mode: input.thread_mode,
    thread_timeout_minutes: input.thread_timeout_minutes,
    user_id: userId
  })

  // Update next_run_at
  const nextRun = getNextRunTime(cronjob.cron_expression)
  if (nextRun) {
    await dbUpdateCronjob(cronjob.cronjob_id, { next_run_at: nextRun })
    cronjob.next_run_at = nextRun
  }

  return cronjob
}

/**
 * List all cronjobs for a user.
 */
export async function listCronjobs(userId: string): Promise<Cronjob[]> {
  return getCronjobsByUserId(userId)
}

/**
 * Get a cronjob by ID.
 */
export async function getCronjobById(cronjobId: string): Promise<Cronjob | null> {
  return getCronjob(cronjobId)
}

/**
 * Update a cronjob.
 */
export async function updateCronjob(cronjobId: string, updates: UpdateCronjobInput, userId: string): Promise<Cronjob | null> {
  const existing = await getCronjob(cronjobId)
  if (!existing) {
    throw new Error('Cronjob not found')
  }

  if (existing.user_id !== userId) {
    throw new Error('Access denied')
  }

  // Validate new cron expression if provided
  if (updates.cron_expression) {
    const validation = validateCronExpression(updates.cron_expression)
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid cron expression')
    }

    // Check interval if configured
    if (MIN_INTERVAL_MINUTES > 1) {
      const nextRuns = validation.nextRuns
      if (nextRuns && nextRuns.length >= 2) {
        const interval = (nextRuns[1] - nextRuns[0]) / (60 * 1000)
        if (interval < MIN_INTERVAL_MINUTES) {
          throw new Error(`Cronjob interval must be at least ${MIN_INTERVAL_MINUTES} minute(s)`)
        }
      }
    }
  }

  const dbUpdates: Partial<Cronjob> = {}

  if (updates.name !== undefined) dbUpdates.name = updates.name
  if (updates.cron_expression !== undefined) dbUpdates.cron_expression = updates.cron_expression
  if (updates.message !== undefined) dbUpdates.message = updates.message
  if (updates.agent_id !== undefined) dbUpdates.agent_id = updates.agent_id
  if (updates.thread_mode !== undefined) dbUpdates.thread_mode = updates.thread_mode
  if (updates.thread_timeout_minutes !== undefined) dbUpdates.thread_timeout_minutes = updates.thread_timeout_minutes
  if (updates.enabled !== undefined) dbUpdates.enabled = updates.enabled ? 1 : 0

  const updated = await dbUpdateCronjob(cronjobId, dbUpdates)

  if (updated) {
    // Update next_run_at if cron expression changed
    if (updates.cron_expression) {
      const nextRun = getNextRunTime(updated.cron_expression)
      if (nextRun) {
        await dbUpdateCronjob(cronjobId, { next_run_at: nextRun })
        updated.next_run_at = nextRun
      }
    }

    // Reschedule if needed
    if (updates.enabled === true || updates.cron_expression) {
      const latest = await getCronjob(cronjobId)
      if (latest && latest.enabled) {
        await scheduleCronjob(latest)
      }
    } else if (updates.enabled === false) {
      unscheduleCronjob(cronjobId)
    }
  }

  return updated
}

/**
 * Delete a cronjob.
 */
export async function deleteCronjob(cronjobId: string, userId: string): Promise<boolean> {
  const existing = await getCronjob(cronjobId)
  if (!existing) {
    return false
  }

  if (existing.user_id !== userId) {
    throw new Error('Access denied')
  }

  // Unschedule if running
  unscheduleCronjob(cronjobId)

  // Delete thread mapping
  await deleteCronjobThreadMapping(userId, cronjobId)

  return dbDeleteCronjob(cronjobId)
}

/**
 * Toggle a cronjob's enabled state.
 */
export async function toggleCronjob(cronjobId: string, userId: string): Promise<Cronjob | null> {
  const existing = await getCronjob(cronjobId)
  if (!existing) {
    throw new Error('Cronjob not found')
  }

  if (existing.user_id !== userId) {
    throw new Error('Access denied')
  }

  const newEnabled = !existing.enabled
  const updated = await dbUpdateCronjob(cronjobId, {
    enabled: newEnabled ? 1 : 0
  })

  if (updated) {
    // Update next_run_at when enabling
    if (newEnabled) {
      const nextRun = getNextRunTime(updated.cron_expression)
      if (nextRun) {
        await dbUpdateCronjob(cronjobId, { next_run_at: nextRun })
        updated.next_run_at = nextRun
      }

      // Schedule the cronjob
      const latest = await getCronjob(cronjobId)
      if (latest) {
        await scheduleCronjob(latest)
      }
    } else {
      // Unschedule when disabling
      unscheduleCronjob(cronjobId)
    }
  }

  return updated
}

/**
 * Manually trigger a cronjob execution.
 */
export async function triggerCronjob(cronjobId: string, userId: string): Promise<CronjobExecutionResult> {
  const existing = await getCronjob(cronjobId)
  if (!existing) {
    return { success: false, error: 'Cronjob not found' }
  }

  if (existing.user_id !== userId) {
    return { success: false, error: 'Access denied' }
  }

  return executeScheduledCronjob(cronjobId)
}

/**
 * Test a cronjob configuration without saving it.
 */
export async function testCronjobConfig(
  userId: string,
  agentId: string,
  message: string
): Promise<CronjobExecutionResult> {
  return testCronjobConfigInScheduler(userId, agentId, message)
}

/**
 * Validate a cron expression and return details.
 */
export function validateCron(expression: string): CronValidationResult {
  return validateCronExpression(expression)
}
