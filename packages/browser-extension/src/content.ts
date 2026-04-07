/// <reference types="chrome-types" />
/**
 * Content Script — AI Chat Page Integration
 *
 * Injected into ChatGPT, Claude, and Gemini pages.
 * Detects code blocks, injects "Send to VS Code" buttons,
 * and shows a confirmation modal before sending.
 */

let activeFile: string | null = null;
let observer: MutationObserver | null = null;
let streamingCheckTimer: number | undefined;
const processedBlocks = new WeakSet<Element>();

// ─── Initialization ─────────────────────────────────────────────────────────

function init() {
  console.log('[AI Bridge] Content script loaded.');

  // Ask for active file immediately
  chrome.runtime.sendMessage({ action: 'GET_ACTIVE_FILE' }, undefined, (response: any) => {
    if (response && response.activeFile) {
      activeFile = response.activeFile;
    }
  });

  // Inject Context button
  injectContextButton();

  // Start observing for code blocks
  startObserver();

  // Scan existing code blocks
  setTimeout(() => scanForCodeBlocks(), 1000);
}

// ─── DOM Observer ───────────────────────────────────────────────────────────

function startObserver() {
  if (observer) {
    observer.disconnect();
  }

  const chatContainer = findChatContainer();
  if (!chatContainer) {
    console.log('[AI Bridge] Chat container not found. Retrying...');
    setTimeout(startObserver, 2000);
    return;
  }

  observer = new MutationObserver((mutations) => {
    // Debounce: wait for streaming to finish
    if (streamingCheckTimer) {
      clearTimeout(streamingCheckTimer);
    }
    streamingCheckTimer = setTimeout(() => {
      if (!isStreaming()) {
        scanForCodeBlocks();
      }
    }, 500) as unknown as number;
  });

  observer.observe(chatContainer, {
    childList: true,
    subtree: true,
  });

  console.log('[AI Bridge] Observing chat container for code blocks.');
}

function findChatContainer(): Element | null {
  // Try multiple selectors for different AI platforms
  const selectors = [
    // ChatGPT / chatgpt.com
    'main .flex.flex-col',
    '[class*="react-scroll-to-bottom"]',
    'main',
    // Claude
    '[class*="conversation"]',
    '.prose',
    // Gemini
    '.conversation-container',
    'main',
    // Generic fallback
    'article',
    '#__next',
    'body',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      return el;
    }
  }

  return document.body;
}

function isStreaming(): boolean {
  // Check for "Stop generating" button (ChatGPT)
  const stopBtn = document.querySelector('[aria-label="Stop generating"]');
  if (stopBtn) {return true;}

  // Check for streaming indicators (Claude)
  const claudeStop = document.querySelector('[class*="stop"]');
  if (claudeStop && claudeStop.textContent?.includes('Stop')) {return true;}

  // Check for Gemini streaming indicator
  const geminiStop = document.querySelector('[data-test-id="stop-button"]');
  if (geminiStop) {return true;}

  return false;
}

// ─── Code Block Detection & Button Injection ────────────────────────────────

function scanForCodeBlocks() {
  // Try multiple selector patterns
  const selectors = [
    'pre code',
    'pre[class*="code"]',
    '[data-code-block]',
    'pre',
  ];

  const codeBlocks = new Set<Element>();

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      // Get the <pre> parent if we found a <code> inside it
      const pre = el.tagName === 'PRE' ? el : el.closest('pre');
      if (pre && !processedBlocks.has(pre)) {
        codeBlocks.add(pre);
      }
    });
  }

  for (const block of codeBlocks) {
    injectSendButton(block as HTMLElement);
    processedBlocks.add(block);
  }
}

function injectSendButton(codeBlock: HTMLElement) {
  // Create the button container
  const container = document.createElement('div');
  container.className = 'ai-bridge-btn-container';

  const button = document.createElement('button');
  button.className = 'ai-bridge-send-btn';
  button.innerHTML = '📤 <span>Send to VS Code</span>';
  button.title = 'Send this code to VS Code via AI Bridge';

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const code = extractCode(codeBlock);
    const lang = detectLanguage(codeBlock);
    showConfirmationModal(code, lang);
  });

  container.appendChild(button);

  // Position relative to the code block
  const wrapper = codeBlock.parentElement;
  if (wrapper) {
    wrapper.style.position = 'relative';
    wrapper.insertBefore(container, codeBlock);
  } else {
    codeBlock.style.position = 'relative';
    codeBlock.insertBefore(container, codeBlock.firstChild);
  }
}

