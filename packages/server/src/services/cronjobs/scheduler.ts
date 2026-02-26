/**
 * Cronjob Scheduler Service
 * Manages scheduling and execution of cronjobs using node-cron
 */

import cron, { ScheduledTask } from 'node-cron'
import { v4 as uuidv4 } from 'uuid'
import {
  getEnabledCronjobs,
  getCronjob,
  updateCronjobLastRun,
  getThreadForCronjob,
  updateCronjobThreadMapping,
  updateCronjobThreadMappingActivity,
  isCronjobThreadMappingActive
} from '../db/cronjobs.js'
import { createThread, updateThread, setThreadNeedsAttention } from '../db/index.js'
import { createAgentRuntime } from '../agent/runtime.js'
import { broadcastToUser } from '../../websocket/index.js'
import type { Cronjob } from '../db/index.js'
import type { CronjobExecutionResult, CronValidationResult } from './types.js'

// Map of cronjob_id -> scheduled task
const scheduledTasks = new Map<string, ScheduledTask>()

/**
 * Initialize the cronjob scheduler on server startup.
 * Loads all enabled cronjobs and schedules them.
 */
export async function initializeCronjobScheduler(): Promise<void> {
  console.log('[Cronjobs] Initializing scheduler...')

  const enabledCronjobs = await getEnabledCronjobs()
  console.log(`[Cronjobs] Found ${enabledCronjobs.length} enabled cronjobs`)

  for (const cronjob of enabledCronjobs) {
    try {
      await scheduleCronjob(cronjob)
    } catch (error) {
      console.error(`[Cronjobs] Failed to schedule cronjob ${cronjob.cronjob_id}:`, error)
    }
  }

  console.log('[Cronjobs] Scheduler initialized')
}

/**
 * Schedule a cronjob for execution.
 */
