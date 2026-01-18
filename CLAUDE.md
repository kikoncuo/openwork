# CLAUDE.md

This file provides context and guidance for AI assistants (like Claude) working with the openwork codebase.

## Project Overview

**openwork** is a desktop interface for [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) — an opinionated harness for building deep agents with filesystem capabilities, planning, and subagent delegation.

- **Repository**: https://github.com/langchain-ai/openwork
- **License**: MIT
- **Platform**: Cross-platform Electron desktop application
- **Tech Stack**: Electron, React, TypeScript, LangGraph, LangChain

## Architecture

### Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Electron main process, Node.js
- **Agent Framework**: LangGraph, LangChain Core
- **State Management**: Zustand
- **Build System**: Electron Vite
- **Code Quality**: ESLint, Prettier

### Supported AI Models

The application supports multiple AI providers:
- **Anthropic**: Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.1, Claude Sonnet 4
- **OpenAI**: GPT-5.2, GPT-5.1, o3, o3 Mini, o4 Mini, o1, GPT-4.1, GPT-4o
- **Google**: Gemini 3 Pro Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite

## Directory Structure

```
openwork/
├── bin/                    # CLI entry point
├── src/
│   ├── main/              # Electron main process
│   │   ├── agent/         # Agent runtime and system prompts
│   │   ├── checkpointer/  # State persistence
│   │   ├── db/            # Database layer
│   │   ├── ipc/           # Inter-process communication handlers
│   │   └── services/      # Background services (workspace watcher, title generator)
│   ├── preload/           # Electron preload scripts
│   └── renderer/          # React frontend
│       └── src/
│           ├── components/ # React components
│           │   ├── chat/   # Chat interface components
│           │   ├── panels/ # Side panels (filesystem, todos, subagents)
│           │   ├── settings/ # Settings UI
│           │   ├── sidebar/ # Thread sidebar
│           │   ├── tabs/    # File viewer tabs
│           │   └── ui/      # Reusable UI components
│           └── lib/        # Utilities and stores
├── resources/             # Application resources
├── docs/                  # Documentation assets
└── public/               # Static assets
```

## Key Files

### Main Process (Backend)
- `src/main/index.ts` - Main Electron process entry point
- `src/main/agent/runtime.ts` - Agent execution runtime
- `src/main/agent/system-prompt.ts` - System prompt for agents
- `src/main/agent/local-sandbox.ts` - Local filesystem sandbox
- `src/main/ipc/agent.ts` - Agent IPC handlers
- `src/main/ipc/models.ts` - Model management IPC
- `src/main/ipc/threads.ts` - Thread management IPC
- `src/main/storage.ts` - Persistent storage using electron-store

### Renderer Process (Frontend)
- `src/renderer/src/App.tsx` - Main React application
- `src/renderer/src/components/chat/ChatContainer.tsx` - Main chat interface
- `src/renderer/src/components/chat/MessageBubble.tsx` - Message rendering
- `src/renderer/src/components/chat/ToolCallRenderer.tsx` - Tool call visualization
- `src/renderer/src/lib/store.ts` - Zustand state management

## Development Workflow

### Setup
```bash
npm install
npm run dev      # Start development mode
npm run build    # Build for production
```

### Code Quality
```bash
npm run lint     # Run ESLint
npm run format   # Format code with Prettier
npm run typecheck # Type check TypeScript
```

### Project Commands
- `npm run typecheck:node` - Type check main process code
- `npm run typecheck:web` - Type check renderer process code
- `npm start` - Preview built application

## Important Conventions

### Code Style
- Use TypeScript for all new code
- Follow existing ESLint configuration
- Use Prettier for code formatting
- Prefer functional React components with hooks

### File Naming
- React components: PascalCase (e.g., `ChatContainer.tsx`)
- Utilities: kebab-case (e.g., `file-types.ts`)
- Types: Place in separate `.ts` files or inline with implementation

### Component Structure
- UI components are in `src/renderer/src/components/ui/`
- Feature components are organized by domain (chat, panels, tabs, etc.)
- Use Radix UI primitives for accessible components
- Style with Tailwind CSS utility classes

### IPC Communication
- Main process handlers are in `src/main/ipc/`
- Use type-safe IPC with proper TypeScript definitions
- Preload script exposes safe APIs to renderer

## Security Considerations

**CRITICAL**: openwork gives AI agents direct access to:
- Filesystem read/write operations
- Shell command execution
- Workspace directory access

### When Contributing
- Always validate user input before file system operations
- Sanitize shell commands to prevent injection attacks
- Be cautious with path traversal vulnerabilities
- Review tool calls and agent permissions carefully
- Never commit API keys or sensitive credentials

### Testing in Sandbox
- Use isolated workspaces for testing
- Be aware that agents can modify files in the selected workspace
- Review agent actions before approving destructive operations

## MCP Server Integration

**NEW:** openwork now supports MCP (Model Context Protocol) servers for extending agent capabilities across multiple AI providers.

### Provider Support

MCP integration is available through LangChain's native tools:

| Provider | MCP Support | LangChain Function | Status |
|----------|-------------|-------------------|--------|
| **Anthropic** | ✅ Yes | `tools.mcpToolset_20251120()` | Fully Tested |
| **OpenAI** | ✅ Yes | `tools.mcp()` | Fully Tested |
| **Google** | ❌ No | N/A | Not Available |

