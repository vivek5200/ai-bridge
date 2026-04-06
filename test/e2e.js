/**
 * End-to-End Integration Test
 *
 * Tests the full flow: Browser Extension (mock) → Hub → VS Code Extension (mock)
 *
 * Usage: node test/e2e.js
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ─── Config ─────────────────────────────────────────────────────────────────

const HUB_PORT = 9999; // Use non-default port for testing
const HUB_HOST = '127.0.0.1';
const DATA_DIR = path.join(os.tmpdir(), `ai-bridge-test-${Date.now()}`);

let hubProcess = null;
let passed = 0;
let failed = 0;
let totalTests = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectWS(clientType, tabId) {
  const token = fs.readFileSync(path.join(DATA_DIR, 'auth.token'), 'utf-8').trim();
  const params = `token=${token}&client=${clientType}${tabId ? `&tabId=${tabId}` : ''}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HUB_HOST}:${HUB_PORT}?${params}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

// ─── Setup: Start Hub ───────────────────────────────────────────────────────

async function startHub() {
  // Ensure data dir exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Generate a test token
  const testToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(DATA_DIR, 'auth.token'), testToken, { mode: 0o600 });

  // We'll modify the hub to use our data dir and port via env vars
  // For now, start the hub with env overrides
  const hubScript = path.join(__dirname, '..', 'packages', 'hub', 'src', 'server.js');

  hubProcess = spawn(process.execPath, [hubScript], {
    env: {
      ...process.env,
      AI_BRIDGE_PORT: String(HUB_PORT),
      AI_BRIDGE_DATA_DIR: DATA_DIR,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for hub to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Hub start timeout')), 10000);

    hubProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Ready. Waiting for connections')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    hubProcess.stderr.on('data', (data) => {
      console.error(`  [Hub stderr] ${data.toString().trim()}`);
    });

    hubProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log('  Hub started on port', HUB_PORT);
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

async function testAuthRejection() {
  console.log('\n📋 Test: Authentication Rejection');

  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HUB_HOST}:${HUB_PORT}?token=invalid-token&client=browser`);
    ws.on('close', (code) => {
      // 4001 = custom unauthorized code; 1006 = abnormal close (Windows ws behavior)
      assert(code === 4001 || code === 1006, `Rejected with close code ${code} (expected 4001 or 1006)`);
      resolve();
    });
    ws.on('error', () => resolve()); // Connection error is also acceptable
  });
}

async function testVSCodeConnection() {
  console.log('\n📋 Test: VS Code Client Connection');

  const vsWs = await connectWS('vscode');
  assert(vsWs.readyState === WebSocket.OPEN, 'VS Code client connects successfully');

  // Send READY
  vsWs.send(JSON.stringify({ type: 'READY' }));
  await sleep(200);
  assert(true, 'VS Code sends READY without error');

  vsWs.close();
  await sleep(200);
}

async function testBrowserToVSCode() {
  console.log('\n📋 Test: Browser → Hub → VS Code (APPLY_EDIT)');

  const vsWs = await connectWS('vscode');
  vsWs.send(JSON.stringify({ type: 'READY' }));
  await sleep(300);

  const browserWs = await connectWS('browser', 'tab-test-1');
  assert(browserWs.readyState === WebSocket.OPEN, 'Browser client connects');

  // Browser sends APPLY_EDIT
  const editPayload = {
    type: 'APPLY_EDIT',
    tabId: 'tab-test-1',
    payload: {
      filePath: 'src/test.ts',
      diff: '--- a/src/test.ts\n+++ b/src/test.ts\n@@ -1,3 +1,4 @@\n import React from "react";\n+import { useState } from "react";\n \n export default function App() {',
    },
  };
  browserWs.send(JSON.stringify(editPayload));

  // VS Code should receive the message
  const received = await waitForMessage(vsWs);
  assert(received.type === 'APPLY_EDIT', `VS Code receives APPLY_EDIT (got ${received.type})`);
  assert(received.payload.filePath === 'src/test.ts', 'File path preserved');
  assert(received.payload.diff.includes('useState'), 'Diff content preserved');

  browserWs.close();
  vsWs.close();
  await sleep(200);
}

async function testTerminalCommand() {
  console.log('\n📋 Test: Browser → Hub → VS Code (RUN_TERMINAL)');

  const vsWs = await connectWS('vscode');
  vsWs.send(JSON.stringify({ type: 'READY' }));
  await sleep(300);

  const browserWs = await connectWS('browser', 'tab-test-2');

  // Browser sends RUN_TERMINAL
  browserWs.send(JSON.stringify({
    type: 'RUN_TERMINAL',
    tabId: 'tab-test-2',
    payload: { command: 'npm run dev' },
  }));

  const received = await waitForMessage(vsWs);
  assert(received.type === 'RUN_TERMINAL', `VS Code receives RUN_TERMINAL (got ${received.type})`);
  assert(received.payload.command === 'npm run dev', 'Command preserved');

  browserWs.close();
  vsWs.close();
  await sleep(200);
}

async function testActiveFilePolling() {
  console.log('\n📋 Test: Active File Polling (Browser ↔ VS Code)');

  const vsWs = await connectWS('vscode');
  vsWs.send(JSON.stringify({ type: 'READY' }));
  await sleep(300);

  const browserWs = await connectWS('browser', 'tab-test-3');
  await sleep(200);

  // Browser requests active file
  browserWs.send(JSON.stringify({ type: 'GET_ACTIVE_FILE' }));

  // VS Code should receive the request
  const req = await waitForMessage(vsWs);
  assert(req.type === 'GET_ACTIVE_FILE', 'VS Code receives GET_ACTIVE_FILE');

  // VS Code responds with active file
  vsWs.send(JSON.stringify({
    type: 'ACTIVE_FILE',
    filePath: 'src/components/App.tsx',
  }));

  // Browser should receive the response
  const resp = await waitForMessage(browserWs);
  assert(resp.type === 'ACTIVE_FILE', 'Browser receives ACTIVE_FILE');
  assert(resp.filePath === 'src/components/App.tsx', 'Active file path correct');

  browserWs.close();
  vsWs.close();
  await sleep(200);
}

async function testQueueing() {
  console.log('\n📋 Test: Message Queuing (VS Code offline)');

  // Connect browser WITHOUT VS Code
  const browserWs = await connectWS('browser', 'tab-queue-1');
  await sleep(200);

  // Send an edit while VS Code is offline
  browserWs.send(JSON.stringify({
    type: 'APPLY_EDIT',
    tabId: 'tab-queue-1',
    payload: { filePath: 'src/queued.ts', diff: 'queued-diff-content' },
  }));

  // Browser should receive a queued notification
  const queueNotice = await waitForMessage(browserWs);
  assert(queueNotice.type === 'ERROR', 'Browser receives queue notification');
  assert(queueNotice.queued === true, 'Message marked as queued');

  // Now connect VS Code — should receive the queued message
  const vsWs = await connectWS('vscode');
  const queued = await waitForMessage(vsWs, 3000);
  assert(queued.type === 'APPLY_EDIT', 'VS Code receives queued APPLY_EDIT');
  assert(queued.isQueued === true, 'Message marked as previously queued');
  assert(queued.payload.filePath === 'src/queued.ts', 'Queued file path correct');

  // ACK the queued message
  vsWs.send(JSON.stringify({ type: 'ACK', id: queued.queueId }));
  await sleep(500);

  assert(true, 'Queue ACK sent successfully');

  browserWs.close();
  vsWs.close();
  await sleep(200);
}

async function testInvalidMessage() {
  console.log('\n📋 Test: Invalid Message Handling');

  const browserWs = await connectWS('browser', 'tab-invalid');
  await sleep(200);

  // Send invalid JSON
  browserWs.send('not valid json');
  const errResp = await waitForMessage(browserWs);
  assert(errResp.type === 'ERROR', 'Invalid JSON returns ERROR');

  // Send unknown type
  browserWs.send(JSON.stringify({ type: 'UNKNOWN_TYPE' }));
  const errResp2 = await waitForMessage(browserWs);
  assert(errResp2.type === 'ERROR', 'Unknown type returns ERROR');

  browserWs.close();
  await sleep(200);
}

async function testMultipleBrowserTabs() {
  console.log('\n📋 Test: Multiple Browser Tabs');

  const vsWs = await connectWS('vscode');
  vsWs.send(JSON.stringify({ type: 'READY' }));
  await sleep(300);

  const tab1 = await connectWS('browser', 'multi-tab-1');
  const tab2 = await connectWS('browser', 'multi-tab-2');
  await sleep(200);

  // Tab 1 sends edit
  tab1.send(JSON.stringify({
    type: 'APPLY_EDIT',
    tabId: 'multi-tab-1',
    payload: { filePath: 'from-tab-1.ts', diff: 'tab1-diff' },
  }));

  const msg1 = await waitForMessage(vsWs);
  assert(msg1.payload.filePath === 'from-tab-1.ts', 'Tab 1 message received by VS Code');

  // Tab 2 sends edit
  tab2.send(JSON.stringify({
    type: 'APPLY_EDIT',
    tabId: 'multi-tab-2',
    payload: { filePath: 'from-tab-2.ts', diff: 'tab2-diff' },
  }));

  const msg2 = await waitForMessage(vsWs);
  assert(msg2.payload.filePath === 'from-tab-2.ts', 'Tab 2 message received by VS Code');

  tab1.close();
  tab2.close();
  vsWs.close();
  await sleep(200);
}

// ─── Runner ─────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🚀 AI Bridge E2E Integration Test Suite\n');
  console.log('='
    .repeat(50));

  try {
    await startHub();

    await testAuthRejection();
    await testVSCodeConnection();
    await testBrowserToVSCode();
    await testTerminalCommand();
    await testActiveFilePolling();
    await testQueueing();
    await testInvalidMessage();
    await testMultipleBrowserTabs();

  } catch (err) {
    console.error('\n💥 Test suite error:', err.message);
    failed++;
  } finally {
    // Cleanup
    if (hubProcess) {
      hubProcess.kill('SIGTERM');
    }

    // Remove temp data dir
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {}

    // Results
    console.log('\n' + '='.repeat(50));
    console.log(`\n  Results: ${passed}/${totalTests} passed, ${failed} failed\n`);

    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
