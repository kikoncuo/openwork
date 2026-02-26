# Microsoft Teams Integration Setup

This document describes how the Microsoft Teams integration was configured for OpenWork.

## Azure App Registration

The integration uses OAuth 2.0 Authorization Code flow via Microsoft Entra ID (Azure AD).

### App Details

- **App Name**: OpenWork Teams Integration
- **Application (client) ID**: `2756fbbb-6058-447c-b57e-3a2f5f13105d`
- **Directory (tenant) ID**: `8a646b6c-26ca-4a8e-9b0f-5e7adb9f5a78`
- **Redirect URI**: `http://localhost:8091/oauth/callback` (Web platform)
- **Supported account types**: Single tenant (configured with specific tenant ID)

### Azure Portal Links

- **App Registrations**: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
- **This App's Overview**: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/2756fbbb-6058-447c-b57e-3a2f5f13105d

### How It Was Created

1. Went to [Azure Portal - App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Clicked **"New registration"**
3. Set name to "OpenWork Teams Integration"
4. Selected **"Accounts in this organizational directory only"** (single tenant)
5. Set redirect URI to **Web** → `http://localhost:8091/oauth/callback`
6. Clicked **Register**

### Client Secret

- Generated under **Certificates & secrets** → **New client secret**
- **Secret ID**: `4d7f5dad-6272-449f-964a-d3622bee3ecc`
- The secret value is stored in `packages/server/.env` as `MS_OAUTH_CLIENT_SECRET`

> **Note**: Client secrets expire. Check the expiration date in Azure Portal and rotate before it expires.

### API Permissions (Delegated)

The following **delegated** Microsoft Graph permissions were added under **API permissions**:

| Permission | Purpose |
|---|---|
| `User.Read` | Read the signed-in user's profile |
| `User.ReadBasic.All` | Search and read basic profiles of all users in the org |
| `Team.ReadBasic.All` | List teams the user has joined |
| `Channel.ReadBasic.All` | List channels in teams |
| `ChannelMessage.Read.All` | Read channel messages |
| `ChannelMessage.Send` | Send messages to channels |
| `TeamMember.Read.All` | List team members and their roles |
| `Chat.ReadBasic` | List the user's chats |
| `Chat.ReadWrite` | Create chats and send chat messages |
| `ChatMessage.Read` | Read chat messages |
| `ChatMessage.Send` | Send chat messages |

Admin consent was granted for the tenant.

## Environment Variables

Set in `packages/server/.env`:

```env
MS_OAUTH_CLIENT_ID=2756fbbb-6058-447c-b57e-3a2f5f13105d
MS_OAUTH_CLIENT_SECRET=<secret value>
MS_OAUTH_TENANT_ID=8a646b6c-26ca-4a8e-9b0f-5e7adb9f5a78
```

## Architecture

### OAuth Flow

1. User clicks **Connect** in Settings → Apps → Microsoft Teams
2. Server generates an authorization URL pointing to `login.microsoftonline.com`
3. Browser opens a popup for Microsoft sign-in
4. After consent, Microsoft redirects to `http://localhost:8091/oauth/callback` with an auth code
5. Server exchanges the code for access + refresh tokens
6. Tokens are encrypted (AES-256-GCM) and stored in SQLite
7. WebSocket notifies the frontend of connection success

### Token Refresh

- The `offline_access` scope is requested, providing a refresh token
- Tokens are automatically refreshed when within 60 seconds of expiry
- Refreshed tokens are re-encrypted and stored

### OAuth Callback Server

- Runs on **port 8091** (Google Workspace uses 8089)
- Only starts when a connection is initiated
- Handles the redirect from Microsoft's OAuth flow

## Agent Tools (15 total)

### Read-only (no approval needed)
- `teams_get_current_user` - Get authenticated user's profile
- `teams_search_users` - Search org directory
- `teams_get_user` - Get a specific user's profile
- `teams_list_teams` - List joined teams
- `teams_list_channels` - List channels in a team
- `teams_list_team_members` - List team members
- `teams_get_channel_messages` - Read channel messages
- `teams_get_channel_message_replies` - Read thread replies
- `teams_list_chats` - List 1:1 and group chats
- `teams_get_chat_messages` - Read chat messages
- `teams_search_messages` - Search across Teams (Microsoft Search API)

### Write (requires human approval)
- `teams_send_channel_message` - Send to a channel
- `teams_reply_to_channel_message` - Reply in a thread
- `teams_send_chat_message` - Send in a chat
- `teams_create_chat` - Create a new 1:1 or group chat

## File Structure

```
packages/server/src/
├── services/apps/microsoft-teams/
│   ├── index.ts        # Core service (OAuth, Graph API, all operations)
│   ├── tools.ts        # LangChain agent tools (15 tools)
│   ├── types.ts        # TypeScript type definitions
│   └── auth-store.ts   # Encrypted token storage (SQLite + AES-256-GCM)
├── routes/microsoft-teams.ts      # REST API endpoints
└── websocket/microsoft-teams.ts   # WebSocket connection events

packages/web/src/
├── components/settings/apps/MicrosoftTeamsSettings.tsx  # Settings UI
└── api/index.ts                                          # API client (microsoftTeams section)
```

## Troubleshooting

### "OAuth credentials not configured"
Ensure `MS_OAUTH_CLIENT_ID` and `MS_OAUTH_CLIENT_SECRET` are set in `.env`.

### "Token exchange failed"
- Verify the redirect URI in Azure matches exactly: `http://localhost:8091/oauth/callback`
- Check that the client secret hasn't expired

### "Insufficient privileges" / 403 errors
- Ensure all API permissions are added in Azure Portal
- Grant admin consent if required by your organization

### Port 8091 already in use
The OAuth callback server shares the port across connection attempts. If another process uses 8091, change the `OAUTH_PORT` constant in `index.ts`.
