/// <reference types="chrome-types" />
/**
 * Popup Page Script
 *
 * Handles settings persistence and connection status display.
 */

const tokenInput = document.getElementById('tokenInput') as HTMLInputElement;
const hostInput = document.getElementById('hostInput') as HTMLInputElement;
const portInput = document.getElementById('portInput') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const contextBtn = document.getElementById('contextBtn') as HTMLButtonElement;
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
    tokenInput.style.borderColor = 'var(--error)';
    tokenInput.style.boxShadow = '0 0 0 2px rgba(251, 113, 133, 0.2)';
    tokenInput.focus();
    return;
  }

  // Visual feedback for button
  const originalHtml = saveBtn.innerHTML;
  saveBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    Saved
  `;

  chrome.storage.local.set({
    token,
    hubHost: host,
    hubPort: port,
  }, () => {
    // Show saved message
    savedMsg.classList.add('show');
    setTimeout(() => {
      savedMsg.classList.remove('show');
      saveBtn.innerHTML = originalHtml;
    }, 2000);

    // Trigger reconnection
    chrome.runtime.sendMessage({ action: 'RECONNECT' });

    // Check status after a delay
    setTimeout(checkStatus, 1500);
  });
});

// ─── Connection Status ──────────────────────────────────────────────────────

function checkStatus() {
  // @ts-ignore
  chrome.runtime.sendMessage({ action: 'GET_CONNECTION_STATUS' }, (response: any) => {
    // @ts-ignore
    if (chrome.runtime.lastError) {
      setStatus(false);
      return;
    }
    setStatus(response?.connected || false);
  });
}

function setStatus(connected: boolean) {
  if (connected) {
    statusDot.classList.remove('disconnected');
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected to Hub';
    statusText.style.color = 'var(--success)';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
    statusText.style.color = 'var(--text)';
  }
}

// Check status immediately and periodically
checkStatus();
setInterval(checkStatus, 3000);

// Reset border color on token input focus
tokenInput.addEventListener('focus', () => {
  tokenInput.style.borderColor = '';
  tokenInput.style.boxShadow = '';
});

// ─── Codebase Context ───────────────────────────────────────────────────────

if (contextBtn) {
  contextBtn.addEventListener('click', () => {
    const originalText = contextBtn.innerHTML;
    contextBtn.innerHTML = '⏳ Gathering...';
    contextBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'GET_ACTIVE_FILE' }, undefined, (response: any) => {
      if (!response || !response.activeFile) {
        contextBtn.innerHTML = '❌ Open file in VS Code';
        setTimeout(() => {
          contextBtn.innerHTML = originalText;
          contextBtn.disabled = false;
        }, 3000);
        return;
      }

      chrome.runtime.sendMessage({
        action: 'SEND_TO_HUB',
        data: {
          type: 'GENERATE_CONTEXT',
          payload: { filePath: response.activeFile }
        }
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'CONTEXT_RESULT') {
    if (contextBtn && contextBtn.disabled) {
      if (message.success) {
        navigator.clipboard.writeText(message.context).then(() => {
          contextBtn.innerHTML = '✓ Copied to Clipboard!';
          contextBtn.style.backgroundColor = 'rgba(52, 211, 153, 0.2)';
          contextBtn.style.color = '#34d399';
          contextBtn.style.borderColor = 'rgba(52, 211, 153, 0.5)';
        }).catch(() => {
          contextBtn.innerHTML = '❌ Copy Failed';
        });
      } else {
        contextBtn.innerHTML = '❌ Error from VS Code';
      }
      setTimeout(() => {
        contextBtn.innerHTML = '📄 Copy Workspace Context';
        contextBtn.disabled = false;
        contextBtn.style.backgroundColor = 'rgba(139, 92, 246, 0.2)';
        contextBtn.style.color = '#cdd6f4';
        contextBtn.style.borderColor = 'rgba(139, 92, 246, 0.5)';
      }, 3000);
    }
  }
  return false;
});
