#!/usr/bin/env node
const { WebSocketServer } = require('ws');
const url = require('url');
const { getDataDir, ensureDir, generateToken, readToken, writeToken, displayToken } = require('./utils');
const { parseMessage, ALL_TYPES } = require('./protocol');
const { QueueManager } = require('./queue');

// ─── Configuration ──────────────────────────────────────────────────────────

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.AI_BRIDGE_PORT, 10) || 8080;

// ─── Initialize Data Directory & Token ──────────────────────────────────────

const dataDir = getDataDir();
ensureDir(dataDir);

let authToken = readToken(dataDir);
if (!authToken) {
  authToken = generateToken();
  writeToken(dataDir, authToken);
  console.log('[Hub] Generated new auth token.');
} else {
  console.log('[Hub] Using existing auth token.');
}

displayToken(authToken);
console.log(`[Hub] Data directory: ${dataDir}`);

// ─── Initialize Queue ───────────────────────────────────────────────────────

const queue = new QueueManager(dataDir);
if (queue.size > 0) {
  console.log(`[Hub] ${queue.size} pending message(s) in queue.`);
}

// ─── Client Registry ────────────────────────────────────────────────────────

/**
 * Map of connected clients.
 * Key: clientId string ('vscode' or 'browser-<tabId>')
 * Value: { ws, clientType, tabId? }
 */
const clients = new Map();

function getVSCodeClient() {
  return clients.get('vscode') || null;
}

function getBrowserClients() {
  const result = [];
  for (const [id, client] of clients) {
    if (client.clientType === 'browser') {
      result.push(client);
    }
  }
  return result;
}

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ host: HOST, port: PORT });

console.log(`[Hub] WebSocket server listening on ws://${HOST}:${PORT}`);

