# AI Bridge — Browser-to-VS Code

> Capture AI-generated code from ChatGPT, Claude, and Gemini — apply it directly in VS Code with one click.

## Architecture

```
Browser Extension  ──WebSocket──►  Local Hub (127.0.0.1:8080)  ──WebSocket──►  VS Code Extension
     │                                    │                                         │
     ├─ Detects code blocks               ├─ Auth token                             ├─ Diff repair & apply
     ├─ Confirmation modal                ├─ Persistent queue                       ├─ Terminal allowlist
     └─ Active file sync                  └─ Message routing                        └─ File routing
```

## Components

| Package | Description |
|---------|-------------|
| `packages/hub` | Node.js WebSocket server — secure message router with persistent queue |
| `packages/vscode-extension` | VS Code extension — applies diffs, guards terminal commands |
| `packages/browser-extension` | Chrome/Edge MV3 extension — captures AI output, sends edits |
| `packages/context-cli` | CLI tool — token-budget aware dependency crawler |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the hub
npm run start -w packages/hub

# 3. Copy the printed token and paste it into the browser extension options page

# 4. Install the VS Code extension (reads token automatically)

# 5. Use bridge-context CLI to gather context, paste into AI chat, and send code back!
```

## Security

- 🔒 WebSocket bound to `127.0.0.1` only — no external access
- 🔑 Token-based authentication (pasted by user, never transmitted externally)
- 🛡️ Terminal commands blocked by default (allowlist only)
- 📝 All file edits confirmed via diff editor or manual merge
- 💾 No automatic git commits — uses VS Code Local History

## License

MIT
