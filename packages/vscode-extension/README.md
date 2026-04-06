# AI Bridge — VS Code Extension

Apply AI-generated code from ChatGPT, Claude, and Gemini directly in VS Code.

## Features

- **Auto-connect** to the AI Bridge hub on startup
- **3-layer diff handler**: auto-repair → apply patch → fallback diff editor
- **Terminal allowlist**: deny-by-default command execution with user confirmation
- **Smart file routing**: QuickPick for ambiguous or missing files
- **Multi-root workspace** support with folder-prefixed file selection
- **Active file tracking**: responds to browser extension polling
- **Status bar indicator**: shows connection state (🟢/🔴)

## Setup

1. Start the AI Bridge hub: `npm start -w packages/hub`
2. Install this extension in VS Code
3. The extension reads the auth token automatically from disk
4. Use the browser extension to send code from AI chats

## Commands

- `AI Bridge: Connect to Hub` — manually connect
- `AI Bridge: Disconnect from Hub` — close connection
- `AI Bridge: Show Connection Status` — view status + reconnect
- `AI Bridge: Show Pending Queue` — check queued messages

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aiBridge.autoConnect` | `true` | Auto-connect on startup |
| `aiBridge.hubHost` | `127.0.0.1` | Hub server host |
| `aiBridge.hubPort` | `8080` | Hub server port |
| `aiBridge.allowedTerminalPrefixes` | `["npm ", "git ", ...]` | Allowed command prefixes |
| `aiBridge.alwaysConfirmTerminal` | `true` | Confirm before running commands |
| `aiBridge.diffFuzzFactor` | `2` | Fuzz factor for patch application |
