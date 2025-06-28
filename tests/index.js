#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const MockMCPServer = require('./mock-server');

console.log('Running mcp2websocket test suite...\n');

async function runTests() {
  // Start mock server
  const mockServer = new MockMCPServer();
  const port = await mockServer.start();
  const serverUrl = mockServer.getUrl();
  
  console.log(`✓ Mock MCP server started at ${serverUrl}\n`);
  
  // Set environment variable for tests to use
  process.env.TEST_SERVER_URL = serverUrl;
  
  // Run test suites
  const tests = [
    { name: 'Basic functionality', file: path.join(__dirname, 'test-bridge.js') },
    { name: 'Comprehensive suite', file: path.join(__dirname, 'test-comprehensive.js') },
    { name: 'Reconnection behavior', file: path.join(__dirname, 'test-reconnection.js') }
  ];
  
  let currentIndex = 0;
  let allPassed = true;
  
  function runNextTest() {
    if (currentIndex >= tests.length) {
      // Cleanup
      mockServer.stop().then(() => {
        if (allPassed) {
          console.log('\n✅ All tests completed successfully!');
          process.exit(0);
        } else {
          console.log('\n❌ Some tests failed');
          process.exit(1);
        }
      });
      return;
    }
    
    const test = tests[currentIndex];
    console.log(`\n📋 Running: ${test.name}`);
    console.log('─'.repeat(50));
    
    const child = spawn('node', [test.file], {
      stdio: 'inherit',
      env: { ...process.env, TEST_SERVER_URL: serverUrl }
    });
    
    child.on('error', (err) => {
      console.error(`\n❌ Failed to run ${test.file}: ${err.message}`);
      allPassed = false;
      currentIndex++;
      runNextTest();
    });
    
    child.on('exit', (code) => {
      if (code !== 0) {
        console.error(`\n❌ ${test.name} failed with code ${code}`);
        allPassed = false;
      }
      currentIndex++;
      runNextTest();
    });
  }
  
  runNextTest();
}

// Run with error handling
runTests().catch(error => {
  console.error('Failed to start test suite:', error);
  process.exit(1);
});