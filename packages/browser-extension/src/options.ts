/// <reference types="chrome-types" />
/**
 * Options Page Script
 *
 * Handles settings persistence and connection status display.
 */

const tokenInput = document.getElementById('tokenInput') as HTMLInputElement;
const hostInput = document.getElementById('hostInput') as HTMLInputElement;
const portInput = document.getElementById('portInput') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const savedMsg = document.getElementById('savedMsg') as HTMLElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;

// ─── Load Settings ──────────────────────────────────────────────────────────

chrome.storage.local.get(['token', 'hubHost', 'hubPort'], (result) => {
  if (result.token) {tokenInput.value = result.token;}
  if (result.hubHost) {hostInput.value = result.hubHost;}
  if (result.hubPort) {portInput.value = String(result.hubPort);}
});

// ─── Save Settings ──────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  const host = hostInput.value.trim() || '127.0.0.1';
  const port = parseInt(portInput.value, 10) || 8080;

  if (!token) {
    tokenInput.style.borderColor = '#f38ba8';
    tokenInput.focus();
    return;
  }

  chrome.storage.local.set({
    token,
    hubHost: host,
    hubPort: port,
  }, () => {
    // Show saved message
    savedMsg.classList.add('show');
    setTimeout(() => savedMsg.classList.remove('show'), 2000);

    // Trigger reconnection
    chrome.runtime.sendMessage({ action: 'RECONNECT' });

    // Check status after a delay
    setTimeout(checkStatus, 2000);
  });
});

// ─── Connection Status ──────────────────────────────────────────────────────

function checkStatus() {
  chrome.runtime.sendMessage({ action: 'GET_CONNECTION_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(false);
      return;
    }
    setStatus(response?.connected || false);
  });
}

function setStatus(connected: boolean) {
  statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = connected ? 'Connected to Hub' : 'Disconnected';
}

// Check status immediately and periodically
checkStatus();
setInterval(checkStatus, 5000);

// Reset border color on token input focus
tokenInput.addEventListener('focus', () => {
  tokenInput.style.borderColor = '';
});