**Test Results**: 12/12 tests passed verifying multi-provider MCP support. See `MCP_MULTI_PROVIDER_TEST_REPORT.md` for details.

### MCP Architecture
- **Configuration UI**: `src/renderer/src/components/settings/MCPServersSection.tsx`
- **Storage**: JSON-based in `~/.openwork/mcp-servers.json`
- **IPC Handlers**: `src/main/ipc/mcp.ts`
- **Runtime Integration**: `src/main/agent/runtime.ts`
- **Types**: `src/main/types/mcp.ts`

### MCP Server Types
- **URL (SSE)**: Connect to HTTP/HTTPS MCP endpoints
- **STDIO**: Launch local MCP processes

### Adding an MCP Server
1. Open Settings → MCP Servers section
2. Click "Add Server"
3. Configure:
   - Server name and URL
   - Optional authentication token
   - Interrupt settings (require approval before tool calls)
4. Click "Create"

### Interrupt Control
- **Global Server Level**: `defaultRequireInterrupt` - applies to all tools from server
- **Per-Tool Override**: Configure individual tools in `toolConfigs`
- Integrates with existing HITL (Human-in-the-Loop) system

### Provider-Specific Differences

**Anthropic**:
- Uses `tools.mcpToolset_20251120()` for tool creation
- Requires `mcp_servers` array in model invoke
- Interrupt control via external HITL system

**OpenAI**:
- Uses `tools.mcp()` with built-in `requireApproval` parameter
- Supports fine-grained per-tool approval configuration
- Server URL embedded in tool configuration

### Storage Location
MCP server configurations are stored in:
```
~/.openwork/mcp-servers.json
```

### Files Involved
- **Types**: `src/main/types/mcp.ts`
- **Storage**: `src/main/storage.ts` (MCP CRUD functions)
- **IPC**: `src/main/ipc/mcp.ts`
- **Runtime**: `src/main/agent/runtime.ts` (MCP integration and model wrapper)
- **UI**: `src/renderer/src/components/settings/MCPServersSection.tsx`
- **Preload**: `src/preload/index.ts` and `index.d.ts` (window.api.mcp interface)
- **Tests**: `test-mcp-e2e.js`, `test-langchain-mcp.mjs`, `test-mcp-runtime-integration.mjs`

### Implementation Details

**Anthropic Integration**:
- Uses `AnthropicMCPWrapper` class that extends `ChatAnthropic`
- Wrapper automatically injects `mcp_servers` into all `invoke()` and `stream()` calls
- MCP toolsets created with `tools.mcpToolset_20251120()`
- Tool filtering via `defaultConfig` and `configs` parameters

**OpenAI Integration**:
- Direct tool creation with `tools.mcp()`
- Server URL embedded in tool configuration
- Interrupt control via `requireApproval` parameter ('always' | 'never')

**Provider Detection**:
- Automatic detection from model ID
- Creates provider-specific MCP tools
- Falls back gracefully for unsupported providers

### Current Status

✅ **Integration Complete**: MCP server support is fully implemented for Anthropic and OpenAI models. Configure MCP servers in Settings → MCP Servers, and they will be automatically loaded when creating agents.

See `MCP_MULTI_PROVIDER_TEST_REPORT.md` and `MCP_INTEGRATION_PROPOSALS.md` for implementation details and testing results.

## Common Tasks

### Adding a New Model
1. Update model list in `src/main/ipc/models.ts`
2. Add provider support if needed
3. Update README.md supported models table

### Adding a New Tool
1. Define tool in agent runtime (`src/main/agent/runtime.ts`)
2. Add tool call rendering in `src/renderer/src/components/chat/ToolCallRenderer.tsx`
3. Update agent system prompt if needed

### Adding UI Components
1. Place reusable components in `src/renderer/src/components/ui/`
2. Use Radix UI primitives when possible
3. Follow existing Tailwind styling patterns
4. Ensure accessibility (keyboard navigation, ARIA labels)

### Modifying Agent Behavior
- System prompt: `src/main/agent/system-prompt.ts`
- Runtime logic: `src/main/agent/runtime.ts`
- Sandbox configuration: `src/main/agent/local-sandbox.ts`

## Dependencies

### Core Dependencies
- **deepagents**: ^1.5.0 - The core agent framework
- **@langchain/langgraph**: ^1.0.15 - Graph-based agent orchestration
- **electron**: ^39.2.6 - Desktop application framework
- **react**: ^19.2.1 - UI framework
- **zustand**: ^5.0.3 - State management

### Important Notes
- Requires Node.js 18+
- Uses pnpm as package manager (version 10.28.0)
- Electron version locked to 39.2.6

## Debugging

### Electron DevTools
- Renderer process: Built-in Chrome DevTools
- Main process: Use `--inspect` flag or `console.log`

### Common Issues
- IPC communication errors: Check preload script and type definitions
- Agent execution errors: Check system prompt and tool definitions
- Build failures: Ensure TypeScript passes for both node and web targets

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

Key points:
- Follow the existing code style
- Write type-safe TypeScript
- Test thoroughly in isolated workspaces
- Document new features and changes
- Submit PRs with clear descriptions

## Resources

- [deepagentsjs Documentation](https://github.com/langchain-ai/deepagentsjs)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [React Documentation](https://react.dev/)

## Questions or Issues?

- GitHub Issues: https://github.com/langchain-ai/openwork/issues
- Security Issues: See [SECURITY.md](SECURITY.md)
