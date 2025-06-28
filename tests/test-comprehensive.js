#!/usr/bin/env node

const { spawn } = require('child_process');
const WebSocket = require('ws');

// Test configuration
const BRIDGE_URL = process.env.TEST_SERVER_URL || 'ws://localhost:61822/mcp';
const TEST_TIMEOUT = 30000;

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(level, message) {
  const color = {
    info: colors.blue,
    success: colors.green,
    error: colors.red,
    warn: colors.yellow
  }[level] || colors.reset;
  
  console.log(`${color}[${level.toUpperCase()}]${colors.reset} ${message}`);
}

class BridgeTest {
  constructor(name, fn) {
    this.name = name;
    this.fn = fn;
  }

  async run() {
    log('info', `Running test: ${this.name}`);
    try {
      await this.fn();
      log('success', `✓ ${this.name}`);
      return true;
    } catch (error) {
      log('error', `✗ ${this.name}: ${error.message}`);
      console.error(error.stack);
      return false;
    }
  }
}

// Helper to create and manage bridge process
function createBridge(args = []) {
  return spawn('node', [require('path').join(__dirname, '..', 'mcp2websocket.js'), BRIDGE_URL, ...args]);
}

// Helper to wait for a specific pattern in stderr
function waitForLog(bridge, pattern, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for pattern: ${pattern}\nOutput: ${output}`));
    }, timeout);

    const handler = (data) => {
      output += data.toString();
      if (data.toString().includes(pattern)) {
        clearTimeout(timer);
        bridge.stderr.removeListener('data', handler);
        resolve();
      }
    };

    bridge.stderr.on('data', handler);
  });
}

// Helper to collect stdout responses
function collectResponses(bridge, count = 1, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const responses = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${count} responses, got ${responses.length}`));
    }, timeout);

    const handler = (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line) {
          try {
            responses.push(JSON.parse(line));
          } catch (e) {
            // Ignore non-JSON output
          }
        }
      });

      if (responses.length >= count) {
        clearTimeout(timer);
        bridge.stdout.removeListener('data', handler);
        resolve(responses);
      }
    };

    bridge.stdout.on('data', handler);
  });
}

// Test suite
const tests = [
  new BridgeTest('Basic connection and initialization', async () => {
    const bridge = createBridge(['--debug']);
    
    try {
      // Wait for connection
      await waitForLog(bridge, 'WebSocket connected');
      
      // Send initialization
      const responsePromise = collectResponses(bridge, 1);
      bridge.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        },
        id: 1
      }) + '\n');
      
      const [response] = await responsePromise;
      if (!response.result || !response.result.serverInfo) {
        throw new Error('Invalid initialization response');
      }
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Multiple messages in sequence', async () => {
    const bridge = createBridge(['--debug']);
    
    try {
      await waitForLog(bridge, 'WebSocket connected');
      
      // Send multiple messages
      const responsePromise = collectResponses(bridge, 3);
      
      for (let i = 1; i <= 3; i++) {
        bridge.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '0.1.0',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' }
          },
          id: i
        }) + '\n');
        
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const responses = await responsePromise;
      if (responses.length !== 3) {
        throw new Error(`Expected 3 responses, got ${responses.length}`);
      }
      
      // Verify response IDs match
      for (let i = 0; i < 3; i++) {
        if (responses[i].id !== i + 1) {
          throw new Error(`Response ID mismatch: expected ${i + 1}, got ${responses[i].id}`);
        }
      }
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Message queuing during initial connection', async () => {
    const bridge = createBridge(['--debug']);
    
    try {
      // Send message immediately before connection is established
      bridge.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        },
        id: 1
      }) + '\n');
      
      // Wait for the queuing message
      await waitForLog(bridge, 'WebSocket not connected, queuing message');
      
      // Wait for connection and message to be sent
      await waitForLog(bridge, 'WebSocket connected');
      await waitForLog(bridge, 'Sending queued message');
      
      // Verify we get a response
      const [response] = await collectResponses(bridge, 1);
      if (!response.result) {
        throw new Error('No response received for queued message');
      }
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Graceful shutdown', async () => {
    const bridge = createBridge(['--debug']);
    
    try {
      await waitForLog(bridge, 'WebSocket connected');
      
      // Send SIGTERM
      bridge.kill('SIGTERM');
      
      // Wait for shutdown message
      await waitForLog(bridge, 'Shutting down bridge');
      
      // Wait for process to exit
      await new Promise((resolve, reject) => {
        bridge.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Bridge exited with code ${code}`));
          }
        });
      });
    } catch (error) {
      bridge.kill('SIGKILL');
      throw error;
    }
  }),

  new BridgeTest('Error handling - malformed JSON from stdin', async () => {
    const bridge = createBridge(['--debug']);
    
    try {
      await waitForLog(bridge, 'WebSocket connected');
      
      // Send malformed JSON
      bridge.stdin.write('{ invalid json }\n');
      
      // Should see error log but bridge should continue running
      await waitForLog(bridge, 'Failed to parse stdin message');
      
      // Verify bridge is still working by sending valid message
      const responsePromise = collectResponses(bridge, 1);
      bridge.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        },
        id: 1
      }) + '\n');
      
      const [response] = await responsePromise;
      if (!response.result) {
        throw new Error('Bridge not responding after malformed input');
      }
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Authentication token support', async () => {
    const bridge = createBridge(['--token', 'test-token', '--debug']);
    
    try {
      // Just verify it starts without error
      // We can't fully test auth without a server that requires it
      await waitForLog(bridge, 'Starting MCP WebSocket Bridge');
      
      // Send a test message to ensure it's working
      const responsePromise = collectResponses(bridge, 1);
      bridge.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        },
        id: 1
      }) + '\n');
      
      await responsePromise;
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Environment variable support', async () => {
    const env = { ...process.env, DEBUG: 'true', AUTH_TOKEN: 'env-token' };
    const bridge = spawn('node', [require('path').join(__dirname, '..', 'mcp2websocket.js'), BRIDGE_URL], { env });
    
    try {
      // Should see debug output due to DEBUG env var
      await waitForLog(bridge, 'Starting MCP WebSocket Bridge');
      await waitForLog(bridge, 'WebSocket connected');
    } finally {
      bridge.kill();
    }
  }),

  new BridgeTest('Required URL validation', async () => {
    const bridge = spawn('node', [require('path').join(__dirname, '..', 'mcp2websocket.js')]);
    
    try {
      // Should exit with error
      await new Promise((resolve, reject) => {
        let stderr = '';
        bridge.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        bridge.on('exit', (code) => {
          if (code === 1 && stderr.includes('WebSocket URL is required')) {
            resolve();
          } else {
            reject(new Error(`Expected error exit, got code ${code}\nStderr: ${stderr}`));
          }
        });
      });
    } catch (error) {
      bridge.kill();
      throw error;
    }
  })
];

// Run all tests
async function runTests() {
  console.log(`\n${colors.blue}Running mcp2websocket test suite${colors.reset}\n`);
  console.log(`Target server: ${BRIDGE_URL}`);
  console.log(`Total tests: ${tests.length}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    if (await test.run()) {
      passed++;
    } else {
      failed++;
    }
    console.log(''); // Empty line between tests
  }
  
  console.log(`\n${colors.blue}Test Results:${colors.reset}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Set overall timeout
setTimeout(() => {
  log('error', 'Test suite timeout exceeded');
  process.exit(1);
}, TEST_TIMEOUT);

// Run tests
runTests().catch(error => {
  log('error', `Test suite error: ${error.message}`);
  process.exit(1);
});