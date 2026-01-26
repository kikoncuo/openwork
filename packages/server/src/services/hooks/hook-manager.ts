import { v4 as uuidv4 } from 'uuid'

export type HookEventType =
  | 'message:received'      // Incoming message from any source
  | 'message:sending'       // About to send message
  | 'message:sent'          // Message sent successfully
  | 'thread:created'        // New thread created
  | 'agent:invoked'         // Agent processing started
  | 'agent:response'        // Agent generated response
  | 'agent:error'           // Agent failed
  // App connection events
  | 'app:connecting'        // App connection in progress
  | 'app:connected'         // App successfully connected
  | 'app:disconnected'      // App disconnected
  | 'app:health_warning'    // App health degraded, needs attention
  | 'app:health_cleared'    // App health restored to normal
  | 'app:health_check'      // Health check performed

export interface HookEvent {
  id: string
  type: HookEventType
  timestamp: Date
  userId: string
  source: 'whatsapp' | 'chat' | string
  payload: Record<string, unknown>
}

export interface HookHandler {
  id: string
  name: string
  eventTypes: HookEventType[] | ['*']  // '*' means all events
  enabled: boolean
  priority?: number  // Lower numbers run first, default 100
  handler: (event: HookEvent) => Promise<HookResult>
}

export interface HookResult {
  success: boolean
  error?: string
  continueChain?: boolean  // false = stop processing other handlers
  modifiedPayload?: Record<string, unknown>
}

const MAX_EVENT_LOG_SIZE = 1000
const DEFAULT_PRIORITY = 100

class HookManager {
  private handlers: Map<string, HookHandler> = new Map()
  private eventLog: HookEvent[] = []  // Circular buffer for debugging

  /**
   * Register a new hook handler
   * Returns an unregister function
   */
  registerHandler(handler: HookHandler): () => void {
    if (this.handlers.has(handler.id)) {
      console.warn(`[HookManager] Handler with id "${handler.id}" already exists, replacing`)
    }

    const handlerWithDefaults: HookHandler = {
      ...handler,
      priority: handler.priority ?? DEFAULT_PRIORITY
    }

    this.handlers.set(handler.id, handlerWithDefaults)
    console.log(`[HookManager] Registered handler: ${handler.name} (${handler.id})`)

    return () => this.unregisterHandler(handler.id)
  }

  /**
   * Unregister a handler by ID
   */
  unregisterHandler(handlerId: string): void {
    const handler = this.handlers.get(handlerId)
    if (handler) {
      this.handlers.delete(handlerId)
      console.log(`[HookManager] Unregistered handler: ${handler.name} (${handlerId})`)
    }
  }

  /**
   * Enable or disable a handler
   */
  setHandlerEnabled(handlerId: string, enabled: boolean): void {
    const handler = this.handlers.get(handlerId)
    if (handler) {
      handler.enabled = enabled
      console.log(`[HookManager] Handler ${handler.name} ${enabled ? 'enabled' : 'disabled'}`)
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  async emit(eventData: Omit<HookEvent, 'id' | 'timestamp'>): Promise<void> {
    const event: HookEvent = {
      ...eventData,
      id: uuidv4(),
      timestamp: new Date()
    }

    // Log the event
    this.addToEventLog(event)
    console.log(`[Hook] ${event.type}: userId=${event.userId}, source=${event.source}`)

    // Get handlers that match this event type, sorted by priority
    const matchingHandlers = this.getMatchingHandlers(event.type)

    let currentPayload = event.payload

    // Execute handlers in priority order
    for (const handler of matchingHandlers) {
      if (!handler.enabled) {
        continue
      }

      try {
        const eventWithPayload: HookEvent = {
          ...event,
          payload: currentPayload
        }

        const result = await handler.handler(eventWithPayload)

        if (!result.success) {
          console.error(`[HookManager] Handler ${handler.name} failed:`, result.error)
        }

        // Allow handlers to modify the payload for subsequent handlers
        if (result.modifiedPayload) {
          currentPayload = result.modifiedPayload
        }

        // Stop chain if handler requests it
        if (result.continueChain === false) {
          console.log(`[HookManager] Handler ${handler.name} stopped the chain`)
          break
        }
      } catch (error) {
        console.error(`[HookManager] Handler ${handler.name} threw error:`, error)
      }
    }
  }

  /**
   * Get handlers matching an event type, sorted by priority
   */
  private getMatchingHandlers(eventType: HookEventType): HookHandler[] {
    const handlers: HookHandler[] = []

    for (const handler of this.handlers.values()) {
      const eventTypes = handler.eventTypes as string[]
      if (eventTypes.includes('*') || eventTypes.includes(eventType)) {
        handlers.push(handler)
      }
    }

    // Sort by priority (lower first)
    return handlers.sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY))
  }

  /**
   * Add event to circular buffer log
   */
  private addToEventLog(event: HookEvent): void {
    this.eventLog.push(event)

    // Trim to max size
    while (this.eventLog.length > MAX_EVENT_LOG_SIZE) {
      this.eventLog.shift()
    }
  }

  /**
   * Get recent events from the log
   */
  getEventLog(options?: {
    userId?: string
    eventType?: HookEventType
    source?: string
    limit?: number
  }): HookEvent[] {
    let events = [...this.eventLog]

    if (options?.userId) {
      events = events.filter(e => e.userId === options.userId)
    }

    if (options?.eventType) {
      events = events.filter(e => e.type === options.eventType)
    }

    if (options?.source) {
      events = events.filter(e => e.source === options.source)
    }

    // Return most recent first
    events.reverse()

    if (options?.limit) {
      events = events.slice(0, options.limit)
    }

    return events
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): HookHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * Get a specific handler by ID
   */
  getHandler(handlerId: string): HookHandler | undefined {
    return this.handlers.get(handlerId)
  }

  /**
   * Clear the event log
   */
  clearEventLog(): void {
    this.eventLog = []
    console.log('[HookManager] Event log cleared')
  }
}

// Singleton instance
export const hookManager = new HookManager()
