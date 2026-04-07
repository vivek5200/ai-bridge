/// <reference types="chrome-types" />
/**
 * Background Service Worker
 *
 * Manages the offscreen document, relays messages between content scripts
 * and the offscreen WebSocket, handles context menu, and manages badge state.
 */

let offscreenCreated = false;
let isConnected = false;
let activeFile: string | null = null;

// ─── Extension Lifecycle ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] AI Bridge installed.');
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Browser started — attempting connection.');
  initConnection();
});

// Initialize on service worker startup
initConnection();

export {}; // Ensure module scope

// ─── Offscreen Document Management ─────────────────────────────────────────

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreated) {
    return;
  }

  // Check if offscreen doc already exists (across service worker restarts)
  try {
    const existingContexts = await (chrome as any).runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts && existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }
  } catch {
    // getContexts not available, try creating
  }

  try {
    await (chrome.offscreen as any).createDocument({
      url: 'offscreen.html',
      reasons: ['WEB_RTC'], // Use WEB_RTC as the reason (covers WebSocket use)
      justification: 'Maintain WebSocket connection to AI Bridge hub',
    });
    offscreenCreated = true;
    console.log('[Background] Offscreen document created.');
  } catch (e: any) {
    if (e.message?.includes('Only a single offscreen')) {
      offscreenCreated = true; // Already exists
    } else {
      console.error('[Background] Failed to create offscreen document:', e);
    }
  }
}

// ─── Connection Management ──────────────────────────────────────────────────

async function initConnection() {
  const config = await getStoredConfig();
  if (!config.token) {
    console.log('[Background] No token configured. Open options to set token.');
    setBadge('OFF', '#999');
    return;
  }

  await ensureOffscreen();

  chrome.runtime.sendMessage({
    action: 'CONNECT',
    config,
  }).catch(() => {
    // Offscreen document might not be ready yet
    setTimeout(initConnection, 2000);
  });
}

async function getStoredConfig(): Promise<{ token: string; host: string; port: number }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['token', 'hubHost', 'hubPort'], (result) => {
      resolve({
        token: result.token || '',
        host: result.hubHost || '127.0.0.1',
        port: result.hubPort || 8080,
      });
    });
  });
}

// ─── Message Handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages from offscreen document
  if (message.source === 'offscreen') {
    handleOffscreenEvent(message.event, message.data);
    return;
  }

  // Messages from content scripts
  switch (message.action) {
    case 'SEND_TO_HUB':
      sendToOffscreen(message.data);
      sendResponse({ status: 'sent' });
      break;

    case 'GET_CONNECTION_STATUS':
      sendResponse({ connected: isConnected });
      break;

    case 'GET_ACTIVE_FILE':
      sendResponse({ activeFile });
      break;

    case 'RECONNECT':
      initConnection();
      sendResponse({ status: 'reconnecting' });
      break;
  }

  return true;
});

function handleOffscreenEvent(event: string, data: any) {
  switch (event) {
    case 'CONNECTED':
      isConnected = true;
      setBadge('ON', '#4CAF50');
      console.log('[Background] Hub connected.');
      break;

    case 'DISCONNECTED':
      isConnected = false;
      setBadge('OFF', '#F44336');
      console.log('[Background] Hub disconnected.');
      break;

    case 'CONNECTION_ERROR':
      isConnected = false;
      setBadge('ERR', '#F44336');
      break;

    case 'HUB_MESSAGE':
      handleHubMessage(data);
      break;

    case 'SEND_FAILED':
      console.warn('[Background] Send failed:', data.reason);
      break;
  }
}

function handleHubMessage(msg: any) {
  switch (msg.type) {
    case 'ACTIVE_FILE':
      activeFile = msg.filePath;
      // Broadcast to all content scripts
      broadcastToContentScripts({
        action: 'ACTIVE_FILE_UPDATED',
        filePath: msg.filePath,
      });
      break;

    case 'CONTEXT_RESULT':
      broadcastToContentScripts({
        action: 'CONTEXT_RESULT',
        success: msg.success,
        context: msg.context,
        error: msg.error,
      });
      break;

    case 'PONG':
      // Heartbeat response — no action needed
      break;

    case 'ERROR':
      console.warn('[Background] Hub error:', msg.error);
      break;

    default:
      console.log('[Background] Hub message:', msg.type);
  }
}

// ─── Communication Helpers ──────────────────────────────────────────────────

function sendToOffscreen(data: any) {
  chrome.runtime.sendMessage({
    action: 'SEND',
    data,
  }).catch((e: any) => {
    console.error('[Background] Failed to send to offscreen:', e);
  });
}

async function broadcastToContentScripts(message: any) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab might not have content script
      });
    }
  }
}

// ─── Context Menu ───────────────────────────────────────────────────────────

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sendToVSCode',
      title: 'Send selected text to VS Code',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'sendPageToVSCode',
      title: 'Send code block to VS Code',
      contexts: ['page'],
      documentUrlPatterns: [
        'https://chat.openai.com/*',
        'https://chatgpt.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
      ],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sendToVSCode' && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_MODAL',
      content: info.selectionText,
      source: 'context-menu',
    }).catch(() => {});
  }

  if (info.menuItemId === 'sendPageToVSCode' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_MODAL',
      content: '',
      source: 'context-menu-page',
    }).catch(() => {});
  }
});

// ─── Badge Management ───────────────────────────────────────────────────────

function setBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Storage Change Listener ────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.hubHost || changes.hubPort)) {
    console.log('[Background] Config changed — reconnecting.');
    initConnection();
  }
});
