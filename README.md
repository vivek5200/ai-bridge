# AI Bridge — Browser-to-VS Code

[![NPM: Hub](https://img.shields.io/npm/v/ai-bridge-hub.svg?label=ai-bridge-hub&color=green)](https://npmjs.com/package/ai-bridge-hub)
[![NPM: CLI](https://img.shields.io/npm/v/ai-bridge-cli.svg?label=ai-bridge-cli&color=blue)](https://npmjs.com/package/ai-bridge-cli)
[![GitHub release](https://img.shields.io/github/v/release/vivek5200/ai-bridge)](https://github.com/vivek5200/ai-bridge/releases)

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

### 1. Install Node Packages

```bash
npm install -g ai-bridge-hub ai-bridge-cli
```

### 2. Start the Hub

```bash
ai-bridge-hub
```
*Copy the printed 32-character token*

### 3. Install Applications

- **VS Code Extension**: Search for `Vivek AI Bridge` in the extensions tab, or download from GitHub Releases.
- **Chrome / Edge Extension**: Download from Microsoft Edge Add-ons (search `AI Bridge`), or load manually using the GitHub Releases `.zip`.

### 4. Setup

Paste your auth token into the browser extension when prompted. The VS Code extension reads the token automatically.

### 5. Send Code!

Browse to ChatGPT or Claude. Use `bridge-context` CLI in your terminal to gather project context and paste it to the AI. Click the new lightning button on the AI code blocks to shoot them directly into VS Code!

## Security

- 🔒 WebSocket bound to `127.0.0.1` only — no external access
- 🔑 Token-based authentication (pasted by user, never transmitted externally)
- 🛡️ Terminal commands blocked by default (allowlist only)
- 📝 All file edits confirmed via diff editor or manual merge
- 💾 No automatic git commits — uses VS Code Local History

## License

MIT
