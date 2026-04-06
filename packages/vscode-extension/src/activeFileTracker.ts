import * as vscode from 'vscode';

/**
 * Active File Tracker
 * 
 * Tracks the currently active editor file and responds to
 * GET_ACTIVE_FILE requests from the hub.
 */
export class ActiveFileTracker implements vscode.Disposable {
  private currentFilePath: string | null = null;
  private disposables: vscode.Disposable[] = [];
  private lastResponseTime = 0;
  private readonly THROTTLE_MS = 1000;

  constructor() {
    // Track active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateActiveFile(editor);
      })
    );

    // Initialize with current editor
    this.updateActiveFile(vscode.window.activeTextEditor);
  }

  private updateActiveFile(editor: vscode.TextEditor | undefined): void {
    if (editor && editor.document.uri.scheme === 'file') {
      this.currentFilePath = vscode.workspace.asRelativePath(editor.document.uri, true);
    }
  }

  /**
   * Get the current active file path (relative to workspace).
   */
  getActiveFilePath(): string | null {
    return this.currentFilePath;
  }

  /**
   * Build a response message for GET_ACTIVE_FILE requests.
   * Throttled to max 1 response per second.
   */
  buildResponse(tabId?: string): object | null {
    const now = Date.now();
    if (now - this.lastResponseTime < this.THROTTLE_MS) {
      return null; // Throttled
    }
    this.lastResponseTime = now;

    return {
      type: 'ACTIVE_FILE',
      filePath: this.currentFilePath,
      tabId,
    };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
