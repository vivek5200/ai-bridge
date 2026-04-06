const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Persistent Queue Manager
 *
 * Stores messages when the VS Code client is disconnected.
 * Uses atomic writes (write to .tmp then rename) for crash safety.
 */
class QueueManager {
  constructor(dataDir) {
    this.queuePath = path.join(dataDir, 'queue.json');
    this.tmpPath = path.join(dataDir, 'queue.json.tmp');
    this.queue = this._load();
  }

  /**
   * Load queue from disk. Returns empty array on error.
   */
  _load() {
    try {
      if (fs.existsSync(this.queuePath)) {
        const raw = fs.readFileSync(this.queuePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch (e) {
      console.error('[Queue] Failed to load queue.json:', e.message);
    }
    return [];
  }

  /**
   * Persist queue to disk with atomic write.
   */
  _save() {
    try {
      const json = JSON.stringify(this.queue, null, 2);
      fs.writeFileSync(this.tmpPath, json, 'utf-8');
      fs.renameSync(this.tmpPath, this.queuePath);
    } catch (e) {
      console.error('[Queue] Failed to save queue.json:', e.message);
    }
  }

  /**
   * Enqueue a message. Returns the assigned message ID.
   */
  enqueue(message) {
    const entry = {
      id: uuidv4(),
      timestamp: Date.now(),
      payload: message,
    };
    this.queue.push(entry);
    this._save();
    console.log(`[Queue] Enqueued message ${entry.id} (queue size: ${this.queue.length})`);
    return entry.id;
  }

  /**
   * Get all queued messages (oldest first).
   */
  getAll() {
    return [...this.queue];
  }

  /**
   * Remove a message by ID (after successful delivery + ack).
   */
  remove(id) {
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.id !== id);
    if (this.queue.length < before) {
      this._save();
      console.log(`[Queue] Removed message ${id} (queue size: ${this.queue.length})`);
      return true;
    }
    return false;
  }

  /**
   * Clear all messages from the queue.
   */
  clear() {
    this.queue = [];
    this._save();
    console.log('[Queue] Cleared all messages');
  }

  /**
   * Get the number of pending messages.
   */
  get size() {
    return this.queue.length;
  }

  /**
   * Check if a queued message is stale (older than maxAge ms, default 1 hour).
   */
  getStaleMessages(maxAgeMs = 3600000) {
    const cutoff = Date.now() - maxAgeMs;
    return this.queue.filter((entry) => entry.timestamp < cutoff);
  }
}

module.exports = { QueueManager };
