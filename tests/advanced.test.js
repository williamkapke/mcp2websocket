const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');
const MockMCPServer = require('./mock-server');

describe('mcp2websocket - Advanced Features', function() {
  let mockServer;
  let serverUrl;

  before(async function() {
    mockServer = new MockMCPServer();
    const port = await mockServer.start();
    serverUrl = mockServer.getUrl();
  });

  after(async function() {
    await mockServer.stop();
  });

  describe('Message Handling', function() {
    it('should handle multiple messages in sequence', async function() {
      const bridge = spawn('node', [
        path.join(__dirname, '..', 'mcp2websocket.js'),
        serverUrl
      ]);

      const responses = [];

      bridge.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line) {
            try {
              responses.push(JSON.parse(line));
            } catch (e) {
              // Ignore non-JSON
            }
          }
        });
      });

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send multiple messages
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

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for responses
      await new Promise(resolve => setTimeout(resolve, 1000));

      bridge.kill();

      expect(responses).to.have.lengthOf(3);
      responses.forEach((response, index) => {
        expect(response.id).to.equal(index + 1);
        expect(response).to.have.property('result');
      });
    });

    it('should queue messages when not connected', function(done) {
      const bridge = spawn('node', [
        path.join(__dirname, '..', 'mcp2websocket.js'),
        serverUrl,
        '--debug'
      ]);

      // Send message immediately before connection
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

      let queuedMessage = false;
      let receivedResponse = false;

      bridge.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('queuing message')) {
          queuedMessage = true;
        }
      });

      bridge.stdout.on('data', (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === 1) {
            receivedResponse = true;
          }
        } catch (e) {
          // Ignore non-JSON
        }
      });

      setTimeout(() => {
        bridge.kill();
        expect(queuedMessage).to.be.true;
        expect(receivedResponse).to.be.true;
        done();
      }, 2000);
    });

    it('should handle malformed JSON gracefully', function(done) {
      const bridge = spawn('node', [
        path.join(__dirname, '..', 'mcp2websocket.js'),
        serverUrl,
        '--debug'
      ]);

      let errorLogged = false;
      let stillWorking = false;

      bridge.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Failed to parse stdin message')) {
          errorLogged = true;

          // Send valid message after error
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
        }
      });

      bridge.stdout.on('data', (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === 1) {
            stillWorking = true;
          }
        } catch (e) {
          // Ignore
        }
      });

      // Wait for connection then send malformed JSON
      setTimeout(() => {
        bridge.stdin.write('{ invalid json }\n');
      }, 1000);

      setTimeout(() => {
        bridge.kill();
        expect(errorLogged).to.be.true;
        expect(stillWorking).to.be.true;
        done();
      }, 3000);
    });
  });

  describe('Connection Management', function() {
    it('should gracefully shutdown on SIGTERM', function(done) {
      const bridge = spawn('node', [
        path.join(__dirname, '..', 'mcp2websocket.js'),
        serverUrl,
        '--debug'
      ]);

      let shutdownMessage = false;

      bridge.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Shutting down bridge')) {
          shutdownMessage = true;
        }
      });

      // Wait for connection then send SIGTERM
      setTimeout(() => {
        bridge.kill('SIGTERM');
      }, 1000);

      bridge.on('exit', (code) => {
        expect(code).to.equal(0);
        expect(shutdownMessage).to.be.true;
        done();
      });
    });

    it('should maintain heartbeat with ping/pong (takes ~30 seconds to run)', function(done) {
      this.timeout(35000); // Heartbeat interval is 30s

      const bridge = spawn('node', [
        path.join(__dirname, '..', 'mcp2websocket.js'),
        serverUrl,
        '--debug'
      ]);

      let pingReceived = false;

      bridge.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Sending ping')) {
          pingReceived = true;
          bridge.kill(); // Exit once we see ping
        }
      });

      // Set up exit handler
      bridge.on('exit', () => {
        expect(pingReceived).to.be.true;
        done();
      });

      // Fallback timeout
      setTimeout(() => {
        if (!pingReceived) {
          bridge.kill();
          done(new Error('No heartbeat detected within timeout'));
        }
      }, 32000);
    });
  });
});
