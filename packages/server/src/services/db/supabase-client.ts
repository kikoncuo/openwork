import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabase: SupabaseClient | null = null

/**
 * Get the singleton Supabase client using service_role key (bypasses RLS).
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      )
    }
    supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return supabase
}

/**
 * Supabase error handler — throws on error for operations that must succeed.
 */
export function throwOnError<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    throw new Error(`Supabase error: ${result.error.message}`)
  }
  return result.data
}
