# openwork

[![npm][npm-badge]][npm-url] [![License: MIT][license-badge]][license-url]

[npm-badge]: https://img.shields.io/npm/v/openwork.svg
[npm-url]: https://www.npmjs.com/package/openwork
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

A web-based platform for [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) — an opinionated harness for building deep agents with filesystem capabilities, planning, and subagent delegation.

![openwork screenshot](docs/screenshot.png)

> [!CAUTION]
> openwork gives AI agents direct access to your filesystem and the ability to execute shell commands. Always review tool calls before approving them, and only run in workspaces you trust.

## Get Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
git clone https://github.com/langchain-ai/openwork.git
cd openwork
pnpm install
```

### Running the Web App

Start the server and web client:

```bash
# Terminal 1: Start the backend server
cd packages/server
pnpm dev

# Terminal 2: Start the web frontend
cd packages/web
pnpm dev
```

The server runs on `http://localhost:3001` and the web app on `http://localhost:5173`.

### Environment Variables

Create a `.env` file in `packages/server/`:

```bash
# Required: At least one AI provider API key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
GOOGLE_API_KEY=your-google-key

# Optional: JWT secret for authentication (auto-generated if not set)
JWT_SECRET=your-secret-key
```

## Features

- **AI Agents** - Create and manage AI agents with customizable system prompts
- **App Connections** - Connect external apps like WhatsApp for automated responses
- **Health Monitoring** - Real-time connection health status and alerts
- **Webhooks** - Integrate with external services via webhook events

## Supported Models

| Provider  | Models                                                            |
| --------- | ----------------------------------------------------------------- |
| Anthropic | Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.1, Claude Sonnet 4 |
| OpenAI    | GPT-5.2, GPT-5.1, o3, o3 Mini, o4 Mini, o1, GPT-4.1, GPT-4o       |
| Google    | Gemini 3 Pro Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite |

## Documentation

- [App Connection Guide](docs/apps/README.md) - Connect WhatsApp and other apps
- [Developer Integration](docs/apps/INTEGRATION.md) - REST API and WebSocket events
- [Adding New Apps](docs/apps/NEW_APP_GUIDE.md) - Build custom app adapters
- [Webhook Integration](docs/webhooks/README.md) - Set up webhook notifications

## Desktop App (Electron)

OpenWork is also available as a standalone desktop application:

```bash
# Run directly with npx
npx openwork

# Or install globally
npm install -g openwork
openwork
```

To run the Electron app from source:

```bash
cd openwork
pnpm install
pnpm run dev:electron
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Report bugs via [GitHub Issues](https://github.com/langchain-ai/openwork/issues).

## License

MIT — see [LICENSE](LICENSE) for details.
