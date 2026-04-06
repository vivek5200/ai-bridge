import * as vscode from 'vscode';
import * as path from 'path';

/**
 * File Router
 *
 * Resolves file paths from incoming payloads to actual workspace files.
 * Handles missing files (QuickPick), ambiguous matches (disambiguation),
 * and multi-root workspaces.
 */
export class FileRouter {

  /**
   * Resolve a file path from a payload to an actual workspace URI.
   * 
   * Returns the resolved URI, or undefined if the user cancelled.
   */
  async resolveFile(filePath: string): Promise<vscode.Uri | undefined> {
    if (!filePath) {
      return this.showFilePicker('No file path provided. Select a target file:');
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('AI Bridge: No workspace folder open.');
      return undefined;
    }

    // Normalize the path separators
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Try to find matching files across all workspace folders
    const matches: vscode.Uri[] = [];

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, `**/${path.basename(normalizedPath)}`);
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 50);

      for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file, false).replace(/\\/g, '/');
        // Check if the relative path ends with the requested path
        if (relativePath === normalizedPath || relativePath.endsWith(normalizedPath)) {
          matches.push(file);
        }
      }
    }

    // Also try exact relative path match within each workspace folder
    for (const folder of workspaceFolders) {
      const exactUri = vscode.Uri.joinPath(folder.uri, normalizedPath);
      try {
        await vscode.workspace.fs.stat(exactUri);
        if (!matches.some((m) => m.fsPath === exactUri.fsPath)) {
          matches.unshift(exactUri); // Prioritize exact match
        }
      } catch {
        // File doesn't exist at this exact path
      }
    }

    if (matches.length === 0) {
      // No matches found — offer to create the file or pick an existing one
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(new-file) Create new file', description: filePath, action: 'create' as const },
          { label: '$(search) Browse workspace files', description: 'Select an existing file', action: 'browse' as const },
        ],
        { placeHolder: `File not found: ${filePath}` }
      );

      if (!choice) {
        return undefined;
      }

      if (choice.action === 'create') {
        // Create the file in the first workspace folder
        const newUri = vscode.Uri.joinPath(workspaceFolders[0].uri, normalizedPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(newUri, '..'));
        await vscode.workspace.fs.writeFile(newUri, Buffer.from(''));
        return newUri;
      }

      return this.showFilePicker(`Select target for: ${filePath}`);
    }

    if (matches.length === 1) {
      return matches[0];
    }

    // Multiple matches — let user disambiguate
    return this.disambiguate(matches, filePath);
  }

  /**
   * Show a disambiguation picker when multiple files match.
   */
  private async disambiguate(matches: vscode.Uri[], originalPath: string): Promise<vscode.Uri | undefined> {
    const items = matches.map((uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const folderName = folder ? folder.name : 'unknown';
      const relativePath = vscode.workspace.asRelativePath(uri, false);

      return {
        label: `[${folderName}] ${relativePath}`,
        description: uri.fsPath,
        uri,
      };
    });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Multiple matches for "${originalPath}". Select the correct file:`,
    });

    return picked?.uri;
  }

  /**
   * Show a full file picker for the workspace.
   */
  private async showFilePicker(placeHolder: string): Promise<vscode.Uri | undefined> {
    const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 500);

    const items = allFiles.map((uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const folderName = folder ? folder.name : '';
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const prefix = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1
        ? `[${folderName}] `
        : '';

      return {
        label: `${prefix}${relativePath}`,
        description: path.extname(uri.fsPath),
        uri,
      };
    });

    // Sort alphabetically
    items.sort((a, b) => a.label.localeCompare(b.label));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder,
      matchOnDescription: true,
    });

    return picked?.uri;
  }
}
