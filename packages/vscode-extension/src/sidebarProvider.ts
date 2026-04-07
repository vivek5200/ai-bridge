import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aiBridge.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case 'connect':
          vscode.commands.executeCommand('aiBridge.connect');
          break;
        case 'disconnect':
          vscode.commands.executeCommand('aiBridge.disconnect');
          break;
      }
    });

    // Default fast render
    this.updateState('disconnected', '127.0.0.1', 8080, 'No file open');
  }

  public updateState(status: 'connected' | 'disconnected' | 'connecting', host: string, port: number, activeFile: string) {
    if (!this._view) { return; }

    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting';

    let statusText = 'Disconnected';
    let statusColor = 'var(--vscode-errorForeground)';
    if (isConnected) {
      statusText = 'Connected';
      statusColor = 'var(--vscode-testing-iconPassed)';
    } else if (isConnecting) {
      statusText = 'Connecting...';
      statusColor = 'var(--vscode-testing-iconQueued)';
    }

    const buttonHtml = isConnected
      ? `<button class="btn secondary" onclick="sendMessage('disconnect')">Disconnect</button>`
      : `<button class="btn primary" onclick="sendMessage('connect')" ${isConnecting ? 'disabled' : ''}>${isConnecting ? 'Connecting...' : 'Connect to Hub'}</button>`;

    this._view.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI Bridge</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 15px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
          }
          h2 {
            font-size: 14px;
            margin-bottom: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-sideBarTitle-foreground);
          }
          .card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 15px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 13px;
          }
          .row:last-child {
            margin-bottom: 0;
          }
          .label {
            color: var(--vscode-descriptionForeground);
          }
          .value {
            font-weight: 500;
          }
          .status-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: ${statusColor};
            margin-right: 6px;
          }
          .btn {
            display: block;
            width: 100%;
            padding: 8px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            text-align: center;
            margin-top: 10px;
          }
          .btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          .btn.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          .btn.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .btn.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .file-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            word-break: break-all;
            color: var(--vscode-textLink-foreground);
            margin-top: 4px;
          }
        </style>
      </head>
      <body>
        <h2>Connection</h2>
        <div class="card">
          <div class="row">
            <span class="label">Status</span>
            <span class="value"><span class="status-dot"></span>${statusText}</span>
          </div>
          <div class="row">
            <span class="label">Hub Address</span>
            <span class="value">ws://${host}:${port}</span>
          </div>
          ${buttonHtml}
        </div>

        <h2>Context</h2>
        <div class="card">
          <div class="label">Active File</div>
          <div class="file-path">${activeFile}</div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          function sendMessage(type) {
            vscode.postMessage({ type });
          }
        </script>
      </body>
      </html>
    `;
  }
}
