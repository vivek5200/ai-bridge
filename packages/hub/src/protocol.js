/**
 * AI Bridge WebSocket Protocol
 *
 * Defines all message types and provides validation.
 */

// Message types sent FROM browser extension
const BROWSER_TYPES = {
  APPLY_EDIT: 'APPLY_EDIT',
  RUN_TERMINAL: 'RUN_TERMINAL',
};

// Message types sent FROM VS Code extension
const VSCODE_TYPES = {
  READY: 'READY',
  ACTIVE_FILE: 'ACTIVE_FILE',
  ACK: 'ACK',
};

// Message types sent FROM either direction
const SHARED_TYPES = {
  GET_ACTIVE_FILE: 'GET_ACTIVE_FILE',
  ERROR: 'ERROR',
  PING: 'PING',
  PONG: 'PONG',
};

const ALL_TYPES = {
  ...BROWSER_TYPES,
  ...VSCODE_TYPES,
  ...SHARED_TYPES,
};

/**
 * Validate an incoming message object.
 * Returns { valid: boolean, error?: string }
 */
function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message must be a JSON object' };
  }

  if (!msg.type || typeof msg.type !== 'string') {
    return { valid: false, error: 'Message must have a "type" string field' };
  }

  if (!Object.values(ALL_TYPES).includes(msg.type)) {
    return { valid: false, error: `Unknown message type: ${msg.type}` };
  }

  // Validate APPLY_EDIT payload
  if (msg.type === ALL_TYPES.APPLY_EDIT) {
    if (!msg.payload || typeof msg.payload !== 'object') {
      return { valid: false, error: 'APPLY_EDIT must have a "payload" object' };
    }
    if (!msg.payload.filePath && !msg.payload.diff) {
      return { valid: false, error: 'APPLY_EDIT payload must have "filePath" or "diff"' };
    }
  }

  // Validate RUN_TERMINAL payload
  if (msg.type === ALL_TYPES.RUN_TERMINAL) {
    if (!msg.payload || typeof msg.payload !== 'object') {
      return { valid: false, error: 'RUN_TERMINAL must have a "payload" object' };
    }
    if (!msg.payload.command || typeof msg.payload.command !== 'string') {
      return { valid: false, error: 'RUN_TERMINAL payload must have a "command" string' };
    }
  }

  // Validate ACK
  if (msg.type === ALL_TYPES.ACK) {
    if (!msg.id) {
      return { valid: false, error: 'ACK must have an "id" field' };
    }
  }

  return { valid: true };
}

/**
 * Parse a raw WebSocket message string into a validated object.
 * Returns { msg, error }
 */
function parseMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return { msg: null, error: 'Invalid JSON' };
  }

  const validation = validateMessage(msg);
  if (!validation.valid) {
    return { msg: null, error: validation.error };
  }

  return { msg, error: null };
}

module.exports = {
  BROWSER_TYPES,
  VSCODE_TYPES,
  SHARED_TYPES,
  ALL_TYPES,
  validateMessage,
  parseMessage,
};
