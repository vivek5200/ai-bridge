/**
 * Database / External Context Connectors
 *
 * Reads `.bridge-context.json` for configured external data sources
 * and executes their scripts to append context.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface ConnectorConfig {
  dbConnectors?: Record<string, string>;
}

/**
 * Load connector configuration from `.bridge-context.json`.
 */
function loadConfig(): ConnectorConfig {
  const configPath = path.resolve('.bridge-context.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e: any) {
    console.error(`Warning: Failed to parse .bridge-context.json: ${e.message}`);
    return {};
  }
}

/**
 * Execute a database connector and return its output.
 */
export function executeConnector(connectorName: string): string | null {
  const config = loadConfig();

  if (!config.dbConnectors || !config.dbConnectors[connectorName]) {
    console.error(`Error: No connector configured for "${connectorName}".`);
    console.error('Available connectors:', Object.keys(config.dbConnectors || {}).join(', ') || 'none');
    return null;
  }

  const command = config.dbConnectors[connectorName];
  console.log(`  Running connector: ${connectorName} → ${command}`);

  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024, // 1MB max output
    });

    return output;
  } catch (e: any) {
    console.error(`Error running connector "${connectorName}": ${e.message}`);
    return null;
  }
}

/**
 * Format connector output as a markdown block.
 */
export function formatConnectorOutput(name: string, output: string): string {
  return `\n## External Context: ${name}\n\n\`\`\`sql\n${output}\n\`\`\`\n`;
}

/**
 * Get a list of available connector names.
 */
export function getAvailableConnectors(): string[] {
  const config = loadConfig();
  return Object.keys(config.dbConnectors || {});
}