// ─── Floating Context Button ────────────────────────────────────────────────

function injectContextButton() {
  if (document.getElementById('ai-bridge-context-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'ai-bridge-context-btn';
  btn.innerHTML = '📄 Attach Codebase Context';
  btn.title = 'Get workspace context from VS Code and copy to clipboard';
  
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483647',
    padding: '12px 20px',
    backgroundColor: '#89b4fa',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '24px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'transform 0.2s, background-color 0.2s',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  });

  btn.addEventListener('mouseenter', () => btn.style.transform = 'translateY(-2px)');
  btn.addEventListener('mouseleave', () => btn.style.transform = 'translateY(0)');

  btn.addEventListener('click', () => {
    if (!activeFile) {
        btn.innerHTML = '❌ Open a file in VS Code first';
        setTimeout(() => btn.innerHTML = '📄 Attach Codebase Context', 3000);
        return;
    }
    
    btn.innerHTML = '⏳ Gathering...';
    btn.style.opacity = '0.8';
    btn.style.pointerEvents = 'none';
    
    chrome.runtime.sendMessage({
      action: 'SEND_TO_HUB',
      data: {
        type: 'GENERATE_CONTEXT',
        payload: { filePath: activeFile }
      }
    });
  });

  document.body.appendChild(btn);
}

function extractCode(codeBlock: HTMLElement): string {
  // Try <code> child first
  const codeEl = codeBlock.querySelector('code');
  if (codeEl) {
    return codeEl.textContent || '';
  }
  return codeBlock.textContent || '';
}

function detectLanguage(codeBlock: HTMLElement): string {
  // Check class for language
  const codeEl = codeBlock.querySelector('code') || codeBlock;
  const classes = Array.from(codeEl.classList);

  for (const cls of classes) {
    const langMatch = cls.match(/(?:language-|lang-|hljs-)(\w+)/);
    if (langMatch) {
      return langMatch[1];
    }
  }

  // Check data attribute
  const lang = codeBlock.getAttribute('data-language') ||
               codeBlock.closest('[data-language]')?.getAttribute('data-language');
  if (lang) {
    return lang;
  }

  return 'text';
}

// ─── Confirmation Modal ─────────────────────────────────────────────────────

function showConfirmationModal(code: string, language: string) {
  // Remove existing modal if any
  const existing = document.getElementById('ai-bridge-modal-host');
  if (existing) {
    existing.remove();
  }

  // Create host element with Shadow DOM for CSS isolation
  const host = document.createElement('div');
  host.id = 'ai-bridge-modal-host';
  const shadow = host.attachShadow({ mode: 'closed' });

  // Check if code looks like a unified diff
  const isDiff = code.includes('@@') || code.startsWith('---') || code.startsWith('diff --git');

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: fadeIn 0.15s ease-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .modal {
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 16px;
        width: 560px;
        max-width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        animation: slideUp 0.2s ease-out;
        color: #cdd6f4;
      }

      .modal-header {
        padding: 20px 24px 16px;
        border-bottom: 1px solid #313244;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .modal-header h2 {
        font-size: 16px;
        font-weight: 600;
        color: #cdd6f4;
        flex: 1;
      }

      .modal-header .close-btn {
        background: none;
        border: none;
        color: #6c7086;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        line-height: 1;
      }

      .modal-header .close-btn:hover {
        background: #313244;
        color: #cdd6f4;
      }

      .modal-body {
        padding: 16px 24px;
        overflow-y: auto;
        flex: 1;
      }

      .field {
        margin-bottom: 16px;
      }

      .field label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #a6adc8;
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .field input[type="text"] {
        width: 100%;
        padding: 10px 12px;
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        color: #cdd6f4;
        font-size: 14px;
        font-family: 'Fira Code', 'Consolas', monospace;
        outline: none;
        transition: border-color 0.15s;
      }

      .field input[type="text"]:focus {
        border-color: #89b4fa;
      }

      .code-preview {
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 12px;
        max-height: 250px;
        overflow-y: auto;
        font-family: 'Fira Code', 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        color: #a6adc8;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      .checkbox-row input[type="checkbox"] {
        accent-color: #89b4fa;
        width: 16px;
        height: 16px;
      }

      .checkbox-row label {
        font-size: 13px;
        color: #bac2de;
        cursor: pointer;
      }

      .modal-footer {
        padding: 16px 24px 20px;
        border-top: 1px solid #313244;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      .btn {
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }

      .btn-cancel {
        background: #313244;
        color: #cdd6f4;
      }

      .btn-cancel:hover {
        background: #45475a;
      }

      .btn-send {
        background: #89b4fa;
        color: #1e1e2e;
      }

      .btn-send:hover {
        background: #b4d0fb;
      }

      .active-file-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: #313244;
        border-radius: 4px;
        font-size: 11px;
        color: #89b4fa;
        font-family: 'Fira Code', 'Consolas', monospace;
      }

      select {
        padding: 10px 12px;
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        color: #cdd6f4;
        font-size: 14px;
        outline: none;
        cursor: pointer;
      }

      select:focus {
        border-color: #89b4fa;
      }
    </style>

    <div class="modal-overlay" id="overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>📤 Send to VS Code</h2>
          ${activeFile ? `<span class="active-file-badge">📄 ${activeFile}</span>` : ''}
          <button class="close-btn" id="closeBtn">✕</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label>Target File Path</label>
            <input type="text" id="filePath" value="${escapeHtml(activeFile || '')}"
                   placeholder="e.g., src/components/Chat.tsx" />
          </div>

          <div class="field">
            <label>Action</label>
            <select id="actionType">
              <option value="diff" ${isDiff ? 'selected' : ''}>Apply as Unified Diff</option>
              <option value="content" ${!isDiff ? 'selected' : ''}>Replace File Content</option>
            </select>
          </div>

          <div class="field">
            <label>Code Preview (${language})</label>
            <div class="code-preview" id="codePreview">${escapeHtml(code)}</div>
          </div>

          <div class="checkbox-row">
            <input type="checkbox" id="detectCommands" />
            <label for="detectCommands">Also send detected terminal commands</label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-cancel" id="cancelBtn">Cancel</button>
          <button class="btn btn-send" id="sendBtn">Send to VS Code</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(host);

  // Event handlers
  const overlay = shadow.getElementById('overlay')!;
  const closeBtn = shadow.getElementById('closeBtn')!;
  const cancelBtn = shadow.getElementById('cancelBtn')!;
  const sendBtn = shadow.getElementById('sendBtn')!;

  const close = () => host.remove();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {close;}
  });
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  sendBtn.addEventListener('click', () => {
    const filePath = (shadow.getElementById('filePath') as HTMLInputElement).value.trim();
    const actionType = (shadow.getElementById('actionType') as HTMLSelectElement).value;

    const payload: any = {
      type: 'APPLY_EDIT',
      payload: {
        filePath,
      },
    };

    if (actionType === 'diff') {
      payload.payload.diff = code;
    } else {
      payload.payload.content = code;
    }

    // Send to background
    chrome.runtime.sendMessage({ action: 'SEND_TO_HUB', data: payload });

    // Show success feedback
    sendBtn.textContent = '✓ Sent!';
    sendBtn.style.background = '#a6e3a1';
    setTimeout(close, 800);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Message Listener from Background ───────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'ACTIVE_FILE_UPDATED':
      activeFile = message.filePath;
      break;

    case 'SHOW_MODAL':
      // Provide an updated filePath check if activeFile is still null before showing
      if (!activeFile) {
        chrome.runtime.sendMessage({ action: 'GET_ACTIVE_FILE' }, undefined, (response: any) => {
          if (response && response.activeFile) {
            activeFile = response.activeFile;
          }
          showConfirmationModal(message.content || '', 'text');
        });
      } else {
        showConfirmationModal(message.content || '', 'text');
      }
      break;

    case 'CONTEXT_RESULT':
      const btn = document.getElementById('ai-bridge-context-btn') as HTMLButtonElement;
      if (btn) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        if (message.success) {
          navigator.clipboard.writeText(message.context).then(() => {
            btn.innerHTML = '✓ Copied to Clipboard!';
            btn.style.backgroundColor = '#a6e3a1';
            setTimeout(() => {
              btn.innerHTML = '📄 Attach Codebase Context';
              btn.style.backgroundColor = '#89b4fa';
            }, 3000);
          }).catch(err => {
            btn.innerHTML = '❌ Failed to copy to clipboard';
            setTimeout(() => btn.innerHTML = '📄 Attach Codebase Context', 3000);
          });
        } else {
          btn.innerHTML = '❌ Error';
          btn.style.backgroundColor = '#f38ba8';
          console.error('AI Bridge Context Error:', message.error);
          setTimeout(() => {
            btn.innerHTML = '📄 Attach Codebase Context';
            btn.style.backgroundColor = '#89b4fa';
          }, 3000);
        }
      }
      break;
  }
  sendResponse({ ok: true });
  return true;
});

// ─── Start ──────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {}; // Ensure this is treated as a module
