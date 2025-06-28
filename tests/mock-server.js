const WebSocket = require('ws');

class MockMCPServer {
  constructor(port = 0) {
    this.port = port;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve) => {
      this.wss = new WebSocket.Server({ port: this.port }, () => {
        this.port = this.wss.address().port;
        console.log(`Mock MCP server started on ws://localhost:${this.port}`);
        resolve(this.port);
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        console.log('Client connected to mock server');

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log('Mock server received:', message.method || message.id);

            // Handle different message types
            if (message.method === 'initialize') {
              // Send back a proper initialization response
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {}
                  },
                  serverInfo: {
                    name: 'mock-mcp-server',
                    version: '1.0.0'
                  }
                }
              }));
            } else {
              // Echo back for other messages
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: { echo: message }
              }));
            }
          } catch (error) {
            console.error('Mock server error:', error);
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32700,
                message: 'Parse error'
              }
            }));
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          console.log('Client disconnected from mock server');
        });

        ws.on('error', (error) => {
          console.error('Mock server WebSocket error:', error);
        });

        // Handle ping/pong
        ws.on('ping', () => {
          ws.pong();
        });
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.clients.forEach(client => client.close());
      this.clients.clear();
      
      if (this.wss) {
        this.wss.close(() => {
          console.log('Mock MCP server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getUrl() {
    return `ws://localhost:${this.port}`;
  }
}

module.exports = MockMCPServer;