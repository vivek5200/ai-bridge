const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Get the cross-platform data directory for AI Bridge.
 * Windows: %APPDATA%\ai-bridge
 * macOS:   ~/Library/Application Support/ai-bridge
 * Linux:   ~/.local/share/ai-bridge
 */
function getDataDir() {
  // Allow override via environment variable (for testing)
  if (process.env.AI_BRIDGE_DATA_DIR) {
    return process.env.AI_BRIDGE_DATA_DIR;
  }

  const platform = os.platform();
  let base;

  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }

  return path.join(base, 'ai-bridge');
}

/**
 * Ensure a directory exists (recursive).
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate a new 32-byte hex token.
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Read the auth token from disk. Returns null if not found.
 */
function readToken(dataDir) {
  const tokenPath = path.join(dataDir, 'auth.token');
  try {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Write the auth token to disk.
 */
function writeToken(dataDir, token) {
  const tokenPath = path.join(dataDir, 'auth.token');
  fs.writeFileSync(tokenPath, token, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Print the token in a large, copyable format.
 */
function displayToken(token) {
  const line = '='.repeat(50);
  console.log('');
  console.log(line);
  console.log('  AI BRIDGE TOKEN (save for browser extension)');
  console.log(line);
  console.log('');
  console.log(`  ${token}`);
  console.log('');
  console.log(line);
  console.log('');
}

module.exports = {
  getDataDir,
  ensureDir,
  generateToken,
  readToken,
  writeToken,
  displayToken,
};