wss.on('connection', (ws, req) => {
  // ── Parse query parameters ──────────────────────────────────────────────
  const params = new URL(req.url, `http://${HOST}`).searchParams;
  const token = params.get('token');
  const clientType = params.get('client') || 'browser';
  const tabId = params.get('tabId') || `tab-${Date.now()}`;

  // ── Authenticate ────────────────────────────────────────────────────────
  if (token !== authToken) {
    console.log(`[Hub] Rejected connection: invalid token from ${req.socket.remoteAddress}`);
    ws.close(4001, 'Unauthorized: invalid token');
    return;
  }

  // ── Register client ─────────────────────────────────────────────────────
  const clientId = clientType === 'vscode' ? 'vscode' : `browser-${tabId}`;

  // Close existing connection with same ID (reconnect scenario)
  if (clients.has(clientId)) {
    console.log(`[Hub] Replacing existing connection for ${clientId}`);
    try {
      clients.get(clientId).ws.close(4002, 'Replaced by new connection');
    } catch {}
  }

  clients.set(clientId, { ws, clientType, tabId, clientId });
  console.log(`[Hub] Client connected: ${clientId} (${clientType})`);

  // ── Send queued messages to VS Code on connect ──────────────────────────
  if (clientType === 'vscode') {
    drainQueue(ws);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // ── Message handling ────────────────────────────────────────────────────
  ws.on('message', (raw) => {
    const rawStr = raw.toString();
    const { msg, error } = parseMessage(rawStr);

    if (error) {
      console.log(`[Hub] Invalid message from ${clientId}: ${error}`);
      sendJSON(ws, { type: ALL_TYPES.ERROR, error });
      return;
    }

    handleMessage(clientId, clientType, msg);
  });

  // ── Disconnection ──────────────────────────────────────────────────────
  ws.on('close', (code, reason) => {
    // Only delete if this is the currently active connection for this clientId
    if (clients.get(clientId)?.ws === ws) {
      clients.delete(clientId);
    }
    console.log(`[Hub] Client disconnected: ${clientId} (code: ${code})`);
  });

  ws.on('error', (err) => {
    console.error(`[Hub] WebSocket error for ${clientId}:`, err.message);
  });
});

// ─── Message Router ─────────────────────────────────────────────────────────

function handleMessage(senderId, senderType, msg) {
  console.log(`[Hub] ${senderId} → ${msg.type}`);

  switch (msg.type) {
    // Browser sends edit, terminal command, or context request → forward to VS Code
    case ALL_TYPES.APPLY_EDIT:
    case ALL_TYPES.RUN_TERMINAL:
    // Browser requests context generation or guess file path → forward to VS Code
    case ALL_TYPES.GENERATE_CONTEXT:
    case ALL_TYPES.GUESS_FILE_PATH: {
      const vsClient = getVSCodeClient();
      if (vsClient && vsClient.ws.readyState === 1) {
        // Attach sender info
        msg.tabId = msg.tabId || senderId;
        sendJSON(vsClient.ws, msg);
        console.log(`[Hub] Forwarded ${msg.type} to VS Code`);
      } else {
        // Queue it
        const queueId = queue.enqueue(msg);
        console.log(`[Hub] VS Code offline — queued ${msg.type} as ${queueId}`);

        // Notify browser
        const browserClient = clients.get(senderId);
        if (browserClient) {
          sendJSON(browserClient.ws, {
            type: ALL_TYPES.ERROR,
            error: 'VS Code is not connected. Message queued for delivery.',
            queued: true,
            queueId,
          });
        }
      }
      break;
    }

    // VS Code sends READY → drain the queue
    case ALL_TYPES.READY: {
      const vsClient = getVSCodeClient();
      if (vsClient) {
        drainQueue(vsClient.ws);
      }
      break;
    }

    // VS Code ACKs a queued message → remove from queue
    case ALL_TYPES.ACK: {
      if (msg.id) {
        queue.remove(msg.id);
      }
      break;
    }

    // VS Code sends active file info → broadcast to all browser clients
    case ALL_TYPES.ACTIVE_FILE: {
      for (const browser of getBrowserClients()) {
        sendJSON(browser.ws, msg);
      }
      break;
    }

    // VS Code returns context or guessed file path → forward to browser
    case ALL_TYPES.CONTEXT_RESULT:
    case ALL_TYPES.GUESS_FILE_PATH_RESULT: {
      if (msg.tabId) {
        const browserClient = clients.get(msg.tabId);
        if (browserClient) {
          sendJSON(browserClient.ws, msg);
        }
      }
      break;
    }

    // Browser requests active file → forward to VS Code
    case ALL_TYPES.GET_ACTIVE_FILE: {
      const vsClient = getVSCodeClient();
      if (vsClient && vsClient.ws.readyState === 1) {
        sendJSON(vsClient.ws, { type: ALL_TYPES.GET_ACTIVE_FILE, tabId: senderId });
      }
      break;
    }

    // Ping/Pong for keep-alive
    case ALL_TYPES.PING: {
      const client = clients.get(senderId);
      if (client) {
        sendJSON(client.ws, { type: ALL_TYPES.PONG });
      }
      break;
    }

    case ALL_TYPES.PONG:
      // No-op, just keeps connection alive
      break;

    default:
      console.log(`[Hub] Unhandled message type: ${msg.type}`);
  }
}

// ─── Queue Drain ────────────────────────────────────────────────────────────

function drainQueue(vsCodeWs) {
  const messages = queue.getAll();
  if (messages.length === 0) return;

  console.log(`[Hub] Draining ${messages.length} queued message(s) to VS Code...`);

  // Check for stale messages
  const stale = queue.getStaleMessages();
  if (stale.length > 0) {
    console.log(`[Hub] Warning: ${stale.length} stale message(s) in queue (>1 hour old)`);
  }

  for (const entry of messages) {
    const wrappedMsg = {
      ...entry.payload,
      queueId: entry.id,
      queuedAt: entry.timestamp,
      isQueued: true,
    };
    sendJSON(vsCodeWs, wrappedMsg);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendJSON(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Heartbeat Interval ─────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 30000; // 30 seconds

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[Hub] Terminating unresponsive client');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatTimer);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function shutdown() {
  console.log('\n[Hub] Shutting down...');
  clearInterval(heartbeatTimer);

  // Close all client connections
  for (const [id, client] of clients) {
    try {
      client.ws.close(1001, 'Server shutting down');
    } catch {}
  }

  wss.close(() => {
    console.log('[Hub] Server closed.');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.log('[Hub] Forced exit.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Hub] Ready. Waiting for connections...');
