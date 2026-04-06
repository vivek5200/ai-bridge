# ai-bridge-cli

> Token-budget aware dependency crawler for assembling AI chat context.

## Install

```bash
npm install -g ai-bridge-cli
```

## Usage

```bash
# Crawl a file and its dependencies, copy to clipboard
bridge-context src/pages/Dashboard.tsx

# Set a custom token budget and depth
bridge-context src/App.tsx --budget 10000 --depth 3

# Skip interactive mode, output to file
bridge-context src/index.ts --no-interactive --output context.md

# Include database schema
bridge-context src/api/routes.ts --db postgres
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-b, --budget <tokens>` | `8000` | Token budget (stops when exceeded) |
| `-d, --depth <N>` | `2` | Maximum crawl depth for imports |
| `--include-libs` | `false` | Include library import names |
| `--no-interactive` | - | Skip import selection checklist |
| `--db <connector>` | - | Include external context (e.g., DB schema) |
| `--exclude <patterns>` | `node_modules,dist,...` | Comma-separated exclude patterns |
| `--no-copy` | - | Don't copy to clipboard |
| `-o, --output <file>` | - | Write to file instead of clipboard |

## How It Works

1. Parses the entry file for `import` / `require` statements
2. Shows an interactive checklist of local dependencies
3. Crawls selected imports via BFS up to `--depth`
4. Counts tokens using `tiktoken` (cl100k_base encoding)
5. Stops when the token budget is exceeded
6. Formats output as Markdown with code blocks
7. Copies to clipboard (ready to paste into AI chat)

## Database Connectors

Create `.bridge-context.json` in your project root:

```json
{
  "dbConnectors": {
    "postgres": "node scripts/dump_postgres_schema.js --table users",
    "redis": "node scripts/dump_redis_keys.js"
  }
}
```

Then use `--db postgres` to include the output.

## License

MIT
