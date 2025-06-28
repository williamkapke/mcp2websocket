const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');
const MockMCPServer = require('./mock-server');

describe('mcp2websocket - Basic Functionality', function() {
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

  it('should show help when --help flag is used', function(done) {
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      '--help'
    ]);

    let output = '';
    bridge.stdout.on('data', (data) => {
      output += data.toString();
    });

    bridge.on('exit', (code) => {
      expect(code).to.equal(0);
      expect(output).to.include('Usage: mcp2websocket <url> [options]');
      expect(output).to.include('--token');
      expect(output).to.include('--debug');
      done();
    });
  });

  it('should require URL parameter', function(done) {
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js')
    ]);

    let stderr = '';
    bridge.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    bridge.on('exit', (code) => {
      expect(code).to.equal(1);
      expect(stderr).to.include('WebSocket URL is required');
      done();
    });
  });

  it('should connect to WebSocket server and exchange messages', function(done) {
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      serverUrl,
      '--debug'
    ]);

    let responses = [];
    let connected = false;

    bridge.stdout.on('data', (data) => {
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
    });

    bridge.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('WebSocket connected')) {
        connected = true;
        
        // Send initialization request
        bridge.stdin.write(JSON.stringify({
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
        }) + '\n');
      }
    });

    // Wait for response
    setTimeout(() => {
      bridge.kill();
      
      expect(connected).to.be.true;
      expect(responses.length).to.be.at.least(1);
      
      const response = responses[0];
      expect(response).to.have.property('jsonrpc', '2.0');
      expect(response).to.have.property('id', 1);
      expect(response).to.have.property('result');
      expect(response.result).to.have.property('serverInfo');
      expect(response.result.serverInfo).to.have.property('name', 'mock-mcp-server');
      
      done();
    }, 2000);
  });

  it('should support authentication token', function(done) {
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      serverUrl,
      '--token', 'test-token',
      '--debug'
    ]);

    let connected = false;

    bridge.stderr.on('data', (data) => {
      if (data.toString().includes('WebSocket connected')) {
        connected = true;
      }
    });

    setTimeout(() => {
      bridge.kill();
      expect(connected).to.be.true;
      done();
    }, 1000);
  });

  it('should support DEBUG environment variable', function(done) {
    const env = { ...process.env, DEBUG: 'true' };
    const bridge = spawn('node', [
      path.join(__dirname, '..', 'mcp2websocket.js'),
      serverUrl
    ], { env });

    let debugOutput = false;

    bridge.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('[info]') || output.includes('[debug]')) {
        debugOutput = true;
      }
    });

    setTimeout(() => {
      bridge.kill();
      expect(debugOutput).to.be.true;
      done();
    }, 1000);
  });
});