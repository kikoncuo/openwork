# MCP Integration Proposals for deepagents

**Date**: 2026-01-18
**Context**: Integrating multi-provider MCP server support into openwork's deepagents runtime

## Background

Our MCP infrastructure is complete:
- ✅ Storage layer (CRUD operations, JSON persistence)
- ✅ UI component (Settings → MCP Servers)
- ✅ IPC handlers
- ✅ Type system
- ✅ Multi-provider LangChain MCP tools verified (Anthropic, OpenAI)

**Challenge**: The `deepagents` library doesn't support passing MCP tools to model invocations yet.

## Provider-Specific Requirements

### Anthropic MCP
Requires **TWO** components for model invocation:

1. **MCP Toolset**: Created with `tools.mcpToolset_20251120()`
2. **MCP Server Config**: Passed via `mcp_servers` parameter in invoke options

```typescript
import { ChatAnthropic, tools } from "@langchain/anthropic";

const model = new ChatAnthropic({ model: "claude-sonnet-4-5-20250929" });

const response = await model.invoke("task", {
  mcp_servers: [{
    type: "url",
    url: "https://example.com/mcp/sse",
    name: "example-mcp",
    authorization_token: "TOKEN"
  }],
  tools: [
    tools.mcpToolset_20251120({ serverName: "example-mcp" })
  ]
});
```

### OpenAI MCP
Requires **ONE** component:

1. **MCP Tool**: Created with `tools.mcp()` (server URL embedded)

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { tools } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o" });

const response = await model.invoke("task", {
  tools: [
    tools.mcp({
      serverLabel: "example-mcp",
      serverUrl: "https://example.com/mcp/sse",
      requireApproval: "always"
    })
  ]
});
```

### Google
❌ No MCP support currently available

---

## Integration Approaches

## Approach 1: Direct Tool Pass-Through ⭐ **RECOMMENDED**

**Strategy**: Pass MCP tools directly to `createDeepAgent` and use `.bind()` for Anthropic's `mcp_servers`.

### Implementation

```typescript
// src/main/agent/runtime.ts

import { tools as anthropicTools } from "@langchain/anthropic";
import { tools as openaiTools } from "@langchain/openai";

function createMCPTools(provider: string, servers: MCPServerConfig[]) {
  const mcpTools: Array<ServerTool | ClientTool> = [];

  for (const server of servers) {
    if (provider === 'anthropic') {
      // Create Anthropic MCP toolset
      const toolset = anthropicTools.mcpToolset_20251120({
        serverName: server.name,
        defaultConfig: { enabled: true },
        configs: server.toolConfigs || {}
      });
      mcpTools.push(toolset);

    } else if (provider === 'openai') {
      // Create OpenAI MCP tool
      const tool = openaiTools.mcp({
        serverLabel: server.name,
        serverUrl: server.url!,
        serverDescription: `MCP server: ${server.name}`,
        requireApproval: server.defaultRequireInterrupt ? 'always' : 'never'
      });
      mcpTools.push(tool);
    }
  }

  return mcpTools;
}

