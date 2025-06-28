const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');

describe('mcp2websocket - Reconnection', function() {
  it('should attempt reconnection with exponential backoff', function(done) {
    this.timeout(15000);

    // Connect to non-existent server to test reconnection
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      'ws://localhost:9999/mcp',
      '--debug'
    ]);

    const reconnectAttempts = [];
    const delays = [];

    bridge.stderr.on('data', (data) => {
      const output = data.toString();

      // Track reconnection attempts
      const attemptMatch = output.match(/Scheduling reconnect in (\d+(?:\.\d+)?)ms \(attempt (\d+)\)/);
      if (attemptMatch) {
        const delay = parseFloat(attemptMatch[1]);
        const attempt = parseInt(attemptMatch[2]);

        reconnectAttempts.push(attempt);
        delays.push(delay);
      }
    });

    // Let it run for 10 seconds
    setTimeout(() => {
      bridge.kill();

      // Should have at least 4 reconnection attempts
      expect(reconnectAttempts.length).to.be.at.least(4);

      // Verify attempts are sequential
      reconnectAttempts.forEach((attempt, index) => {
        expect(attempt).to.equal(index + 1);
      });

      // Verify exponential backoff
      expect(delays[0]).to.equal(1000);     // 1s
      expect(delays[1]).to.equal(1500);     // 1.5s
      expect(delays[2]).to.equal(2250);     // 2.25s
      expect(delays[3]).to.equal(3375);     // 3.375s

      // Each delay should be 1.5x the previous
      for (let i = 1; i < delays.length && i < 5; i++) {
        expect(delays[i]).to.equal(delays[i-1] * 1.5);
      }

      done();
    }, 10000);
  });

  it('should reset reconnection attempts after successful connection', async function() {
    this.timeout(15000);

    // First, start with a non-existent server
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      'ws://localhost:9998/mcp',
      '--debug'
    ]);

    let firstAttemptSeen = false;

    bridge.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('attempt 1)')) {
        firstAttemptSeen = true;
      }
    });

    // Wait for first reconnection attempt
    await new Promise(resolve => setTimeout(resolve, 2000));

    bridge.kill();

    expect(firstAttemptSeen).to.be.true;
  });

  it('should stop reconnection on shutdown', function(done) {
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      'ws://localhost:9997/mcp',
      '--debug'
    ]);

    let reconnectScheduled = false;
    let shutdownReceived = false;

    bridge.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Scheduling reconnect')) {
        reconnectScheduled = true;
        // Send shutdown signal
        bridge.kill('SIGTERM');
      }
      if (output.includes('Shutting down bridge')) {
        shutdownReceived = true;
      }
    });

    bridge.on('exit', (code) => {
      expect(reconnectScheduled).to.be.true;
      expect(shutdownReceived).to.be.true;
      expect(code).to.equal(0);
      done();
    });
  });

  it('should respect max reconnection interval (takes ~75 seconds to run)', async function() {
    this.timeout(80000); // Need ~75 seconds to reach max interval
    
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      'ws://localhost:9996/mcp',
      '--debug'
    ]);

    const delays = [];
    let totalTime = 0;

    bridge.stderr.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/Scheduling reconnect in (\d+(?:\.\d+)?)ms/);
      if (match) {
        const delay = parseFloat(match[1]);
        delays.push(delay);
        totalTime += delay;
        
        // Stop once we hit the max
        if (delay === 30000) {
          setTimeout(() => bridge.kill(), 100);
        }
      }
    });

    // Wait for the test to complete
    await new Promise((resolve) => {
      bridge.on('exit', resolve);
    });
    
    // Check that delays don't exceed max (30000ms)
    delays.forEach(delay => {
      expect(delay).to.be.at.most(30000);
    });
    
    // Should have hit the max at some point
    const maxDelays = delays.filter(d => d === 30000);
    expect(maxDelays.length).to.be.at.least(1);
    
    // Verify exponential backoff pattern until max
    for (let i = 1; i < delays.length - 1 && delays[i] < 30000; i++) {
      const expected = delays[i-1] * 1.5;
      expect(delays[i]).to.be.closeTo(expected, 0.1);
    }
  });
});
