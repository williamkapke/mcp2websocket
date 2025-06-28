#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('Starting bridge test...');

// Use test server URL if available, otherwise default
const serverUrl = process.env.TEST_SERVER_URL || 'ws://localhost:61822/mcp';
console.log(`Connecting to: ${serverUrl}`);

// Start the bridge
const bridge = spawn('node', [require('path').join(__dirname, '..', 'mcp2websocket.js'), serverUrl, '--debug']);

// Handle bridge stdout (responses from WebSocket server)
bridge.stdout.on('data', (data) => {
  console.log('Response:', data.toString().trim());
});

// Handle bridge stderr (debug logs)
bridge.stderr.on('data', (data) => {
  console.error(data.toString().trim());
});

// Send initialize request after a short delay to ensure connection
setTimeout(() => {
  console.log('Sending initialize request...');
  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  });
  
  bridge.stdin.write(initRequest + '\n');
}, 1000);

// Keep the process running for a bit to see responses
setTimeout(() => {
  console.log('Test complete, shutting down...');
  bridge.kill('SIGTERM');
  process.exit(0);
}, 5000);

bridge.on('error', (err) => {
  console.error('Bridge error:', err);
});

bridge.on('exit', (code) => {
  console.log('Bridge exited with code:', code);
});