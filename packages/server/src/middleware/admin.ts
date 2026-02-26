/**
 * Admin authorization middleware
 * Checks is_admin from DB on every request (not from JWT) so revoking admin takes effect immediately.
 */

import { Request, Response, NextFunction } from 'express'
import { verifyToken, extractTokenFromHeader } from '../services/auth/index.js'
import { getUserById } from '../services/db/users.js'

/**
 * Middleware that requires admin privileges.
 * Extracts token, verifies JWT, loads user from DB, checks is_admin === 1.
 * Returns 403 if not admin.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractTokenFromHeader(req.headers.authorization)

  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const payload = verifyToken(token)

    // Verify user still exists and is admin (always read from DB, not JWT)
    const user = await getUserById(payload.userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    if (user.is_admin !== 1) {
      res.status(403).json({ error: 'Admin access required' })
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
