# Development Guide

This guide explains how to run openwork in development mode. The project supports two modes:

1. **Electron Mode** - Desktop application with full system access
2. **Web Mode** - Browser-based client with a separate backend server

## Prerequisites

- Node.js 18+
- pnpm 10.28.0+ (specified in `packageManager` field)

Install pnpm if needed:
```bash
npm install -g pnpm
```

## Initial Setup

```bash
# Clone the repository
git clone https://github.com/langchain-ai/openwork.git
cd openwork

# Install dependencies
pnpm install
```

## Electron Mode (Desktop)

Electron mode runs as a native desktop application with the main process handling agent execution directly.

### Start Development

```bash
npm run dev
```

This runs `electron-vite dev` which:
- Starts the Vite dev server for hot-reloading the renderer (React frontend)
- Launches Electron with the main process
- Opens DevTools automatically in development

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm start
```

## Web Mode (Browser)

Web mode runs openwork in a browser with a separate Express backend server. This is useful for:
- Running without Electron dependencies
- Remote/cloud deployments
- Development on systems where Electron is problematic

### Architecture

```
packages/
├── server/   # @openwork/server - Express backend (port 3001)
└── web/      # @openwork/web - React frontend (port 5173)
```

### Start Development

**Option 1: Run both server and client together**
```bash
npm run web:dev
```

This runs both in parallel:
- Backend server at `http://localhost:3001`
- Frontend at `http://localhost:5173`

**Option 2: Run server and client separately (recommended for debugging)**

Terminal 1 - Start the backend server:
```bash
npm run web:dev:server
```

Terminal 2 - Start the frontend:
```bash
npm run web:dev:client
```

### Access the Application

Open your browser to: **http://localhost:5173**

### Build for Production

```bash
npm run web:build
```

### Start Production Server

```bash
npm run web:start
```

## Environment Variables

Create a `.env` file in the project root (for Electron) or `packages/server/.env` (for web mode):

```env
# API Keys (at least one required)
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here

# Optional: LangSmith tracing
LANGCHAIN_API_KEY=your_key_here
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=openwork
```

## Common Issues

### Port Already in Use

If port 5173 or 3001 is in use:
```bash
# Find and kill the process
lsof -i :5173
kill -9 <PID>
```

### pnpm Not Found

If you get pnpm errors, ensure you're using the correct version:
```bash
corepack enable
corepack prepare pnpm@10.28.0 --activate
```

### TypeScript Errors

Run type checking separately to identify issues:
```bash
npm run typecheck
```

## Development Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron dev mode |
| `npm run web:dev` | Start web mode (server + client) |
| `npm run web:dev:server` | Start only the backend server |
| `npm run web:dev:client` | Start only the frontend |
| `npm run build` | Build Electron app |
| `npm run web:build` | Build web mode |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

## Debugging

### Electron Mode
- **Renderer process**: Use Chrome DevTools (opens automatically)
- **Main process**: Add `--inspect` flag or use `console.log`

### Web Mode
- **Frontend**: Browser DevTools at `http://localhost:5173`
- **Backend**: Server logs appear in the terminal running `web:dev:server`