export async function scheduleCronjob(cronjob: Cronjob): Promise<void> {
  // Unschedule existing task if any
  unscheduleCronjob(cronjob.cronjob_id)

  if (!cronjob.enabled) {
    console.log(`[Cronjobs] Skipping disabled cronjob ${cronjob.cronjob_id}`)
    return
  }

  // Validate cron expression
  if (!cron.validate(cronjob.cron_expression)) {
    console.error(`[Cronjobs] Invalid cron expression for ${cronjob.cronjob_id}: ${cronjob.cron_expression}`)
    return
  }

  console.log(`[Cronjobs] Scheduling cronjob ${cronjob.cronjob_id} (${cronjob.name}) with expression: ${cronjob.cron_expression}`)

  const task = cron.schedule(cronjob.cron_expression, async () => {
    console.log(`[Cronjobs] Executing cronjob ${cronjob.cronjob_id} (${cronjob.name})`)
    try {
      await executeCronjob(cronjob.cronjob_id)
    } catch (error) {
      console.error(`[Cronjobs] Error executing cronjob ${cronjob.cronjob_id}:`, error)
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  })

  scheduledTasks.set(cronjob.cronjob_id, task)

  // Update next run time
  const nextRun = getNextRunTime(cronjob.cron_expression)
  if (nextRun) {
    await updateCronjobLastRun(cronjob.cronjob_id, cronjob.last_run_at || 0, nextRun)
  }
}

/**
 * Unschedule a cronjob.
 */
export function unscheduleCronjob(cronjobId: string): void {
  const task = scheduledTasks.get(cronjobId)
  if (task) {
    task.stop()
    scheduledTasks.delete(cronjobId)
    console.log(`[Cronjobs] Unscheduled cronjob ${cronjobId}`)
  }
}

/**
 * Execute a cronjob immediately.
 * This is used both by the scheduler and for manual triggers.
 */
export async function executeCronjob(cronjobId: string): Promise<CronjobExecutionResult> {
  const cronjob = await getCronjob(cronjobId)
  if (!cronjob) {
    return { success: false, error: 'Cronjob not found' }
  }

  const { user_id, agent_id, message, thread_mode, thread_timeout_minutes } = cronjob
  const now = Date.now()

  try {
    // Get or create thread based on thread_mode
    let threadId: string

    if (thread_mode === 'reuse') {
      threadId = await getOrCreateThreadForCronjob(
        user_id,
        cronjobId,
        cronjob.name,
        agent_id,
        thread_timeout_minutes
      )
    } else {
      // Create new thread
      threadId = uuidv4()
      await createThread(threadId, {
        agentId: agent_id,
        userId: user_id,
        source: 'cronjob',
        metadata: { cronjob_id: cronjobId }
      })

      // Set initial title
      const title = `Cronjob: ${cronjob.name}`
      await updateThread(threadId, { title })

      // Broadcast thread:created event
      broadcastToUser(user_id, 'thread:created', {
        thread_id: threadId,
        title,
        agent_id,
        user_id,
        source: 'cronjob'
      })
    }

    // Invoke the agent
    const response = await invokeAgentForCronjob(threadId, user_id, message)

    // Update last run and next run times
    const nextRun = getNextRunTime(cronjob.cron_expression)
    await updateCronjobLastRun(cronjobId, now, nextRun)

    return {
      success: true,
      thread_id: threadId,
      response: response || undefined
    }
  } catch (error) {
    console.error(`[Cronjobs] Error executing cronjob ${cronjobId}:`, error)

    // Still update last run time even on error
    const nextRun = getNextRunTime(cronjob.cron_expression)
    await updateCronjobLastRun(cronjobId, now, nextRun)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Test a cronjob configuration without saving it.
 * Creates a temporary thread and invokes the agent.
 */
export async function testCronjobConfig(
  userId: string,
  agentId: string,
  message: string
): Promise<CronjobExecutionResult> {
  try {
    // Create a temporary thread for testing
    const threadId = uuidv4()
    await createThread(threadId, {
      agentId,
      userId,
      source: 'cronjob',
      metadata: { cronjob_test: true }
    })

    const title = `Cronjob Test - ${new Date().toLocaleString()}`
    await updateThread(threadId, { title })

    // Broadcast thread:created event
    broadcastToUser(userId, 'thread:created', {
      thread_id: threadId,
      title,
      agent_id: agentId,
      user_id: userId,
      source: 'cronjob'
    })

    // Invoke the agent
    const response = await invokeAgentForCronjob(threadId, userId, message)

    return {
      success: true,
      thread_id: threadId,
      response: response || undefined
    }
  } catch (error) {
    console.error('[Cronjobs] Error testing cronjob:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get or create a thread for a cronjob with reuse mode.
 * Follows the WhatsApp timeout-based thread reuse pattern.
 */
async function getOrCreateThreadForCronjob(
  userId: string,
  cronjobId: string,
  cronjobName: string,
  agentId: string,
  timeoutMinutes: number
): Promise<string> {
  const existingMapping = await getThreadForCronjob(userId, cronjobId)

  if (existingMapping) {
    // Check if the mapping is still active (within timeout)
    if (isCronjobThreadMappingActive(existingMapping, timeoutMinutes)) {
      // Update last activity and reuse thread
      await updateCronjobThreadMappingActivity(userId, cronjobId)
      console.log(`[Cronjobs] Reusing thread ${existingMapping.thread_id} for cronjob ${cronjobId}`)
      return existingMapping.thread_id
    } else {
      console.log(`[Cronjobs] Thread ${existingMapping.thread_id} expired for cronjob ${cronjobId}, creating new thread`)
    }
  }

  // Create a new thread
  const threadId = uuidv4()
  await createThread(threadId, {
    agentId,
    userId,
    source: 'cronjob',
    metadata: { cronjob_id: cronjobId }
  })

  // Set initial title
  const title = `Cronjob: ${cronjobName}`
  await updateThread(threadId, { title })

  // Create or update thread mapping
  await updateCronjobThreadMapping(userId, cronjobId, threadId)

  // Broadcast thread:created event
  broadcastToUser(userId, 'thread:created', {
    thread_id: threadId,
    title,
    agent_id: agentId,
    user_id: userId,
    source: 'cronjob'
  })

  console.log(`[Cronjobs] Created new thread ${threadId} for cronjob ${cronjobId}`)
  return threadId
}

/**
 * Invoke the agent for a cronjob.
 * Adapted from agent-hook.ts invokeAgentServerSide function.
 */
async function invokeAgentForCronjob(
  threadId: string,
  userId: string,
  message: string
): Promise<string | null> {
  const channel = `agent:stream:${threadId}`

  try {
    console.log(`[Cronjobs] Invoking agent for thread ${threadId}`)

    const agent = await createAgentRuntime({ threadId })

    let lastOutput: unknown = null
    let interruptDetected = false

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      {
        configurable: { thread_id: threadId },
        streamMode: ['messages', 'values'],
        recursionLimit: 1000
      }
    )

    for await (const chunk of stream) {
      const [mode, data] = chunk as [string, unknown]

      // Broadcast stream event to UI
      broadcastToUser(userId, channel, {
        type: 'stream',
        mode,
        data: JSON.parse(JSON.stringify(data))
      })

      // Check for interrupt in values mode
      if (mode === 'values') {
        lastOutput = data
        if (checkForInterrupt(data)) {
          interruptDetected = true
        }
      }
    }

    // Send done event
    broadcastToUser(userId, channel, { type: 'done' })

    // If interrupt detected, set needs_attention
    if (interruptDetected) {
      await setThreadNeedsAttention(threadId, true)
      broadcastToUser(userId, 'thread:updated', {
        thread_id: threadId,
        needs_attention: true
      })
      return null
    }

    // Extract response from last output
    const response = extractResponseFromAgentOutput(lastOutput)

    // If we have a response, set needs_attention
    if (response) {
      await setThreadNeedsAttention(threadId, true)
      broadcastToUser(userId, 'thread:updated', {
        thread_id: threadId,
        needs_attention: true
      })
    }

    return response
  } catch (error) {
    console.error(`[Cronjobs] Error invoking agent:`, error)

    broadcastToUser(userId, channel, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    return null
  }
}

/**
 * Check for interrupt in agent output.
 */
function checkForInterrupt(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false

  const outputObj = output as Record<string, unknown>
  const interrupt = outputObj.__interrupt__ as Array<{
    value?: { actionRequests?: Array<{ name: string; id: string; args: Record<string, unknown> }> }
  }> | undefined

  if (interrupt && Array.isArray(interrupt) && interrupt.length > 0) {
    const interruptValue = interrupt[0]?.value
    if (interruptValue?.actionRequests?.length) {
      return true
    }
  }

  return false
}

/**
 * Extract AI response text from agent output.
 */
function extractResponseFromAgentOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null

  const outputObj = output as Record<string, unknown>

  if (Array.isArray(outputObj.messages)) {
    for (let i = outputObj.messages.length - 1; i >= 0; i--) {
      const msg = outputObj.messages[i] as Record<string, unknown>
      if (msg.type === 'ai' || (typeof msg._getType === 'function' && msg._getType() === 'ai') || msg.role === 'assistant') {
        const content = msg.content
        if (typeof content === 'string') {
          return content
        }
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') return block
            if (typeof block === 'object' && block !== null) {
              const blockObj = block as Record<string, unknown>
              if (blockObj.type === 'text' && typeof blockObj.text === 'string') {
                return blockObj.text
              }
            }
          }
        }
      }
    }
  }

  if (typeof outputObj.content === 'string') {
    return outputObj.content
  }

  return null
}

/**
 * Validate a cron expression and return details.
 */
export function validateCronExpression(expression: string): CronValidationResult {
  const isValid = cron.validate(expression)

  if (!isValid) {
    return {
      valid: false,
      error: 'Invalid cron expression'
    }
  }

  // Calculate next 3 run times
  const nextRuns: number[] = []
  const now = new Date()

  for (let i = 0; i < 3; i++) {
    const nextRun = getNextRunTimeAfter(expression, i === 0 ? now : new Date(nextRuns[i - 1]))
    if (nextRun) {
      nextRuns.push(nextRun)
    }
  }

  return {
    valid: true,
    nextRuns,
    humanReadable: getCronHumanReadable(expression)
  }
}

/**
 * Get the next run time for a cron expression.
 */
export function getNextRunTime(expression: string): number | null {
  return getNextRunTimeAfter(expression, new Date())
}

/**
 * Get the next run time after a given date.
 * Simple implementation - for production, consider using a proper cron parser library.
 */
function getNextRunTimeAfter(expression: string, after: Date): number | null {
  if (!cron.validate(expression)) return null

  // Parse cron expression
  const parts = expression.split(' ')
  if (parts.length < 5) return null

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Start from after, find the next matching time
  const result = new Date(after.getTime() + 60000) // Start from next minute
  result.setSeconds(0)
  result.setMilliseconds(0)

  // Simple brute force: check each minute for the next year
  const maxIterations = 365 * 24 * 60
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCronPart(result.getMinutes(), minute) &&
        matchesCronPart(result.getHours(), hour) &&
        matchesCronPart(result.getDate(), dayOfMonth) &&
        matchesCronPart(result.getMonth() + 1, month) &&
        matchesCronPart(result.getDay(), dayOfWeek)) {
      return result.getTime()
    }
    result.setTime(result.getTime() + 60000)
  }

  return null
}

/**
 * Check if a value matches a cron part.
 * Supports: *, step values, ranges, and lists.
 */
function matchesCronPart(value: number, part: string): boolean {
  if (part === '*') return true

  // Handle step values (*/5)
  if (part.startsWith('*/')) {
    const step = parseInt(part.slice(2), 10)
    return value % step === 0
  }

  // Handle ranges (1-5)
  if (part.includes('-')) {
    const [start, end] = part.split('-').map(n => parseInt(n, 10))
    return value >= start && value <= end
  }

  // Handle lists (1,3,5)
  if (part.includes(',')) {
    const values = part.split(',').map(n => parseInt(n, 10))
    return values.includes(value)
  }

  // Simple value
  return parseInt(part, 10) === value
}

/**
 * Get a human-readable description of a cron expression.
 */
function getCronHumanReadable(expression: string): string {
  const parts = expression.split(' ')
  if (parts.length < 5) return expression

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute'
  }

  // Every X minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const step = minute.slice(2)
    return `Every ${step} minutes`
  }

  // Hourly at specific minute
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Hourly at minute ${minute}`
  }

  // Daily at specific time
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // Weekly at specific time
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayName = dayOfWeek.split(',').map(d => days[parseInt(d, 10)] || d).join(', ')
    return `Weekly on ${dayName} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // Monthly at specific day and time
  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return `Monthly on day ${dayOfMonth} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  return expression
}

/**
 * Check if a cronjob is currently scheduled.
 */
export function isCronjobScheduled(cronjobId: string): boolean {
  return scheduledTasks.has(cronjobId)
}

/**
 * Get all scheduled cronjob IDs.
 */
export function getScheduledCronjobIds(): string[] {
  return Array.from(scheduledTasks.keys())
}
