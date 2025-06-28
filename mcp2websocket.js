#!/usr/bin/env node

const WebSocket = require('ws');
const readline = require('readline');
const { EventEmitter } = require('events');

class MCPWebSocketBridge extends EventEmitter {
  constructor(url, options = {}) {
    super();
    if (!url) {
      throw new Error('WebSocket URL is required');
    }
    
    this.url = url;
    this.options = {
      token: options.token || process.env.AUTH_TOKEN,
      reconnectInterval: options.reconnectInterval || 1000,
      maxReconnectInterval: options.maxReconnectInterval || 30000,
      reconnectDecay: options.reconnectDecay || 1.5,
      heartbeatInterval: options.heartbeatInterval || 30000,
      debug: options.debug || process.env.DEBUG === 'true'
    };

    this.ws = null;
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.isConnected = false;
    this.heartbeatTimer = null;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
  }

  log(level, message, ...args) {
    if (this.options.debug) {
      console.error(`[${new Date().toISOString()}] [${level}] ${message}`, ...args);
    }
  }

  start() {
    this.log('info', 'Starting MCP WebSocket Bridge');
    this.log('info', 'Connecting to:', this.url);

    this.setupStdioHandler();
    this.connect();
  }

  setupStdioHandler() {
    this.rl.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        this.log('debug', 'Received from stdin:', message);
        this.sendToWebSocket(message);
      } catch (error) {
        this.log('error', 'Failed to parse stdin message:', error);
      }
    });

    this.rl.on('close', () => {
      this.log('info', 'Stdin closed, shutting down');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.log('info', 'Received SIGINT, shutting down');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.log('info', 'Received SIGTERM, shutting down');
      this.shutdown();
    });
  }

  connect() {
    const headers = {};
    if (this.options.token) {
      headers['Authorization'] = `Bearer ${this.options.token}`;
    }

    try {
      this.ws = new WebSocket(this.url, { headers });

      this.ws.on('open', () => {
        this.log('info', 'WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.flushMessageQueue();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.log('debug', 'Received from WebSocket:', message);
          this.sendToStdout(message);
        } catch (error) {
          this.log('error', 'Failed to parse WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        this.log('error', 'WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        this.log('info', `WebSocket closed. Code: ${code}, Reason: ${reason}`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on('pong', () => {
        this.log('debug', 'Received pong');
      });

    } catch (error) {
      this.log('error', 'Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const timeout = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts),
      this.options.maxReconnectInterval
    );

    this.log('info', `Scheduling reconnect in ${timeout}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, timeout);
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.log('debug', 'Sending ping');
        this.ws.ping();
      }
    }, this.options.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  sendToWebSocket(message) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.log('warn', 'WebSocket not connected, queuing message');
      this.messageQueue.push(message);
    }
  }

  sendToStdout(message) {
    console.log(JSON.stringify(message));
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const message = this.messageQueue.shift();
      this.log('debug', 'Sending queued message:', message);
      this.sendToWebSocket(message);
    }
  }

  shutdown() {
    this.log('info', 'Shutting down bridge');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
    }

    this.rl.close();
    process.exit(0);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
      case '-t':
        options.token = args[++i];
        break;
      case '--debug':
      case '-d':
        options.debug = true;
        break;
      case '--help':
      case '-h':
        console.log(`
MCP WebSocket Bridge

Usage: mcp2websocket <url> [options]

Arguments:
  <url>                WebSocket server URL (required)

Options:
  --token, -t <token>  Authentication token
  --debug, -d          Enable debug logging
  --help, -h           Show this help message

Environment variables:
  AUTH_TOKEN           Authentication token
  DEBUG                Enable debug logging (set to "true")

Examples:
  mcp2websocket ws://example.com:8080/mcp
  mcp2websocket wss://secure.example.com/mcp --token mytoken
  mcp2websocket --debug
`);
        process.exit(0);
        break;
      default:
        // If it starts with ws:// or wss://, treat it as URL
        if (args[i].startsWith('ws://') || args[i].startsWith('wss://')) {
          options.url = args[i];
        } else if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        } else {
          console.error(`Invalid argument: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return options;
}

if (require.main === module) {
  // Set process title for easier identification
  process.title = 'MCP to WebSocket Bridge';

  const options = parseArgs();

  // Validate URL is provided
  if (!options.url) {
    console.error('Error: WebSocket URL is required');
    console.error('Usage: mcp2websocket <url> [options]');
    console.error('Try: mcp2websocket --help');
    process.exit(1);
  }

  const { url, ...bridgeOptions } = options;
  const bridge = new MCPWebSocketBridge(url, bridgeOptions);
  bridge.start();
}

module.exports = MCPWebSocketBridge;
