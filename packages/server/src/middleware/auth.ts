/**
 * Authentication middleware for Express routes
 */

import { Request, Response, NextFunction } from 'express'
import { verifyToken, extractTokenFromHeader, JwtPayload } from '../services/auth/index.js'
import { getUserById } from '../services/db/users.js'

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        email: string
      }
    }
  }
}

/**
 * Middleware that requires authentication
 * Returns 401 if no valid token is provided
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromHeader(req.headers.authorization)

  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const payload = verifyToken(token)

    // Verify user still exists
    const user = getUserById(payload.userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    // Attach user info to request
    req.user = {
      userId: payload.userId,
      email: payload.email
    }

    next()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed'
    res.status(401).json({ error: message })
  }
}

/**
 * Middleware that optionally authenticates
 * Attaches user to request if valid token is provided, but doesn't fail if not
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromHeader(req.headers.authorization)

  if (!token) {
    // No token provided, continue without user
    next()
    return
  }

  try {
    const payload = verifyToken(token)

    // Verify user still exists
    const user = getUserById(payload.userId)
    if (user) {
      req.user = {
        userId: payload.userId,
        email: payload.email
      }
    }
  } catch {
    // Invalid token, continue without user
  }

  next()
}

/**
 * Helper to verify socket.io connections with JWT
 * Used in websocket handlers
 */
export function verifySocketAuth(token: string): JwtPayload | null {
  try {
    const payload = verifyToken(token)
    const user = getUserById(payload.userId)
    if (!user) return null
    return payload
  } catch {
    return null
  }
}
