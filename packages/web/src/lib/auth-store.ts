/**
 * Authentication state management using Zustand
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface User {
  userId: string
  email: string
  name: string | null
}

export interface AuthState {
  // State
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
  setToken: (token: string) => void
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      // Set token (used for manual token setting, e.g., from URL params)
      setToken: (token: string) => {
        set({ accessToken: token })
      },

      // Clear error
      clearError: () => {
        set({ error: null })
      },

      // Check if current token is valid
      checkAuth: async () => {
        const { accessToken } = get()

        if (!accessToken) {
          set({ user: null, isAuthenticated: false, isLoading: false })
          return
        }

        try {
          const response = await fetch(`${API_BASE}/auth/me`, {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          })

          if (response.ok) {
            const user = await response.json()
            set({
              user,
              isAuthenticated: true,
              isLoading: false,
              error: null
            })
          } else {
            // Token is invalid
            set({
              user: null,
              accessToken: null,
              isAuthenticated: false,
              isLoading: false
            })
          }
        } catch (error) {
          console.error('[Auth] Check auth error:', error)
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false
          })
        }
      },

      // Login with email and password
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Login failed')
          }

          const data = await response.json()

          set({
            user: data.user,
            accessToken: data.accessToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed'
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: message
          })
          throw error
        }
      },

      // Register a new account
      register: async (email: string, password: string, name?: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, name })
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Registration failed')
          }

          const data = await response.json()

          set({
            user: data.user,
            accessToken: data.accessToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Registration failed'
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: message
          })
          throw error
        }
      },

      // Logout
      logout: async () => {
        const { accessToken } = get()

        try {
          // Call logout endpoint (optional, for audit logging)
          if (accessToken) {
            await fetch(`${API_BASE}/auth/logout`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            })
          }
        } catch (error) {
          console.error('[Auth] Logout error:', error)
        }

        // Clear state regardless of API response
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isLoading: false,
          error: null
        })
      }
    }),
    {
      name: 'openwork-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)

/**
 * Hook to get the current access token.
 * Useful for making authenticated API calls.
 */
export function useAccessToken(): string | null {
  return useAuthStore((state) => state.accessToken)
}

/**
 * Get the access token synchronously (for use outside of React components).
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken
}
