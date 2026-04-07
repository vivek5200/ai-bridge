import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import WebSocket from 'ws';
import { DiffHandler } from './diffHandler';
import { TerminalGuard } from './terminalGuard';
import { FileRouter } from './fileRouter';
import { ActiveFileTracker } from './activeFileTracker';
import { SidebarProvider } from './sidebarProvider';

// ─── State ──────────────────────────────────────────────────────────────────

let wsClient: WebSocket | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectTimer: NodeJS.Timeout | undefined;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

const diffHandler = new DiffHandler();
const terminalGuard = new TerminalGuard();
const fileRouter = new FileRouter();
let activeFileTracker: ActiveFileTracker;
let sidebarProvider: SidebarProvider;

let outputChannel: vscode.OutputChannel;

// ─── Activation ─────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('AI Bridge');
  log('AI Bridge extension activated.');

  activeFileTracker = new ActiveFileTracker();
  context.subscriptions.push(activeFileTracker);

  // Register Sidebar Webview
  sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider
    )
  );

  // Hook into active file tracker changes to update Webview
  vscode.window.onDidChangeActiveTextEditor(() => {
    updateSidebarUI();
  });

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'aiBridge.showStatus';
  setStatus('disconnected');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiBridge.connect', () => connect()),
    vscode.commands.registerCommand('aiBridge.disconnect', () => disconnect()),
    vscode.commands.registerCommand('aiBridge.showStatus', () => showStatus()),
    vscode.commands.registerCommand('aiBridge.showQueue', () => showQueue()),
  );

  // Auto-connect on startup
  const config = vscode.workspace.getConfiguration('aiBridge');
  if (config.get<boolean>('autoConnect', true)) {
    // Small delay to let VS Code fully initialize
    setTimeout(() => connect(), 2000);
  }

  log('AI Bridge ready. Use "AI Bridge: Connect to Hub" to start.');
}

export function deactivate() {
  disconnect();
}

// ─── Connection Management ──────────────────────────────────────────────────

function getDataDir(): string {
  const platform = os.platform();
  let base: string;

  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }

  return path.join(base, 'ai-bridge');
}

