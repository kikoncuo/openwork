# Tier System - Future Work

This document describes the current tier implementation and planned future tiers.

## Current Implementation (Tier 1 - Free)

### Features
- Single default model only (`claude-sonnet-4-5-20250929`)
- No model selection UI visible
- API keys managed server-side (in `packages/server/.env`)
- `model_default` field on agents is preserved but ignored at runtime

### Database Schema
```sql
-- User tiers table
CREATE TABLE user_tiers (
  tier_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  default_model TEXT NOT NULL,
  available_models TEXT NOT NULL,  -- JSON array
  features TEXT NOT NULL,          -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

-- Users have tier_id column
ALTER TABLE users ADD COLUMN tier_id INTEGER DEFAULT 1
```

### Tier 1 Configuration
```json
{
  "tier_id": 1,
  "name": "free",
  "display_name": "Free",
  "default_model": "claude-sonnet-4-5-20250929",
  "available_models": ["claude-sonnet-4-5-20250929"],
  "features": {
    "model_selection": false,
    "custom_providers": false
  }
}
```

---

## Tier 2: Pro (Model Choice) - Future

### Planned Features
- Users can select from multiple models
- ModelSwitcher component visible in chat UI
- Agent `model_default` field respected at runtime
- Access to premium models (Claude Opus, GPT-4, etc.)

### Implementation Checklist
- [ ] Add Tier 2 to `user_tiers` table with expanded `available_models`
- [ ] Update frontend to check `tier.features.model_selection`
- [ ] ModelSwitcher already hidden/shown based on this flag
- [ ] Agent settings model selector already hidden/shown based on this flag
- [ ] Runtime already validates model in `available_models`

### Tier 2 Configuration (Example)
```json
{
  "tier_id": 2,
  "name": "pro",
  "display_name": "Pro",
  "default_model": "claude-sonnet-4-5-20250929",
  "available_models": [
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-5-20251101",
    "gpt-4o",
    "gemini-2.5-pro"
  ],
  "features": {
    "model_selection": true,
    "custom_providers": false
  }
}
```

---

## Tier 3: Enterprise (Custom Providers) - Future

### Planned Features
- Users provide their own API keys
- Support for custom Ollama, custom provider URLs
- Keys stored per-user (encrypted in database)
- Full control over model endpoints

### Implementation Checklist
- [ ] Create `user_api_keys` table for per-user encrypted key storage
- [ ] Re-enable API Keys tab in Settings UI
- [ ] Update `getApiKey()` in storage to check user keys first, fall back to server keys
- [ ] Add provider URL configuration to agent settings
- [ ] Support Ollama and custom endpoints

### Database Schema (Planned)
```sql
CREATE TABLE user_api_keys (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,  -- AES-256 encrypted
  provider_url TEXT,                 -- Custom endpoint URL (for Ollama, etc.)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)
```

### Tier 3 Configuration (Example)
```json
{
  "tier_id": 3,
  "name": "enterprise",
  "display_name": "Enterprise",
  "default_model": "claude-sonnet-4-5-20250929",
  "available_models": ["*"],  -- All models available
  "features": {
    "model_selection": true,
    "custom_providers": true
  }
}
```

---

## API Endpoint

### GET /api/user/tier
Returns the current user's tier information:

```json
{
  "tier_id": 1,
  "name": "free",
  "display_name": "Free",
  "default_model": "claude-sonnet-4-5-20250929",
  "available_models": ["claude-sonnet-4-5-20250929"],
  "features": {
    "model_selection": false,
    "custom_providers": false
  }
}
```

---

## Migration Path

### Upgrading Users
```sql
-- Upgrade a user to Tier 2
UPDATE users SET tier_id = 2, updated_at = ? WHERE user_id = ?

-- Downgrade a user to Tier 1
UPDATE users SET tier_id = 1, updated_at = ? WHERE user_id = ?
```

### Adding New Tiers
```sql
INSERT INTO user_tiers (tier_id, name, display_name, default_model, available_models, features, created_at, updated_at)
VALUES (
  2,
  'pro',
  'Pro',
  'claude-sonnet-4-5-20250929',
  '["claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101", "gpt-4o"]',
  '{"model_selection": true, "custom_providers": false}',
  ?,
  ?
)
```

---

## Files Involved

### Backend
- `packages/server/src/services/db/index.ts` - Schema and User type
- `packages/server/src/services/db/tiers.ts` - Tier CRUD operations
- `packages/server/src/services/storage.ts` - API key retrieval
- `packages/server/src/services/agent/runtime.ts` - Tier-enforced model selection
- `packages/server/src/routes/tiers.ts` - Tier API endpoint
- `packages/server/.env` - Server-side API keys

### Frontend
- `packages/web/src/lib/store.ts` - `userTier` state and `loadUserTier()`
- `packages/web/src/api/index.ts` - `user.getTier()` API client
- `packages/web/src/types.ts` - `UserTier` interface
- `packages/web/src/components/settings/SettingsDialog.tsx` - Model selector hidden for Tier 1
- `packages/web/src/components/chat/ModelSwitcher.tsx` - Hidden for Tier 1
- `packages/web/src/App.tsx` - Loads user tier on init
