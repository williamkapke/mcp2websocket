const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, '..', 'mcp2websocket.js');

function createBridge(url, args = []) {
  return spawn('node', [BRIDGE_PATH, url, ...args]);
}

function waitForPattern(stream, pattern, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for pattern: ${pattern}\nOutput: ${output}`));
    }, timeout);

    const handler = (data) => {
      output += data.toString();
      if (data.toString().includes(pattern)) {
        clearTimeout(timer);
        stream.removeListener('data', handler);
        resolve();
      }
    };

    stream.on('data', handler);
  });
}

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

module.exports = {
  BRIDGE_PATH,
  createBridge,
  waitForPattern,
  collectResponses
};