function readAuthToken(): string | null {
  const tokenPath = path.join(getDataDir(), 'auth.token');
  try {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function connect() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    log('Already connected to hub.');
    return;
  }

  const token = readAuthToken();
  if (!token) {
    vscode.window.showErrorMessage(
      'AI Bridge: Auth token not found. Start the hub first (node server.js) to generate a token.',
      'Open Hub Docs'
    ).then((choice) => {
      if (choice === 'Open Hub Docs') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/ai-bridge'));
      }
    });
    return;
  }

  const config = vscode.workspace.getConfiguration('aiBridge');
  const host = config.get<string>('hubHost', '127.0.0.1');
  const port = config.get<number>('hubPort', 8080);
  const url = `ws://${host}:${port}?token=${token}&client=vscode`;

  log(`Connecting to hub at ws://${host}:${port}...`);
  setStatus('connecting');

  try {
    wsClient = new WebSocket(url);
  } catch (e: any) {
    log(`Connection error: ${e.message}`);
    setStatus('disconnected');
    scheduleReconnect();
    return;
  }

  wsClient.on('open', () => {
    log('Connected to hub.');
    setStatus('connected');
    reconnectDelay = 1000; // Reset backoff

    // Send READY to receive queued messages
    sendJSON({ type: 'READY' });

    // Announce active file immediately
    const fileResp = activeFileTracker.buildResponse();
    if (fileResp) {
      sendJSON(fileResp);
    }
  });

  wsClient.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (e: any) {
      log(`Invalid message from hub: ${e.message}`);
    }
  });

  wsClient.on('close', (code: number, reason: Buffer) => {
    log(`Disconnected from hub (code: ${code}, reason: ${reason.toString()})`);
    setStatus('disconnected');
    wsClient = null;

    if (code !== 4002) { // 4002 = replaced by new connection, don't reconnect
      scheduleReconnect();
    }
  });

  wsClient.on('error', (err: Error) => {
    log(`WebSocket error: ${err.message}`);
    // 'close' event will fire after this
  });

  wsClient.on('pong', () => {
    // Heartbeat response received
  });
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  if (wsClient) {
    log('Disconnecting from hub.');
    wsClient.close(1000, 'User disconnected');
    wsClient = null;
  }

  setStatus('disconnected');
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return; // Already scheduled
  }

  const config = vscode.workspace.getConfiguration('aiBridge');
  if (!config.get<boolean>('autoConnect', true)) {
    return;
  }

  log(`Reconnecting in ${reconnectDelay / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, reconnectDelay);

  // Exponential backoff
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ─── Message Handling ───────────────────────────────────────────────────────

async function handleMessage(msg: any) {
  log(`Received: ${msg.type}${msg.isQueued ? ' (queued)' : ''}`);

  switch (msg.type) {
    case 'APPLY_EDIT':
      await handleApplyEdit(msg);
      break;

    case 'RUN_TERMINAL':
      await handleRunTerminal(msg);
      break;

    case 'GET_ACTIVE_FILE':
      handleGetActiveFile(msg);
      break;

    case 'GENERATE_CONTEXT':
      await handleGenerateContext(msg);
      break;

    case 'ERROR':
      log(`Hub error: ${msg.error}`);
      break;

    case 'PONG':
      break;

    default:
      log(`Unknown message type: ${msg.type}`);
  }

  // ACK queued messages
  if (msg.isQueued && msg.queueId) {
    sendJSON({ type: 'ACK', id: msg.queueId });
  }
}

async function handleApplyEdit(msg: any) {
  const payload = msg.payload;
  if (!payload) {
    log('APPLY_EDIT: missing payload');
    return;
  }

  const filePath = payload.filePath;
  const diff = payload.diff;
  const fullContent = payload.content;

  // Resolve the target file
  const fileUri = await fileRouter.resolveFile(filePath);
  if (!fileUri) {
    log('APPLY_EDIT: user cancelled file selection');
    return;
  }

  // Open the file in the editor
  await vscode.window.showTextDocument(fileUri, { preview: false });

  if (diff) {
    // Apply as unified diff
    await diffHandler.applyDiff(fileUri, diff, filePath);
  } else if (fullContent) {
    // Apply as full file replacement (with diff review)
    await diffHandler.applyFullContent(fileUri, fullContent);
  } else {
    log('APPLY_EDIT: no diff or content in payload');
    vscode.window.showWarningMessage('AI Bridge: Received edit with no diff or content.');
  }
}

async function handleRunTerminal(msg: any) {
  const command = msg.payload?.command;
  if (!command) {
    log('RUN_TERMINAL: missing command');
    return;
  }

  await terminalGuard.executeCommand(command);
}

function handleGetActiveFile(msg: any) {
  const response = activeFileTracker.buildResponse(msg.tabId);
  if (response) {
    sendJSON(response);
  }
}

async function handleGenerateContext(msg: any) {
  const filePath = msg.payload?.filePath;
  if (!filePath) {
    log('GENERATE_CONTEXT: missing filePath component');
    return;
  }

  const fileUri = await fileRouter.resolveFile(filePath);
  if (!fileUri) {
    log('GENERATE_CONTEXT: user cancelled file selection or file not found');
    sendJSON({ type: 'CONTEXT_RESULT', success: false, error: 'File not found', tabId: msg.tabId });
    return;
  }

  log(`Generating context for ${fileUri.fsPath}...`);

  // Run ai-bridge-cli using child_process
  const cp = require('child_process');
  
  // Use a temporary file for output to handle large context robustly
  const tmpOut = path.join(os.tmpdir(), `bridge_context_${Date.now()}.txt`);

  try {
    // Run npx ai-bridge-cli with local node_modules
    const workspacePath = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
    
    // Fallback if not in a workspace
    const cwd = workspacePath || path.dirname(fileUri.fsPath);
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'AI Bridge: Gathering Context...',
      cancellable: false
    }, async () => {
      return new Promise<void>((resolve, reject) => {
        // Run with simple npx
        cp.exec(
          `npx ai-bridge-cli "${fileUri.fsPath}" --no-interactive --no-copy -o "${tmpOut}"`, 
          { cwd }, 
          (error: any, stdout: string, stderr: string) => {
            if (error) {
              log(`GENERATE_CONTEXT stderr: ${stderr}`);
              reject(error);
              return;
            }
            resolve();
          }
        );
      });
    });

    // Read the generated file
    const content = fs.readFileSync(tmpOut, 'utf-8');
    fs.unlinkSync(tmpOut); // Clean up

    log(`Context generated successfully (${content.length} characters)`);
    sendJSON({
      type: 'CONTEXT_RESULT',
      success: true,
      context: content,
      tabId: msg.tabId
    });

  } catch (error: any) {
    log(`GENERATE_CONTEXT error: ${error.message}`);
    sendJSON({ 
      type: 'CONTEXT_RESULT', 
      success: false, 
      error: error.message, 
      tabId: msg.tabId 
    });
  }
}

// ─── Status Bar ─────────────────────────────────────────────────────────────

function setStatus(status: 'connected' | 'disconnected' | 'connecting') {
  switch (status) {
    case 'connected':
      statusBarItem.text = '$(zap) AI Bridge';
      statusBarItem.tooltip = 'AI Bridge: Connected to Hub';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'disconnected':
      statusBarItem.text = '$(debug-disconnect) AI Bridge';
      statusBarItem.tooltip = 'AI Bridge: Disconnected — click for details';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'connecting':
      statusBarItem.text = '$(sync~spin) AI Bridge';
      statusBarItem.tooltip = 'AI Bridge: Connecting...';
      statusBarItem.backgroundColor = undefined;
      break;
  }
  updateSidebarUI(status);
}

function updateSidebarUI(specificStatus?: 'connected' | 'disconnected' | 'connecting') {
  if (!sidebarProvider) { return; }

  const statusToUse = specificStatus || (wsClient && wsClient.readyState === WebSocket.OPEN ? 'connected' : 'disconnected');
  const config = vscode.workspace.getConfiguration('aiBridge');
  const host = config.get<string>('hubHost', '127.0.0.1');
  const port = config.get<number>('hubPort', 8080);
  const activeFile = activeFileTracker.getActiveFilePath() || 'No file open';

  sidebarProvider.updateState(statusToUse as any, host, port, activeFile);
}

function showStatus() {
  const connected = wsClient && wsClient.readyState === WebSocket.OPEN;
  const config = vscode.workspace.getConfiguration('aiBridge');
  const host = config.get<string>('hubHost', '127.0.0.1');
  const port = config.get<number>('hubPort', 8080);
  const activeFile = activeFileTracker.getActiveFilePath();

  const items: vscode.QuickPickItem[] = [
    {
      label: connected ? '$(check) Connected' : '$(error) Disconnected',
      description: `ws://${host}:${port}`,
      detail: connected ? 'Hub is reachable' : 'Hub is not reachable. Start with: node server.js',
    },
    {
      label: '$(file) Active File',
      description: activeFile || 'No file open',
    },
    {
      label: connected ? '$(debug-disconnect) Disconnect' : '$(plug) Connect',
      description: connected ? 'Close connection to hub' : 'Connect to hub',
    },
  ];

  vscode.window.showQuickPick(items, { placeHolder: 'AI Bridge Status' }).then((picked) => {
    if (!picked) {return;}
    if (picked.label.includes('Disconnect')) {
      disconnect();
    } else if (picked.label.includes('Connect')) {
      connect();
    }
  });
}

function showQueue() {
  vscode.window.showInformationMessage(
    'AI Bridge: Queue management is handled by the hub. Check hub terminal for pending messages.'
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendJSON(data: object) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify(data));
  }
}

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
  console.log(`[AI Bridge] ${message}`);
}
