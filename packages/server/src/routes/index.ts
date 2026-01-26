import { Express, Request, Response, NextFunction } from 'express'
import authRouter from './auth.js'
import threadsRouter from './threads.js'
import agentsRouter from './agents.js'
import modelsRouter from './models.js'
import workspaceRouter from './workspace.js'
import mcpRouter from './mcp.js'
import toolsRouter from './tools.js'
import promptRouter from './prompt.js'
import insightsRouter from './insights.js'
import whatsappRouter from './whatsapp.js'
import hooksRouter from './hooks.js'
import connectionsRouter from './connections.js'

export function registerRoutes(app: Express): void {
  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Register all route modules
  app.use('/api/auth', authRouter)
  app.use('/api/threads', threadsRouter)
  app.use('/api/agents', agentsRouter)
  app.use('/api/models', modelsRouter)
  app.use('/api/workspace', workspaceRouter)
  app.use('/api/mcp', mcpRouter)
  app.use('/api/tools', toolsRouter)
  app.use('/api/prompt', promptRouter)
  app.use('/api/insights', insightsRouter)
  app.use('/api/whatsapp', whatsappRouter)
  app.use('/api/hooks', hooksRouter)
  app.use('/api/connections', connectionsRouter)

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]', err)
    res.status(500).json({ error: err.message || 'Internal server error' })
  })
}
