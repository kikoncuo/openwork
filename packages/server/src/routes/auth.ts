/**
 * Authentication routes
 */

import { Router } from 'express'
import { hashPassword, verifyPassword, generateToken } from '../services/auth/index.js'
import { createUser, getUserByEmail, isEmailTaken, getUserById } from '../services/db/users.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

/**
 * POST /api/auth/register
 * Create a new user account
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body

    // Validate input
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Invalid email format' })
      return
    }

    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    // Check if email is already taken
    if (isEmailTaken(email)) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password)
    const user = createUser({
      email,
      passwordHash,
      name: name || undefined
    })

    // Generate token
    const tokens = generateToken(user.user_id, user.email)

    res.status(201).json({
      user: {
        userId: user.user_id,
        email: user.email,
        name: user.name
      },
      ...tokens
    })
  } catch (error) {
    console.error('[Auth] Register error:', error)
    res.status(500).json({ error: 'Failed to create account' })
  }
})

/**
 * POST /api/auth/login
 * Authenticate a user and return JWT
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    // Validate input
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    // Find user by email
    const user = getUserByEmail(email)
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash)
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    // Generate token
    const tokens = generateToken(user.user_id, user.email)

    res.json({
      user: {
        userId: user.user_id,
        email: user.email,
        name: user.name
      },
      ...tokens
    })
  } catch (error) {
    console.error('[Auth] Login error:', error)
    res.status(500).json({ error: 'Failed to login' })
  }
})

/**
 * POST /api/auth/logout
 * Logout user (client-side token removal)
 * This endpoint exists for consistency but tokens are stateless
 */
router.post('/logout', (_req, res) => {
  // JWT tokens are stateless, so logout is handled client-side
  // This endpoint can be used for audit logging or token blacklisting in the future
  res.json({ success: true })
})

/**
 * GET /api/auth/me
 * Get the currently authenticated user
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = getUserById(req.user!.userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      userId: user.user_id,
      email: user.email,
      name: user.name
    })
  } catch (error) {
    console.error('[Auth] Get user error:', error)
    res.status(500).json({ error: 'Failed to get user' })
  }
})

export default router
