/**
 * PostgreSQL checkpointer using @langchain/langgraph-checkpoint-postgres
 * Replaces per-thread SqlJsSaver with a shared Postgres-backed checkpointer.
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

let checkpointer: PostgresSaver | null = null
let setupPromise: Promise<void> | null = null

/**
 * Get the shared PostgresSaver singleton.
 * All threads share one checkpointer, differentiated by thread_id in the composite PK.
 */
export async function getPostgresCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointer) {
    const connString = process.env.SUPABASE_DB_URL
    if (!connString) {
      throw new Error('Missing SUPABASE_DB_URL environment variable for LangGraph checkpointer')
    }

    checkpointer = PostgresSaver.fromConnString(connString)

    // Run setup once (creates tables if they don't exist)
    setupPromise = checkpointer.setup()
    await setupPromise
    setupPromise = null

    console.log('[Checkpointer] PostgresSaver initialized')
  }

  // Wait for setup if it's still running
  if (setupPromise) {
    await setupPromise
  }

  return checkpointer
}

/**
 * Close the PostgresSaver and release the connection pool.
 */
export async function closePostgresCheckpointer(): Promise<void> {
  if (checkpointer) {
    await checkpointer.end()
    checkpointer = null
    setupPromise = null
    console.log('[Checkpointer] PostgresSaver closed')
  }
}
