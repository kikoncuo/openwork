/**
 * Google OAuth Server - Local HTTP server for OAuth callback handling
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { URL } from 'url'
import { OAuth2Client } from 'google-auth-library'

// OAuth credentials (from environment variables)
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''

// OAuth scopes
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
]

interface OAuthResult {
  tokens: {
    access_token: string
    refresh_token: string
    expiry_date: number
    scope: string
  }
  email: string
}

export class OAuthServer {
  private server: Server | null = null
  private oauth2Client: OAuth2Client | null = null
  private port: number = 0
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private resolveCallback: ((result: OAuthResult) => void) | null = null
  private rejectCallback: ((error: Error) => void) | null = null

  /**
   * Start the OAuth flow
   * Returns the authorization URL to open in the browser
   */
  async startOAuthFlow(): Promise<string> {
    // Find an available port
    this.port = await this.findAvailablePort()
    const redirectUri = `http://localhost:${this.port}/callback`

    // Create OAuth client
    this.oauth2Client = new OAuth2Client(
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri
    )

    // Generate authorization URL
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent' // Force consent to get refresh token
    })

    // Start local server to receive callback
    await this.startServer()

    console.log('[Google OAuth] Started OAuth flow, auth URL:', authUrl)
    return authUrl
  }

  /**
   * Wait for OAuth callback
   * Returns tokens and email when callback is received
   */
  waitForCallback(): Promise<OAuthResult> {
    return new Promise((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject

      // Set timeout (5 minutes)
      this.timeoutId = setTimeout(() => {
        this.cleanup()
        reject(new Error('OAuth flow timed out after 5 minutes'))
      }, 5 * 60 * 1000)
    })
  }

  /**
   * Find an available port
   */
  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tempServer = createServer()
      tempServer.listen(0, () => {
        const address = tempServer.address()
        if (address && typeof address === 'object') {
          const port = address.port
          tempServer.close(() => resolve(port))
        } else {
          tempServer.close(() => reject(new Error('Failed to find available port')))
        }
      })
      tempServer.on('error', reject)
    })
  }

  /**
   * Start the local HTTP server
   */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))

      this.server.listen(this.port, () => {
        console.log(`[Google OAuth] Callback server listening on port ${this.port}`)
        resolve()
      })

      this.server.on('error', (err) => {
        console.error('[Google OAuth] Server error:', err)
        reject(err)
      })
    })
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`)

    if (url.pathname !== '/callback') {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(this.getErrorPage(error))
      this.cleanup()
      this.rejectCallback?.(new Error(`OAuth error: ${error}`))
      return
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(this.getErrorPage('No authorization code received'))
      this.cleanup()
      this.rejectCallback?.(new Error('No authorization code received'))
      return
    }

    try {
      // Exchange code for tokens
      if (!this.oauth2Client) {
        throw new Error('OAuth client not initialized')
      }

      const { tokens } = await this.oauth2Client.getToken(code)

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Missing required tokens from Google')
      }

      // Set credentials to get user info
      this.oauth2Client.setCredentials(tokens)

      // Get user email
      const email = await this.getUserEmail(tokens.access_token)

      // Send success page
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(this.getSuccessPage(email))

      // Resolve with result
      const result: OAuthResult = {
        tokens: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
          scope: tokens.scope || SCOPES.join(' ')
        },
        email
      }

      this.cleanup()
      this.resolveCallback?.(result)
    } catch (err) {
      console.error('[Google OAuth] Token exchange error:', err)
      res.writeHead(500, { 'Content-Type': 'text/html' })
      res.end(this.getErrorPage('Failed to complete authentication'))
      this.cleanup()
      this.rejectCallback?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * Get user email from Google
   */
  private async getUserEmail(accessToken: string): Promise<string> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      throw new Error('Failed to get user info')
    }

    const data = await response.json() as { email: string }
    return data.email
  }

  /**
   * Clean up server and timeouts
   */
  cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }

    if (this.server) {
      this.server.close()
      this.server = null
    }

    this.oauth2Client = null
    this.resolveCallback = null
    this.rejectCallback = null
  }

  /**
   * Get success HTML page
   */
  private getSuccessPage(email: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Connected to Google</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #1a1a1a;
      margin: 0 0 10px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
      font-size: 16px;
    }
    .email {
      color: #4285f4;
      font-weight: 500;
    }
    .close-msg {
      margin-top: 20px;
      font-size: 14px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10003;</div>
    <h1>Successfully Connected!</h1>
    <p>Signed in as <span class="email">${email}</span></p>
    <p class="close-msg">You can close this window and return to openwork.</p>
  </div>
</body>
</html>`
  }

  /**
   * Get error HTML page
   */
  private getErrorPage(error: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Connection Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #1a1a1a;
      margin: 0 0 10px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
      font-size: 16px;
    }
    .error {
      color: #e53e3e;
      font-weight: 500;
    }
    .close-msg {
      margin-top: 20px;
      font-size: 14px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10007;</div>
    <h1>Connection Failed</h1>
    <p class="error">${error}</p>
    <p class="close-msg">Please close this window and try again.</p>
  </div>
</body>
</html>`
  }
}

// Export factory function
export function createOAuthServer(): OAuthServer {
  return new OAuthServer()
}
