/**
 * Authentication service - handles password hashing and JWT tokens
 */

import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'openwork-dev-secret-change-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const BCRYPT_ROUNDS = 12

export interface JwtPayload {
  userId: string
  email: string
  iat?: number
  exp?: number
}

export interface AuthTokens {
  accessToken: string
  expiresIn: string
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Generate a JWT access token
 */
export function generateToken(userId: string, email: string): AuthTokens {
  const payload: JwtPayload = {
    userId,
    email
  }

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']
  })

  return {
    accessToken,
    expiresIn: JWT_EXPIRES_IN
  }
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, throws an error if invalid
 */
export function verifyToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    return decoded
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token')
    }
    throw error
  }
}

/**
 * Decode a JWT token without verifying (useful for debugging)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | null
  } catch {
    return null
  }
}

/**
 * Extract token from Authorization header
 * Expects format: "Bearer <token>"
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7) // Remove "Bearer " prefix
}