export async function createAgentRuntime(options: CreateAgentRuntimeOptions) {
  const { threadId, modelId, workspacePath } = options;

  const mcpServers = getEnabledMCPServers();

  // Determine provider from model ID
  const provider = modelId?.startsWith('claude') ? 'anthropic'
    : (modelId?.startsWith('gpt') || modelId?.startsWith('o')) ? 'openai'
    : modelId?.startsWith('gemini') ? 'google'
    : 'anthropic'; // default

  // Create base model
  let model = getModelInstance(modelId);

  // For Anthropic: bind mcp_servers to model
  if (provider === 'anthropic' && mcpServers.length > 0) {
    const mcpServerConfigs = mcpServers.map(server => ({
      type: server.type,
      url: server.url,
      name: server.name,
      authorization_token: server.authToken
    }));

    // Use .bind() to attach mcp_servers to all invocations
    model = model.bind({ mcp_servers: mcpServerConfigs });
  }

  // Create MCP tools
  const mcpTools = createMCPTools(provider, mcpServers);

  const checkpointer = await getCheckpointer(threadId);
  const backend = new LocalSandbox({ rootDir: workspacePath });
  const systemPrompt = getSystemPrompt(workspacePath);

  // Pass MCP tools to createDeepAgent
  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    tools: mcpTools,  // <-- MCP tools added here
    filesystemSystemPrompt,
    interruptOn: buildInterruptConfig(mcpServers)
  });

  return agent;
}
```

### Pros
✅ **Clean**: Uses deepagents' standard `tools` parameter
✅ **Provider-agnostic**: Works for both Anthropic and OpenAI
✅ **No forking**: Doesn't require modifying deepagents
✅ **Type-safe**: Proper TypeScript types from LangChain
✅ **Leverages .bind()**: Anthropic's `mcp_servers` bound at model level

### Cons
⚠️ **Assumes .bind() works**: Requires testing that `.bind({ mcp_servers: ... })` persists through ReactAgent
⚠️ **Limited to URL servers**: STDIO servers may not work (needs testing)
⚠️ **Anthropic-specific binding**: Requires conditional logic for provider

### Testing Required
1. Verify `.bind()` persists `mcp_servers` through LangGraph ReactAgent invocations
2. Test both URL and STDIO MCP server types
3. Confirm interrupt/approval configurations work
4. Validate tool execution and responses

---

## Approach 2: Model Wrapper

**Strategy**: Wrap the model to inject MCP configuration on every invoke.

### Implementation

```typescript
class MCPWrappedModel extends ChatAnthropic {
  private mcpServers: MCPServerConfig[];

  constructor(config: any, mcpServers: MCPServerConfig[]) {
    super(config);
    this.mcpServers = mcpServers;
  }

  async invoke(input: any, options: any = {}) {
    // Inject mcp_servers into options
    const mcpServerConfigs = this.mcpServers.map(server => ({
      type: server.type,
      url: server.url,
      name: server.name,
      authorization_token: server.authToken
    }));

    return super.invoke(input, {
      ...options,
      mcp_servers: mcpServerConfigs
    });
  }
}

// In runtime.ts
const model = new MCPWrappedModel(config, mcpServers);
```

### Pros
✅ **Explicit control**: Direct control over invoke parameters
✅ **Guaranteed injection**: `mcp_servers` always passed
✅ **Works with any provider**: Can create provider-specific wrappers

### Cons
❌ **Complex**: Requires wrapping multiple model classes
❌ **Maintenance burden**: Must update wrappers for new providers
❌ **Type safety issues**: May break TypeScript inference
❌ **Overrides behavior**: Could conflict with deepagents internals

---

## Approach 3: Custom Middleware

**Strategy**: Create deepagents middleware that injects MCP tools and configuration.

### Implementation

```typescript
import { createMiddleware } from "deepagents";

function createMCPMiddleware(servers: MCPServerConfig[]) {
  return createMiddleware({
    name: "MCPMiddleware",
    onInvoke: async (request, next) => {
      // Modify request to include MCP tools
      const provider = detectProvider(request.model);
      const mcpTools = createMCPTools(provider, servers);

      request.tools = [...(request.tools || []), ...mcpTools];

      if (provider === 'anthropic') {
        request.config = {
          ...request.config,
          mcp_servers: servers.map(toAnthropicFormat)
        };
      }

      return next(request);
    }
  });
}

// In runtime.ts
const agent = createDeepAgent({
  model,
  middleware: [createMCPMiddleware(mcpServers)],
  ...
});
```

### Pros
✅ **Uses extension mechanism**: Leverages deepagents' middleware system
✅ **Clean separation**: MCP logic isolated in middleware
✅ **Reusable**: Middleware can be shared across agents

### Cons
❌ **Uncertain compatibility**: deepagents middleware API may not support this use case
❌ **Complex**: Requires deep understanding of middleware lifecycle
❌ **Fragile**: Could break with deepagents updates
❌ **May not work**: Middleware might not have access to model invoke options

---

## Approach 4: Fork deepagents (Long-term)

**Strategy**: Fork deepagents and add native MCP support, then submit PR upstream.

### Implementation

```typescript
// In forked deepagents/src/agent.ts

