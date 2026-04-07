/// <reference types="chrome-types" />
/**
 * Offscreen Document — Persistent WebSocket Client
 *
 * This offscreen document holds the WebSocket connection to the hub.
 * It's not subject to the same 30-second idle timeout as the service worker.
 * Communication with the service worker is via chrome.runtime messaging.
 */

let ws: WebSocket | null = null;
let reconnectTimer: number | undefined;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 20000; // 20 seconds
let heartbeatTimer: number | undefined;

interface BridgeConfig {
  token: string;
  host: string;
  port: number;
}

// ─── Listen for messages from Service Worker ────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'CONNECT':
      connect(message.config);
      sendResponse({ status: 'connecting' });
      break;

    case 'DISCONNECT':
      disconnect();
      sendResponse({ status: 'disconnected' });
      break;

    case 'SEND':
      sendToHub(message.data);
      sendResponse({ status: 'sent' });
      break;

    case 'GET_STATUS':
      sendResponse({
        status: ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
      });
      break;
  }

  return false;
});

export {}; // Ensure module scope

// ─── WebSocket Connection ───────────────────────────────────────────────────

function connect(config: BridgeConfig) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.log('[Offscreen] Already connected or connecting.');
    if (ws.readyState === WebSocket.OPEN) {
       notifyBackground('CONNECTED', {});
    }
    return;
  }

  const url = `ws://${config.host}:${config.port}?token=${config.token}&client=browser`;
  console.log(`[Offscreen] Connecting to ${url}...`);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error('[Offscreen] WebSocket creation failed:', e);
    notifyBackground('CONNECTION_ERROR', { error: String(e) });
    scheduleReconnect(config);
    return;
  }

  ws.onopen = () => {
    console.log('[Offscreen] Connected to hub.');
    reconnectDelay = 1000;
    notifyBackground('CONNECTED', {});
    startHeartbeat();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      notifyBackground('HUB_MESSAGE', msg);
    } catch (e) {
      console.error('[Offscreen] Invalid message from hub:', e);
    }
  };

  ws.onclose = (event) => {
    console.log(`[Offscreen] Disconnected (code: ${event.code})`);
    stopHeartbeat();
    ws = null;
    notifyBackground('DISCONNECTED', { code: event.code, reason: event.reason });
    scheduleReconnect(config);
  };

  ws.onerror = (event) => {
    console.error('[Offscreen] WebSocket error:', event);
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  stopHeartbeat();

  if (ws) {
    ws.close(1000, 'User disconnected');
    ws = null;
  }
}

function sendToHub(data: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    console.warn('[Offscreen] Cannot send — not connected.');
    notifyBackground('SEND_FAILED', { data, reason: 'Not connected' });
  }
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  }, HEARTBEAT_INTERVAL) as unknown as number;
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

// ─── Reconnection ───────────────────────────────────────────────────────────

function scheduleReconnect(config: BridgeConfig) {
  if (reconnectTimer) {
    return;
  }

  console.log(`[Offscreen] Reconnecting in ${reconnectDelay / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect(config);
  }, reconnectDelay) as unknown as number;

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ─── Communication with Service Worker ──────────────────────────────────────

function notifyBackground(event: string, data: any) {
  chrome.runtime.sendMessage({ source: 'offscreen', event, data }).catch(() => {
    // Service worker might not be active — that's OK
  });
}
