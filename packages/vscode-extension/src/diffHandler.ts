import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Diff Handler — 3-Layer Diff Repair & Application
 *
 * Layer 1: Pre-processor (repair common LLM diff mistakes)
 * Layer 2: Apply patch using the `diff` library
 * Layer 3: Fallback diff editor for manual merge
 */
export class DiffHandler {

  /**
   * Main entry point. Attempts to apply a diff/code to a target file.
   * Goes through all three layers until one succeeds.
   */
  async applyDiff(
    fileUri: vscode.Uri,
    rawDiff: string,
    filePath: string
  ): Promise<boolean> {
    const fileContent = await this.readFile(fileUri);

    // Layer 1: Pre-process the raw diff
    const repairedDiff = this.repairDiff(rawDiff, filePath, fileContent);

    // Layer 2: Try to apply the patch
    const patchResult = this.tryApplyPatch(fileContent, repairedDiff);

    if (patchResult !== false) {
      // Success — write the patched content
      await this.writeFile(fileUri, patchResult);
      vscode.window.showInformationMessage(
        `AI Bridge: Successfully applied diff to ${path.basename(fileUri.fsPath)}`
      );
      return true;
    }

    // Layer 3: Fallback — open diff editor for manual merge
    console.log('[DiffHandler] Patch application failed. Opening fallback diff editor.');
    return this.openFallbackDiffEditor(fileUri, fileContent, rawDiff, repairedDiff);
  }

  /**
   * Apply raw content replacement (non-diff mode).
   * Opens a diff editor so the user can review before accepting.
   */
  async applyFullContent(
    fileUri: vscode.Uri,
    newContent: string
  ): Promise<boolean> {
    const currentContent = await this.readFile(fileUri);

    if (currentContent === newContent) {
      vscode.window.showInformationMessage('AI Bridge: File content is already up to date.');
      return true;
    }

    return this.openFallbackDiffEditor(fileUri, currentContent, newContent, newContent);
  }

  // ─── Layer 1: Diff Repair ──────────────────────────────────────────────

  /**
   * Pre-process and repair common LLM diff mistakes.
   */
  private repairDiff(rawDiff: string, filePath: string, fileContent: string): string {
    let diff = rawDiff;

    // Step 1: Strip markdown code fences
    diff = this.stripCodeFences(diff);

    // Step 2: Normalize line endings
    diff = diff.replace(/\r\n/g, '\n');

    // Step 3: Add missing file headers
    diff = this.addMissingHeaders(diff, filePath);

    // Step 4: Fix hunk headers via sliding window search
    diff = this.fixHunkHeaders(diff, fileContent);

    return diff;
  }

  /**
   * Strip markdown code fences (```diff ... ```, ```patch ... ```, etc.)
   */
  private stripCodeFences(text: string): string {
    // Remove opening fence with optional language
    let result = text.replace(/^```(?:diff|patch|unified)?\s*\n/gm, '');
    // Remove closing fence
    result = result.replace(/\n```\s*$/gm, '');
    // Also handle if the entire content is wrapped
    result = result.replace(/^```(?:diff|patch|unified)?\s*\n([\s\S]*?)\n```\s*$/g, '$1');
    return result.trim();
  }

  /**
   * Add missing --- a/ and +++ b/ headers if absent.
   */
  private addMissingHeaders(diff: string, filePath: string): string {
    const lines = diff.split('\n');

    // Check if headers already exist
    const hasMinusHeader = lines.some((l) => l.startsWith('--- '));
    const hasPlusHeader = lines.some((l) => l.startsWith('+++ '));

    if (hasMinusHeader && hasPlusHeader) {
      return diff;
    }

    // Find the first hunk header
    const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@'));
    if (firstHunkIdx === -1) {
      // No hunk headers — this might not be a unified diff at all
      return diff;
    }

    // Insert headers before the first hunk
    const normalizedPath = filePath.replace(/\\/g, '/');
    const headers = [
      `--- a/${normalizedPath}`,
      `+++ b/${normalizedPath}`,
    ];

    lines.splice(firstHunkIdx, 0, ...headers);
    return lines.join('\n');
  }

  /**
   * Fix incorrect hunk line numbers using sliding window search.
   */
  private fixHunkHeaders(diff: string, fileContent: string): string {
    if (!fileContent) {
      return diff;
    }

    const fileLines = fileContent.split('\n');
    const diffLines = diff.split('\n');
    const result: string[] = [];

    let i = 0;
    while (i < diffLines.length) {
      const line = diffLines[i];
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);

      if (!hunkMatch) {
        result.push(line);
        i++;
        continue;
      }

      // Collect context lines from this hunk (lines starting with ' ')
      const contextLines: string[] = [];
      const hunkLines: string[] = [];
      let j = i + 1;
      while (j < diffLines.length && !diffLines[j].startsWith('@@') && !diffLines[j].startsWith('diff ')) {
        const hunkLine = diffLines[j];
        hunkLines.push(hunkLine);
        if (hunkLine.startsWith(' ')) {
          contextLines.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith('-')) {
          contextLines.push(hunkLine.substring(1));
        }
        j++;
      }

      // Try to find the context in the file using sliding window
      if (contextLines.length > 0) {
        const correctedStart = this.findContextInFile(fileLines, contextLines);

        if (correctedStart !== -1) {
          // Count actual old and new lines
          let oldCount = 0;
          let newCount = 0;
          for (const hl of hunkLines) {
            if (hl.startsWith(' ')) {
              oldCount++;
              newCount++;
            } else if (hl.startsWith('-')) {
              oldCount++;
            } else if (hl.startsWith('+')) {
              newCount++;
            }
          }

          const suffix = hunkMatch[5] || '';
          result.push(`@@ -${correctedStart + 1},${oldCount} +${correctedStart + 1},${newCount} @@${suffix}`);
          result.push(...hunkLines);
          i = j;
          continue;
        }
      }

      // Could not fix — keep original
      result.push(line);
      result.push(...hunkLines);
      i = j;
    }