interface CreateDeepAgentParams {
  model?: BaseLanguageModel | string;
  tools?: StructuredTool[];
  mcpServers?: MCPServerConfig[];  // <-- NEW
  // ... existing params
}

export function createDeepAgent(params: CreateDeepAgentParams) {
  const { model, tools, mcpServers, ... } = params;

  // Auto-detect provider
  const provider = detectProvider(model);

  // Generate MCP tools based on provider
  const mcpTools = mcpServers
    ? createMCPToolsForProvider(provider, mcpServers)
    : [];

  // Bind mcp_servers for Anthropic
  let boundModel = model;
  if (provider === 'anthropic' && mcpServers?.length) {
    boundModel = model.bind({
      mcp_servers: mcpServers.map(toAnthropicFormat)
    });
  }

  return createReactAgent({
    model: boundModel,
    tools: [...tools, ...mcpTools],
    ...
  });
}
```

### Pros
✅ **Proper solution**: Native support in the library
✅ **Benefits community**: Can be upstreamed via PR
✅ **Clean API**: Simple `mcpServers` parameter
✅ **Full control**: Can optimize for all providers

### Cons
❌ **Time-intensive**: Requires forking, testing, maintaining
❌ **Upstream dependency**: May not get merged quickly
❌ **Versioning issues**: Must keep fork in sync with upstream
❌ **Deployment complexity**: Must use forked version

---

## Recommendation: **Approach 1** (Direct Tool Pass-Through)

### Rationale

1. **Immediate**: Can be implemented now without waiting for upstream
2. **Minimal risk**: Uses standard deepagents APIs (`tools` parameter)
3. **Proven pattern**: `.bind()` is a standard LangChain pattern
4. **Testable**: Easy to validate with existing test infrastructure
5. **Reversible**: If it doesn't work, can pivot to Approach 2

### Implementation Plan

#### Phase 1: Basic Integration (1-2 hours)
1. Update `src/main/agent/runtime.ts`:
   - Add `createMCPTools()` function
   - Use `.bind()` for Anthropic `mcp_servers`
   - Pass MCP tools to `createDeepAgent`

2. Test with simple MCP server:
   - Anthropic + URL MCP server
   - OpenAI + URL MCP server

#### Phase 2: Full Provider Support (2-3 hours)
1. Add provider detection logic
2. Implement per-tool interrupt configuration
3. Test STDIO MCP servers
4. Add error handling and logging

#### Phase 3: Documentation (1 hour)
1. Update `CLAUDE.md` with usage examples
2. Add runtime integration examples
3. Document known limitations

#### Phase 4: E2E Testing (2-3 hours)
1. Create comprehensive E2E tests
2. Test all provider combinations
3. Validate interrupt/approval flows
4. Performance testing

### Fallback Strategy

If `.bind()` doesn't work as expected:
- **Immediate**: Fall back to **Approach 2** (Model Wrapper)
- **Long-term**: Submit issue/PR to deepagents for **Approach 4** (Native Support)

### Success Criteria

✅ MCP tools accessible to agents for Anthropic models
✅ MCP tools accessible to agents for OpenAI models
✅ Interrupt/approval configurations respected
✅ No breaking changes to existing functionality
✅ Clear error messages when MCP fails

---

## Alternative: Hybrid Approach

If Approach 1's `.bind()` only works partially, combine strategies:

1. **OpenAI**: Use direct tool pass-through (works immediately)
2. **Anthropic**: Use Model Wrapper temporarily while waiting for upstream fix
3. **Future**: Migrate to native support when available

This allows shipping MCP for OpenAI immediately while solving Anthropic separately.

---

## References

- [LangChain MCP Documentation](https://docs.langchain.com/oss/javascript/langchain/mcp)
- [@langchain/anthropic MCP Toolset](https://js.langchain.com/docs/integrations/tools/anthropic_mcp)
- [@langchain/openai MCP Tool](https://js.langchain.com/docs/integrations/tools/openai_mcp)
- [deepagents Documentation](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
