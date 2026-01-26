/**
 * Connections REST API
 * Unified API for managing app connections (WhatsApp, Google Workspace, etc.)
 */

import { Router, Response, NextFunction } from 'express'
import type { Request } from 'express'
import { connectionManager } from '../services/apps/connection-manager.js'
import { requireAuth } from '../middleware/auth.js'

// Define route params type
interface AppTypeParams {
  appType: string
}

const router = Router()

// All routes require authentication
router.use(requireAuth)

/**
 * GET /api/connections
 * List all app connections for the authenticated user
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const connections = await connectionManager.getAllConnections(userId)

    // Also include registered apps that user isn't connected to
    const registeredApps = connectionManager.getRegisteredApps()

    const result = registeredApps.map(app => {
      const connection = connections.find(c => c.appType === app.appType)

      if (connection) {
        return {
          ...app,
          id: connection.id,
          status: connection.status,
          healthStatus: connection.healthStatus,
          warningMessage: connection.warningMessage,
          lastHealthCheckAt: connection.lastHealthCheckAt?.toISOString(),
          lastSuccessfulActivityAt: connection.lastSuccessfulActivityAt?.toISOString(),
          metadata: connection.metadata,
          createdAt: connection.createdAt.toISOString(),
          updatedAt: connection.updatedAt.toISOString()
        }
      }

      // Not connected yet
      return {
        ...app,
        id: null,
        status: 'disconnected',
        healthStatus: 'unknown',
        warningMessage: null,
        lastHealthCheckAt: null,
        lastSuccessfulActivityAt: null,
        metadata: null,
        createdAt: null,
        updatedAt: null
      }
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/connections/:appType
 * Get specific connection status
 */
router.get<AppTypeParams>('/:appType', async (req, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    const { appType } = req.params

    const adapter = connectionManager.getAdapter(appType)
    if (!adapter) {
      return res.status(404).json({ error: `App type '${appType}' not found` })
    }

    const connection = await connectionManager.getConnection(userId, appType)

    if (!connection) {
      return res.json({
        appType: adapter.appType,
        displayName: adapter.displayName,
        description: adapter.description,
        status: 'disconnected',
        healthStatus: 'unknown',
        connectionInfo: null
      })
    }

    // Get additional connection info from adapter
    const connectionInfo = adapter.getConnectionInfo(userId)

    res.json({
      ...connection,
      displayName: adapter.displayName,
      description: adapter.description,
      connectionInfo,
      lastHealthCheckAt: connection.lastHealthCheckAt?.toISOString(),
      lastSuccessfulActivityAt: connection.lastSuccessfulActivityAt?.toISOString(),
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString()
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/connections/:appType/connect
 * Initiate connection for an app
 */
router.post<AppTypeParams>('/:appType/connect', async (req, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    const { appType } = req.params
    const options = req.body

    const adapter = connectionManager.getAdapter(appType)
    if (!adapter) {
      return res.status(404).json({ error: `App type '${appType}' not found` })
    }

    await connectionManager.connect(userId, appType, options)

    const connection = await connectionManager.getConnection(userId, appType)
    res.json({
      success: true,
      connection: connection ? {
        ...connection,
        lastHealthCheckAt: connection.lastHealthCheckAt?.toISOString(),
        lastSuccessfulActivityAt: connection.lastSuccessfulActivityAt?.toISOString(),
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString()
      } : null
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/connections/:appType/disconnect
 * Disconnect an app
 */
router.post<AppTypeParams>('/:appType/disconnect', async (req, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    const { appType } = req.params

    const adapter = connectionManager.getAdapter(appType)
    if (!adapter) {
      return res.status(404).json({ error: `App type '${appType}' not found` })
    }

    await connectionManager.disconnect(userId, appType)

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/connections/:appType/health-check
 * Trigger a health check for an app
 */
router.post<AppTypeParams>('/:appType/health-check', async (req, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    const { appType } = req.params

    const adapter = connectionManager.getAdapter(appType)
    if (!adapter) {
      return res.status(404).json({ error: `App type '${appType}' not found` })
    }

    const result = await connectionManager.performHealthCheck(userId, appType)

    res.json({
      ...result,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/connections/:appType/health-events
 * Get health event log for debugging
 */
router.get<AppTypeParams>('/:appType/health-events', async (req, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    const { appType } = req.params
    const limit = parseInt(req.query.limit as string) || 50

    const adapter = connectionManager.getAdapter(appType)
    if (!adapter) {
      return res.status(404).json({ error: `App type '${appType}' not found` })
    }

    const events = await connectionManager.getHealthEvents(userId, appType, limit)

    res.json(events.map(event => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    })))
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/connections/apps/available
 * List all available/registered app types
 */
router.get('/apps/available', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const apps = connectionManager.getRegisteredApps()
    res.json(apps)
  } catch (error) {
    next(error)
  }
})

export default router
