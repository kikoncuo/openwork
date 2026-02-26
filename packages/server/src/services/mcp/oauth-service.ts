/**
 * MCP OAuth Flow Service
 * Orchestrates the OAuth 2.1 flow using the MCP SDK's auth() helper.
 * Handles authorization initiation, callback processing, and token management.
 */

import http from 'http'
import { URL } from 'url'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { McpOAuthProvider } from './oauth-provider.js'
import { getMcpOAuthStore, type McpOAuthStore } from './oauth-store.js'

const CALLBACK_PORT = 8090

// Track active callback servers per serverId
const activeServers = new Map<string, http.Server>()

// Track pending auth flows: serverId -> { resolve, reject, provider }
const pendingFlows = new Map<string, {
  resolve: (result: { success: boolean }) => void
  reject: (error: Error) => void
  provider: McpOAuthProvider
  serverUrl: string
}>()

/**
 * Start a temporary HTTP server to receive the OAuth callback.
 * The server automatically closes after receiving the callback or timing out.
 */
function startCallbackServer(): Promise<void> {
  // If server already running, don't start another
  if (activeServers.has('callback')) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const parsedUrl = new URL(req.url, `http://localhost:${CALLBACK_PORT}`)

      if (parsedUrl.pathname === '/mcp/oauth/callback') {
        const code = parsedUrl.searchParams.get('code')
        const state = parsedUrl.searchParams.get('state')
        const error = parsedUrl.searchParams.get('error')

        if (error) {
          const errorDesc = parsedUrl.searchParams.get('error_description') || error
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html><body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
              <div style="text-align: center;">
                <h2 style="color: #ef4444;">Authorization Failed</h2>
                <p>${errorDesc}</p>
                <p style="color: #888;">You can close this window.</p>
              </div>
            </body></html>
          `)

          // Reject all pending flows
          for (const [id, flow] of pendingFlows) {
            flow.reject(new Error(`OAuth error: ${errorDesc}`))
            pendingFlows.delete(id)
          }
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body>Missing authorization code</body></html>')
          return
        }

        // Find the pending flow by trying to exchange the code
        // State parameter helps identify which flow this belongs to
        let handled = false
        for (const [id, flow] of pendingFlows) {
          try {
            // Use the MCP SDK auth() helper to exchange the code
            const result = await auth(flow.provider, {
              serverUrl: flow.serverUrl,
              authorizationCode: code
            })

            if (result === 'AUTHORIZED') {
              flow.resolve({ success: true })
              pendingFlows.delete(id)
              handled = true
              break
            }
          } catch (e) {
            console.error(`[MCP OAuth] Code exchange failed for ${id}:`, e)
            flow.reject(e instanceof Error ? e : new Error('Code exchange failed'))
            pendingFlows.delete(id)
            handled = true
            break
          }
        }

        if (handled) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html><body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
              <div style="text-align: center;">
                <h2 style="color: #22c55e;">Authorization Successful</h2>
                <p>You can close this window and return to Openwork.</p>
                <script>setTimeout(() => window.close(), 2000)</script>
              </div>
            </body></html>
          `)
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body>No pending authorization flow found</body></html>')
        }

        // Shut down callback server if no more pending flows
        if (pendingFlows.size === 0) {
          stopCallbackServer()
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.on('error', (err) => {
      console.error('[MCP OAuth] Callback server error:', err)
      activeServers.delete('callback')
      reject(err)
    })

    server.listen(CALLBACK_PORT, () => {
      console.log(`[MCP OAuth] Callback server listening on port ${CALLBACK_PORT}`)
      activeServers.set('callback', server)
      resolve()
    })
  })
}

function stopCallbackServer(): void {
  const server = activeServers.get('callback')
  if (server) {
    server.close(() => {
      console.log('[MCP OAuth] Callback server stopped')
    })
    activeServers.delete('callback')
  }
}

/**
 * Initiate the OAuth authorization flow for a server.
 * Returns the authorization URL that the frontend should open in a popup.
 */
export async function initiateOAuth(serverId: string, serverUrl: string): Promise<string> {
  const store = getMcpOAuthStore()
  const provider = new McpOAuthProvider(serverId, store, CALLBACK_PORT)

  // Start the callback server
  await startCallbackServer()

  // Use the MCP SDK auth() helper to begin the flow
  // This handles: resource metadata discovery, authorization server discovery,
  // dynamic client registration, PKCE, and authorization URL construction
  const result = await auth(provider, { serverUrl })

  if (result === 'AUTHORIZED') {
    // Already authorized (had valid tokens)
    stopCallbackServer()
    return ''
  }

  // result === 'REDIRECT' — get the authorization URL
  const authUrl = await provider.getPendingAuthUrl()
  if (!authUrl) {
    stopCallbackServer()
    throw new Error('Failed to generate authorization URL')
  }

  await provider.clearPendingAuthUrl()

  // Register this as a pending flow for callback handling
  return new Promise((resolve, reject) => {
    // Set a timeout to clean up if the user doesn't complete the flow
    const timeout = setTimeout(() => {
      pendingFlows.delete(serverId)
      if (pendingFlows.size === 0) {
        stopCallbackServer()
      }
      reject(new Error('OAuth flow timed out'))
    }, 5 * 60 * 1000) // 5 minute timeout

    pendingFlows.set(serverId, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(authUrl.toString())
      },
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      },
      provider,
      serverUrl
    })

    // Return the auth URL immediately — don't wait for the callback
    // The frontend will open this URL and poll for status
    resolve(authUrl.toString())
  })
}

/**
 * Handle the OAuth callback manually (alternative to the callback server).
 */
export async function handleOAuthCallback(serverId: string, serverUrl: string, code: string): Promise<boolean> {
  const store = getMcpOAuthStore()
  const provider = new McpOAuthProvider(serverId, store, CALLBACK_PORT)

  try {
    const result = await auth(provider, {
      serverUrl,
      authorizationCode: code
    })
    return result === 'AUTHORIZED'
  } catch (e) {
    console.error(`[MCP OAuth] Callback handling failed for ${serverId}:`, e)
    return false
  }
}

/**
 * Check if a server has valid OAuth authorization.
 */
export async function hasValidAuth(serverId: string): Promise<boolean> {
  const store = getMcpOAuthStore()
  const provider = new McpOAuthProvider(serverId, store, CALLBACK_PORT)
  const tokens = await provider.tokens()
  return tokens !== undefined && !!tokens.access_token
}

/**
 * Revoke all OAuth data for a server.
 */
export function revokeAuth(serverId: string): void {
  const store = getMcpOAuthStore()
  store.clearServer(serverId)
  console.log(`[MCP OAuth] Revoked auth for server ${serverId}`)
}

/**
 * Create an OAuthClientProvider instance for use with MultiServerMCPClient.
 */
export function createOAuthProvider(serverId: string): McpOAuthProvider {
  const store = getMcpOAuthStore()
  return new McpOAuthProvider(serverId, store, CALLBACK_PORT)
}
