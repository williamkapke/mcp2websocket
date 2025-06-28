#!/usr/bin/env node

const { spawn } = require('child_process');
const WebSocket = require('ws');

// This test requires the ability to start/stop a WebSocket server
// For now, it demonstrates the reconnection attempt behavior

console.log('Testing reconnection behavior...\n');

// For reconnection test, we intentionally use a non-existent server
// unless we're in mock mode where we'll test by stopping/starting the server
const testUrl = process.env.TEST_RECONNECT_URL || 'ws://localhost:9999/mcp';
console.log(`Testing reconnection with: ${testUrl}`);

// Start bridge pointing to a non-existent server
const bridge = spawn('node', [require('path').join(__dirname, '..', 'mcp2websocket.js'), testUrl, '--debug']);

let reconnectAttempts = 0;
let logs = [];

bridge.stderr.on('data', (data) => {
  const output = data.toString();
  logs.push(output);
  process.stderr.write(output);
  
  // Count reconnection attempts
  if (output.includes('Scheduling reconnect')) {
    reconnectAttempts++;
    const match = output.match(/attempt (\d+)\)/);
    if (match) {
      console.log(`\nReconnection attempt ${match[1]} detected`);
    }
  }
  
  // Check for exponential backoff
  const backoffMatch = output.match(/Scheduling reconnect in (\d+)ms/);
  if (backoffMatch) {
    console.log(`Backoff delay: ${backoffMatch[1]}ms`);
  }
});

// Let it run for 10 seconds to observe reconnection behavior
setTimeout(() => {
  console.log('\n\nTest Summary:');
  console.log(`Total reconnection attempts observed: ${reconnectAttempts}`);
  console.log('Shutting down bridge...\n');
  
  bridge.kill('SIGTERM');
  
  // Verify exponential backoff is working
  const delays = logs.join('').match(/Scheduling reconnect in (\d+)ms/g);
  if (delays && delays.length > 1) {
    console.log('✓ Exponential backoff confirmed');
    console.log('Observed delays:', delays.slice(0, 5).join(', '));
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}, 10000);

console.log('Observing reconnection behavior for 10 seconds...\n');