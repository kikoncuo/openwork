# openwork

A tactical agent interface for [deepagentsjs](https://github.com/langchain-ai/deepagentsjs) - an opinionated harness for building deep agents with filesystem capabilities, planning, and subagent delegation.

## Installation

```bash
npm install -g openwork
# or
npx openwork
```

## Features

- **Chat Interface** - Stream conversations with your AI agent in real-time
- **TODO Tracking** - Visual task list showing agent's planning progress
- **Filesystem Browser** - See files the agent reads, writes, and edits
- **Subagent Monitoring** - Track spawned subagents and their status
- **Human-in-the-Loop** - Approve, edit, or reject sensitive tool calls
- **Multi-Model Support** - Use Claude, GPT-4, Gemini, or local models
- **Thread Persistence** - SQLite-backed conversation history

## Configuration

Set your API keys via environment variables:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="..."
```

Or configure them in the app settings.

## Supported Models

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4, Claude 3.5 Sonnet, Claude 3.5 Haiku |
| OpenAI | GPT-4o, GPT-4o Mini |
| Google | Gemini 2.0 Flash |

## Platform Support

| Platform | Package |
|----------|---------|
| macOS (Apple Silicon) | `@langchain/openwork-darwin-arm64` |
| macOS (Intel) | `@langchain/openwork-darwin-x64` |
| Linux (x64) | `@langchain/openwork-linux-x64` |
| Linux (ARM64) | `@langchain/openwork-linux-arm64` |
| Windows (x64) | `@langchain/openwork-win32-x64` |

## Documentation

For full documentation, visit: https://github.com/langchain-ai/openwork
