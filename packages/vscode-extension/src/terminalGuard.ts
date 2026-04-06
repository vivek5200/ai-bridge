import * as vscode from 'vscode';

/**
 * Terminal Guard
 *
 * Enforces an allowlist-based security model for terminal command execution.
 * Commands must match an allowed prefix AND not match any deny pattern.
 */

// Hardcoded denylist of extremely dangerous commands — always blocked regardless of prefix
const DANGER_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|--recursive)\s+\/\s*$/i,      // rm -rf /
  /rm\s+(-rf?|--recursive)\s+\\/i,           // rm -rf \ (Windows)
  /del\s+\/s\s+\/q/i,                        // del /s /q
  /format\s+[a-z]:/i,                        // format C:
  /mkfs\./i,                                 // mkfs.ext4 etc.
  /:\(\)\{\s*:\|:\&\s*\};:/,                 // fork bomb
  /shutdown/i,                               // shutdown
  /reboot/i,                                 // reboot
  />\s*\/dev\/sda/i,                         // write to raw device
  /dd\s+if=.*of=\/dev/i,                     // dd to device
  /chmod\s+-R\s+777\s+\//i,                  // chmod -R 777 /
  /curl.*\|\s*(bash|sh)/i,                   // curl | bash (pipe to shell)
  /wget.*\|\s*(bash|sh)/i,                   // wget | bash
];

export class TerminalGuard {
  /**
   * Check if a command is safe to execute.
   * Returns { allowed: boolean, reason?: string }
   */
  checkCommand(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();

    if (!trimmed) {
      return { allowed: false, reason: 'Empty command' };
    }

    // Check denylist first — always blocked
    for (const pattern of DANGER_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `Blocked: command matches dangerous pattern (${pattern.source})`,
        };
      }
    }

    // Check allowlist prefixes
    const config = vscode.workspace.getConfiguration('aiBridge');
    const allowedPrefixes: string[] = config.get('allowedTerminalPrefixes', [
      'npm ', 'npx ', 'yarn ', 'pnpm ', 'cargo ', 'git ',
      'python ', 'pip ', 'node ', 'deno ', 'bun ', 'go ', 'dotnet ', 'mvn ', 'gradle ',
    ]);

    const isAllowed = allowedPrefixes.some((prefix) =>
      trimmed.startsWith(prefix) || trimmed === prefix.trim()
    );

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command prefix not in allowlist. Allowed: ${allowedPrefixes.map((p) => p.trim()).join(', ')}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Execute a terminal command after safety checks and user confirmation.
   * Returns true if the command was run, false if blocked or cancelled.
   */
  async executeCommand(command: string): Promise<boolean> {
    const check = this.checkCommand(command);

    if (!check.allowed) {
      vscode.window.showErrorMessage(
        `AI Bridge: Terminal command blocked.\n${check.reason}`,
        'OK'
      );
      return false;
    }

    // Always confirm with user
    const config = vscode.workspace.getConfiguration('aiBridge');
    const alwaysConfirm = config.get<boolean>('alwaysConfirmTerminal', true);

    if (alwaysConfirm) {
      const choice = await vscode.window.showWarningMessage(
        `AI Bridge: Run terminal command?\n\n$ ${command}`,
        { modal: true },
        'Run',
        'Cancel'
      );

      if (choice !== 'Run') {
        return false;
      }
    }

    // Create terminal and run command
    const terminal = vscode.window.createTerminal({
      name: `AI Bridge`,
      iconPath: new vscode.ThemeIcon('sparkle'),
    });
    terminal.show();
    terminal.sendText(command);

    return true;
  }
}
