# @ai-bridge/hub

> Local WebSocket hub for AI Bridge — secure message router with persistent queue.

## Install

```bash
npm install -g @ai-bridge/hub
```

## Usage

```bash
# Start the hub (generates auth token on first run)
ai-bridge-hub

# Or run directly
npx @ai-bridge/hub
```

On first start, the hub will:
1. Generate a 32-byte auth token
2. Print the token in a large, copyable format
3. Save the token to your data directory
4. Start listening on `ws://127.0.0.1:8080`

## Data Directory

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\ai-bridge\` |
| macOS    | `~/Library/Application Support/ai-bridge/` |
| Linux    | `~/.local/share/ai-bridge/` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BRIDGE_PORT` | `8080` | WebSocket server port |
| `AI_BRIDGE_DATA_DIR` | (auto) | Override data directory |

## Protocol

All messages are JSON over WebSocket. See the [protocol documentation](../../docs/protocol.md) for details.

## Security

- Server binds to `127.0.0.1` only (localhost)
- Token-based authentication on every connection
- No external network access
- Persistent queue with crash-safe atomic writes

## License

MIT
