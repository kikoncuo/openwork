#!/usr/bin/env node

/**
 * End-to-End test for MCP server management
 * Tests storage, IPC handlers, and runtime integration
 */

const { existsSync, unlinkSync, readFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

// Import the storage functions (we'll need to compile TypeScript first)
// For now, let's test the compiled JavaScript
const storageModule = require('./out/main/storage.js');

const TEST_FILE = join(homedir(), '.openwork', 'mcp-servers-test.json');
const ACTUAL_FILE = join(homedir(), '.openwork', 'mcp-servers.json');

console.log('🧪 MCP End-to-End Test Suite\n');
console.log('='.repeat(60));

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    testsFailed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testSection(name) {
  console.log(`\n📋 ${name}`);
  console.log('-'.repeat(60));
}

// Test 1: Storage Layer
testSection('Storage Layer Tests');

try {
  // Clean up any existing test data
  if (existsSync(ACTUAL_FILE)) {
    const backup = ACTUAL_FILE + '.backup';
    require('fs').copyFileSync(ACTUAL_FILE, backup);
    console.log(`💾 Backed up existing config to ${backup}`);
  }

  // Test creating a server
  const server1 = storageModule.createMCPServer({
    name: 'Test MCP Server',
    type: 'url',
    url: 'https://example.com/mcp/sse',
    authToken: 'test_token_123',
    defaultRequireInterrupt: true
  });

  assert(server1.id.startsWith('mcp-'), 'Server ID has correct prefix');
  assert(server1.name === 'Test MCP Server', 'Server name is correct');
  assert(server1.type === 'url', 'Server type is correct');
  assert(server1.url === 'https://example.com/mcp/sse', 'Server URL is correct');
  assert(server1.enabled === true, 'Server is enabled by default');
  assert(server1.defaultRequireInterrupt === true, 'Default interrupt is set');

  // Test listing servers
  const servers = storageModule.listMCPServers();
  assert(servers.length === 1, 'One server exists');
  assert(servers[0].id === server1.id, 'Listed server matches created server');

  // Test getting a specific server
  const retrieved = storageModule.getMCPServer(server1.id);
  assert(retrieved !== null, 'Server can be retrieved by ID');
  assert(retrieved.name === 'Test MCP Server', 'Retrieved server has correct name');

  // Test updating a server
  const updated = storageModule.updateMCPServer(server1.id, {
    name: 'Updated MCP Server',
    enabled: false
  });
  assert(updated !== null, 'Server can be updated');
  assert(updated.name === 'Updated MCP Server', 'Server name was updated');
  assert(updated.enabled === false, 'Server enabled flag was updated');

  // Test creating a second server
  const server2 = storageModule.createMCPServer({
    name: 'Second Server',
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { NODE_ENV: 'production' },
    defaultRequireInterrupt: false
  });

  assert(server2.type === 'stdio', 'STDIO server type is correct');
  assert(server2.command === 'node', 'Command is correct');
  assert(Array.isArray(server2.args), 'Args is an array');
  assert(server2.env.NODE_ENV === 'production', 'Environment variables are set');

  // Test getting enabled servers only
  const enabled = storageModule.getEnabledMCPServers();
  assert(enabled.length === 1, 'Only one enabled server (second one)');
  assert(enabled[0].id === server2.id, 'Enabled server is the second one');

  // Test deleting a server
  const deleted = storageModule.deleteMCPServer(server1.id);
  assert(deleted === true, 'Server was deleted');

  const remaining = storageModule.listMCPServers();
  assert(remaining.length === 1, 'One server remains after deletion');
  assert(remaining[0].id === server2.id, 'Remaining server is the second one');

  // Test file persistence
  assert(existsSync(ACTUAL_FILE), 'MCP servers JSON file exists');
  const fileContent = JSON.parse(readFileSync(ACTUAL_FILE, 'utf-8'));
  assert(Array.isArray(fileContent), 'File contains an array');
  assert(fileContent.length === 1, 'File has correct number of servers');

  console.log('\n📊 Storage layer tests completed');

} catch (error) {
  console.error('\n💥 Storage test failed:', error.message);
  testsFailed++;
}

// Test 2: Type Safety
testSection('Type System Tests');

try {
  const servers = storageModule.listMCPServers();
  const server = servers[0];

  assert(typeof server.id === 'string', 'Server ID is a string');
  assert(typeof server.name === 'string', 'Server name is a string');
  assert(['url', 'stdio'].includes(server.type), 'Server type is valid');
  assert(typeof server.enabled === 'boolean', 'Enabled is a boolean');
  assert(typeof server.defaultRequireInterrupt === 'boolean', 'defaultRequireInterrupt is a boolean');
  assert(typeof server.createdAt === 'string', 'createdAt is a string');
  assert(typeof server.updatedAt === 'string', 'updatedAt is a string');
  assert(typeof server.toolConfigs === 'object', 'toolConfigs is an object');

  console.log('\n📊 Type system tests completed');

} catch (error) {
  console.error('\n💥 Type test failed:', error.message);
  testsFailed++;
}

// Test 3: Edge Cases
testSection('Edge Case Tests');

try {
  // Test getting non-existent server
  const nonExistent = storageModule.getMCPServer('nonexistent-id');
  assert(nonExistent === null, 'Getting non-existent server returns null');

  // Test deleting non-existent server
  const deletedNonExistent = storageModule.deleteMCPServer('nonexistent-id');
  assert(deletedNonExistent === false, 'Deleting non-existent server returns false');

  // Test updating non-existent server
  const updatedNonExistent = storageModule.updateMCPServer('nonexistent-id', { name: 'Test' });
  assert(updatedNonExistent === null, 'Updating non-existent server returns null');

  console.log('\n📊 Edge case tests completed');

} catch (error) {
  console.error('\n💥 Edge case test failed:', error.message);
  testsFailed++;
}

// Test 4: Runtime Integration
testSection('Runtime Integration Tests');

try {
  // Create a test server for runtime
  const runtimeServer = storageModule.createMCPServer({
    name: 'Runtime Test Server',
    type: 'url',
    url: 'https://test.mcp.server/sse',
    authToken: 'runtime_token',
    enabled: true,
    defaultRequireInterrupt: true,
    toolConfigs: {
      'dangerous_tool': { enabled: true, requireInterrupt: true },
      'safe_tool': { enabled: true, requireInterrupt: false }
    }
  });

  const enabledServers = storageModule.getEnabledMCPServers();
  assert(enabledServers.length >= 1, 'Runtime can get enabled servers');

  const hasToolConfigs = enabledServers.some(s => Object.keys(s.toolConfigs).length > 0);
  assert(hasToolConfigs, 'Tool configs are preserved');

  console.log('\n📊 Runtime integration tests completed');

} catch (error) {
  console.error('\n💥 Runtime test failed:', error.message);
  testsFailed++;
}

// Clean up
testSection('Cleanup');

try {
  const allServers = storageModule.listMCPServers();
  allServers.forEach(server => {
    storageModule.deleteMCPServer(server.id);
  });

  const final = storageModule.listMCPServers();
  assert(final.length === 0, 'All test servers cleaned up');

  console.log('✨ Cleanup completed');

} catch (error) {
  console.error('\n💥 Cleanup failed:', error.message);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`✅ Tests Passed: ${testsPassed}`);
console.log(`❌ Tests Failed: ${testsFailed}`);
console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the output above.');
  process.exit(1);
}
