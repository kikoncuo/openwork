/**
 * Environment loader - must be imported first in index.ts
 * This ensures environment variables are loaded before any other modules check them
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const envPath = join(__dirname, '..', '.env')

dotenv.config({ path: envPath })

console.log('[Env] Loaded .env from:', envPath)
console.log('[Env] E2B_API_KEY:', process.env.E2B_API_KEY ? 'Set' : 'Not set')
