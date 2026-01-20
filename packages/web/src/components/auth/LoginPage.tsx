/**
 * Login and Registration page component
 */

import { useState } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type AuthMode = 'login' | 'register'

export function LoginPage(): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { login, register, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setIsSubmitting(true)
    clearError()

    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password, name || undefined)
      }
    } catch {
      // Error is handled by the store
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleMode = (): void => {
    setMode(mode === 'login' ? 'register' : 'login')
    clearError()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-4">
        {/* Logo/Title */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">OpenWork</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-foreground">Name (optional)</label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
              <Input
                id="password"
                type="password"
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
              : (mode === 'login' ? 'Sign in' : 'Create account')}
          </Button>
        </form>

        {/* Toggle mode */}
        <div className="text-center text-sm">
          <span className="text-muted-foreground">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          </span>
          <button
            type="button"
            onClick={toggleMode}
            className="font-medium text-primary hover:underline"
            disabled={isSubmitting}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
