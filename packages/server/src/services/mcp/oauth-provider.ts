/**
 * MCP OAuthClientProvider implementation
 * Implements the OAuthClientProvider interface from @modelcontextprotocol/sdk
 * to handle OAuth 2.1 + PKCE + Dynamic Client Registration flows.
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { McpOAuthStore } from './oauth-store.js'

const CALLBACK_PORT = 8090

export class McpOAuthProvider implements OAuthClientProvider {
  private serverId: string
  private store: McpOAuthStore
  private port: number
  private _pendingAuthUrl: URL | null = null

  constructor(serverId: string, store: McpOAuthStore, port: number = CALLBACK_PORT) {
    this.serverId = serverId
    this.store = store
    this.port = port
  }

  get redirectUrl(): string | URL {
    return `http://localhost:${this.port}/mcp/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [new URL(this.redirectUrl as string)] as unknown as string[],
      client_name: 'Openwork',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.load<OAuthClientInformationMixed>(this.serverId, 'client_info')) ?? undefined
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.store.save(this.serverId, 'client_info', clientInformation)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.load<OAuthTokens>(this.serverId, 'tokens')) ?? undefined
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.save(this.serverId, 'tokens', tokens)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Store the URL for the frontend to pick up via the OAuth service
    this._pendingAuthUrl = authorizationUrl
    await this.store.save(this.serverId, 'pending_auth_url', authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.save(this.serverId, 'code_verifier', codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.store.load<string>(this.serverId, 'code_verifier')
    if (!verifier) {
      throw new Error('No code verifier found')
    }
    return verifier
  }

  /**
   * Get the pending authorization URL (set during redirectToAuthorization)
   */
  async getPendingAuthUrl(): Promise<URL | null> {
    if (this._pendingAuthUrl) return this._pendingAuthUrl
    const stored = await this.store.load<string>(this.serverId, 'pending_auth_url')
    return stored ? new URL(stored) : null
  }

  /**
   * Clear the pending auth URL after it has been consumed
   */
  async clearPendingAuthUrl(): Promise<void> {
    this._pendingAuthUrl = null
    await this.store.deleteKey(this.serverId, 'pending_auth_url')
  }

  /**
   * Invalidate credentials when server indicates they're no longer valid
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    switch (scope) {
      case 'all':
        await this.store.clearServer(this.serverId)
        break
      case 'client':
        await this.store.deleteKey(this.serverId, 'client_info')
        break
      case 'tokens':
        await this.store.deleteKey(this.serverId, 'tokens')
        break
      case 'verifier':
        await this.store.deleteKey(this.serverId, 'code_verifier')
        break
    }
  }
}