    return result.join('\n');
  }

  /**
   * Find the position of context lines in the file using sliding window.
   * Returns 0-based line index, or -1 if not found.
   */
  private findContextInFile(fileLines: string[], contextLines: string[]): number {
    if (contextLines.length === 0) {
      return -1;
    }

    // Try exact match first
    for (let i = 0; i <= fileLines.length - contextLines.length; i++) {
      let match = true;
      for (let k = 0; k < contextLines.length; k++) {
        if (fileLines[i + k] !== contextLines[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        return i;
      }
    }

    // Try fuzzy match (trim whitespace)
    for (let i = 0; i <= fileLines.length - contextLines.length; i++) {
      let match = true;
      for (let k = 0; k < contextLines.length; k++) {
        if (fileLines[i + k].trim() !== contextLines[k].trim()) {
          match = false;
          break;
        }
      }
      if (match) {
        return i;
      }
    }

    return -1;
  }

  // ─── Layer 2: Patch Application ────────────────────────────────────────

  /**
   * Try to apply a unified diff patch using the `diff` library.
   * Returns the patched content, or false on failure.
   */
  private tryApplyPatch(fileContent: string, patchStr: string): string | false {
    try {
      const config = vscode.workspace.getConfiguration('aiBridge');
      const fuzzFactor = config.get<number>('diffFuzzFactor', 2);

      // Try with parsePatch first
      const patches = Diff.parsePatch(patchStr);
      if (patches.length > 0) {
        const result = Diff.applyPatch(fileContent, patches[0], {
          fuzzFactor,
        });
        if (result !== false) {
          return result;
        }
      }

      // Try applying the raw string directly
      const directResult = Diff.applyPatch(fileContent, patchStr, {
        fuzzFactor,
      });
      if (directResult !== false) {
        return directResult;
      }

      return false;
    } catch (e) {
      console.error('[DiffHandler] Patch parse/apply error:', e);
      return false;
    }
  }

  // ─── Layer 3: Fallback Diff Editor ─────────────────────────────────────

  /**
   * Open VS Code's built-in diff editor with the AI's proposed changes.
   * User can manually accept/reject via the merge toolbar.
   */
  private async openFallbackDiffEditor(
    originalUri: vscode.Uri,
    originalContent: string,
    rawDiff: string,
    repairedDiff: string
  ): Promise<boolean> {
    try {
      // Try to produce a best-effort merge result
      let proposedContent = this.bestEffortMerge(originalContent, repairedDiff);

      if (!proposedContent) {
        // If we can't produce a merge, check if rawDiff looks like full file content
        if (!rawDiff.includes('@@') && !rawDiff.startsWith('---')) {
          proposedContent = rawDiff; // It's probably full file content, not a diff
        } else {
          proposedContent = `// AI Bridge: Could not auto-apply the diff.\n// The original diff is shown below for reference.\n// Please manually apply the changes.\n\n/*\n${rawDiff}\n*/\n\n${originalContent}`;
        }
      }

      // Write proposed content to a temp file
      const tmpDir = path.join(os.tmpdir(), 'ai-bridge');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const basename = path.basename(originalUri.fsPath);
      const tmpFile = path.join(tmpDir, `ai-proposed-${Date.now()}-${basename}`);
      fs.writeFileSync(tmpFile, proposedContent, 'utf-8');

      const proposedUri = vscode.Uri.file(tmpFile);

      // Open the diff editor
      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        proposedUri,
        `AI Proposed Changes: ${basename}`,
        { preview: false }
      );

      vscode.window.showInformationMessage(
        'AI Bridge: Auto-apply failed. Review the proposed changes in the diff editor.',
        'OK'
      );

      return true; // We opened the editor successfully, even if merge required
    } catch (e) {
      console.error('[DiffHandler] Failed to open diff editor:', e);
      vscode.window.showErrorMessage(
        'AI Bridge: Failed to open diff editor. Check the Output panel for details.'
      );
      return false;
    }
  }

  /**
   * Best-effort merge — attempt to apply diff even if line numbers are wrong.
   * Uses a line-by-line search and replace approach.
   */
  private bestEffortMerge(originalContent: string, diffStr: string): string | null {
    try {
      const patches = Diff.parsePatch(diffStr);
      if (patches.length === 0) {
        return null;
      }

      const patch = patches[0];
      let lines = originalContent.split('\n');

      for (const hunk of patch.hunks) {
        // Extract the "old" lines from the hunk (context + removed)
        const oldLines: string[] = [];
        const newLines: string[] = [];

        for (const hunkLine of hunk.lines) {
          if (hunkLine.startsWith('-')) {
            oldLines.push(hunkLine.substring(1));
          } else if (hunkLine.startsWith('+')) {
            newLines.push(hunkLine.substring(1));
          } else if (hunkLine.startsWith(' ')) {
            oldLines.push(hunkLine.substring(1));
            newLines.push(hunkLine.substring(1));
          }
        }

        // Find the old lines in the file
        const startIdx = this.findContextInFile(lines, oldLines);
        if (startIdx !== -1) {
          // Replace the old lines with new lines
          lines.splice(startIdx, oldLines.length, ...newLines);
        }
      }

      return lines.join('\n');
    } catch {
      return null;
    }
  }

  // ─── File I/O ──────────────────────────────────────────────────────────

  private async readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  }

  private async writeFile(uri: vscode.Uri, content: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const document = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(uri, fullRange, content);
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }
}
