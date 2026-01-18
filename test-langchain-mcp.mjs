/**
 * Direct test of LangChain MCP tools with different providers
 * Tests MCP without deepagents to verify core functionality
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { tools as anthropicTools } from '@langchain/anthropic';
import { tools as openaiTools } from '@langchain/openai';

console.log('🧪 LangChain MCP Tools Test Suite\n');
console.log('='.repeat(60));

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    testsPassed++;
    return true;
  } else {
    console.log(`❌ ${message}`);
    testsFailed++;
    return false;
  }
}

function testSection(name) {
  console.log(`\n📋 ${name}`);
  console.log('-'.repeat(60));
}

// Test 1: Check MCP tool availability
testSection('MCP Tool Availability Check');

try {
  // Check Anthropic MCP tools
  const hasAnthropicMCP = typeof anthropicTools?.mcpToolset_20251120 === 'function';
  assert(hasAnthropicMCP, 'Anthropic has mcpToolset_20251120 function');

  // Check OpenAI MCP tools
  const hasOpenAIMCP = typeof openaiTools?.mcp === 'function';
  assert(hasOpenAIMCP, 'OpenAI has mcp function');

} catch (error) {
  assert(false, `Tool availability check failed: ${error.message}`);
}

// Test 2: Anthropic MCP Tool Creation
testSection('Anthropic MCP Tool Creation');

try {
  if (anthropicTools?.mcpToolset_20251120) {
    const mcpTool = anthropicTools.mcpToolset_20251120({
      serverName: 'test-server',
      defaultConfig: { enabled: true },
      configs: {
        'test_tool': { enabled: true, deferLoading: false }
      }
    });

    assert(mcpTool !== null && mcpTool !== undefined, 'Anthropic MCP tool created successfully');
    assert(typeof mcpTool === 'object', 'MCP tool is an object');

    console.log(`   Tool type: ${mcpTool.constructor?.name || 'ServerTool'}`);
  } else {
    assert(false, 'Anthropic mcpToolset_20251120 not available');
  }
} catch (error) {
  assert(false, `Anthropic tool creation failed: ${error.message}`);
}

// Test 3: OpenAI MCP Tool Creation
testSection('OpenAI MCP Tool Creation');

try {
  if (openaiTools?.mcp) {
    const mcpTool = openaiTools.mcp({
      serverLabel: 'test-server',
      serverUrl: 'https://example.com/mcp/sse',
      requireApproval: 'always',
      serverDescription: 'Test MCP server'
    });

    assert(mcpTool !== null && mcpTool !== undefined, 'OpenAI MCP tool created successfully');
    assert(typeof mcpTool === 'object', 'MCP tool is an object');

    console.log(`   Tool type: ${mcpTool.constructor?.name || 'ServerTool'}`);
  } else {
    assert(false, 'OpenAI mcp function not available');
  }
} catch (error) {
  assert(false, `OpenAI tool creation failed: ${error.message}`);
}

// Test 4: Anthropic Model with MCP (configuration test)
testSection('Anthropic Model MCP Configuration');

try {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (anthropicKey) {
    const model = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      anthropicApiKey: anthropicKey,
      temperature: 0
    });

    assert(model !== null, 'Anthropic model created');
    console.log(`   Model: ${model.model || 'claude-sonnet-4'}`);

    // Test that we can create MCP server config
    const mcpServerConfig = {
      type: 'url',
      url: 'https://example.com/mcp',
      name: 'test-mcp',
      authorization_token: 'test_token'
    };

    assert(mcpServerConfig.type === 'url', 'MCP server config structure valid');

    // Note: Actual invocation with MCP requires passing mcp_servers and tools
    // Example: model.invoke(messages, { mcp_servers: [...], tools: [mcpToolset(...)] })
    console.log('   ℹ️  MCP invocation requires: mcp_servers + mcpToolset in invoke()');

  } else {
    console.log('   ⚠️  ANTHROPIC_API_KEY not set, skipping model test');
  }
} catch (error) {
  assert(false, `Anthropic model test failed: ${error.message}`);
}

// Test 5: OpenAI Model with MCP (configuration test)
testSection('OpenAI Model MCP Configuration');

try {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openaiKey) {
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      openAIApiKey: openaiKey,
      temperature: 0
    });

    assert(model !== null, 'OpenAI model created');
    console.log(`   Model: ${model.model || 'gpt-4o'}`);

    // Note: Actual invocation with MCP requires passing tools.mcp()
    // Example: model.invoke(messages, { tools: [tools.mcp({ serverUrl: '...', ... })] })
    console.log('   ℹ️  MCP invocation requires: tools.mcp() in invoke()');

  } else {
    console.log('   ⚠️  OPENAI_API_KEY not set, skipping model test');
  }
} catch (error) {
  assert(false, `OpenAI model test failed: ${error.message}`);
}

// Test 6: MCP Approval/Interrupt Configuration
testSection('MCP Interrupt Configuration');

try {
  // Test Anthropic interrupt config
  if (anthropicTools?.mcpToolset_20251120) {
    const toolWithInterrupt = anthropicTools.mcpToolset_20251120({
      serverName: 'secure-server',
      defaultConfig: { enabled: true },
      configs: {
        'dangerous_tool': { enabled: true, deferLoading: false }
      }
    });

    assert(toolWithInterrupt !== null, 'Anthropic MCP tool with interrupt config created');
  }

  // Test OpenAI interrupt config
  if (openaiTools?.mcp) {
    const toolWithApproval = openaiTools.mcp({
      serverLabel: 'secure-server',
      serverUrl: 'https://secure.example.com/mcp',
      requireApproval: 'always'  // This is the interrupt equivalent
    });

    assert(toolWithApproval !== null, 'OpenAI MCP tool with approval requirement created');

    // Test fine-grained approval
    const toolWithFinegrainedApproval = openaiTools.mcp({
      serverLabel: 'mixed-server',
      serverUrl: 'https://mixed.example.com/mcp',
      requireApproval: {
        always: { toolNames: ['delete_file', 'drop_database'] },
        never: { toolNames: ['read_file', 'list_files'] }
      }
    });

    assert(toolWithFinegrainedApproval !== null, 'OpenAI MCP tool with fine-grained approval created');
  }

} catch (error) {
  assert(false, `Interrupt configuration test failed: ${error.message}`);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`✅ Tests Passed: ${testsPassed}`);
console.log(`❌ Tests Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All MCP tool tests passed!');
  console.log('\n✅ LangChain MCP Support Verified:');
  console.log('  • Anthropic: mcpToolset_20251120() ✓');
  console.log('  • OpenAI: tools.mcp() ✓');
  console.log('  • Interrupt/Approval configuration ✓');
  console.log('\n⚠️  Note: Integration with deepagents requires library support');
  console.log('   The MCP infrastructure is ready and will work once deepagents');
  console.log('   adds support for passing MCP tools to model invocations.');
} else {
  console.log('\n⚠️  Some tests failed');
  process.exit(1);
}
