#!/usr/bin/env node

/**
 * AI Bridge Context CLI
 *
 * Token-budget aware dependency crawler for assembling context
 * to paste into AI chat interfaces.
 *
 * Usage:
 *   bridge-context <entry-file> [options]
 *
 * Example:
 *   bridge-context src/pages/Dashboard.tsx --budget 10000 --depth 2
 */

import { Command } from 'commander';
import chalk from 'chalk';
import clipboardy from 'clipboardy';
import { confirm } from '@inquirer/prompts';
import { crawl } from './crawler.js';
import { formatOutput, formatSummary } from './formatter.js';
import { freeEncoder } from './tokenBudget.js';
import { selectImports } from './interactive.js';
import { executeConnector, formatConnectorOutput, getAvailableConnectors } from './dbConnectors.js';

const program = new Command();

program
  .name('bridge-context')
  .description('Token-budget aware dependency crawler for AI Bridge')
  .version('1.0.0')
  .argument('<entry-file>', 'Entry file to start crawling from')
  .option('-b, --budget <tokens>', 'Token budget', '8000')
  .option('-d, --depth <depth>', 'Maximum crawl depth', '2')
  .option('--include-libs', 'Include library import names', false)
  .option('--no-interactive', 'Skip interactive import selection')
  .option('--db <connector>', 'Include database connector output')
  .option('--exclude <patterns>', 'Comma-separated exclude patterns', 'node_modules,dist,out,.git')
  .option('--no-copy', 'Do not copy to clipboard')
  .option('-o, --output <file>', 'Write output to file instead of clipboard')
  .action(async (entryFile, options) => {
    try {
      await run(entryFile, options);
    } catch (e: any) {
      console.error(chalk.red(`\n  Error: ${e.message}\n`));
      process.exit(1);
    } finally {
      freeEncoder();
    }
  });

program.parse();

async function run(entryFile: string, options: any) {
  const budget = parseInt(options.budget, 10);
  const maxDepth = parseInt(options.depth, 10);
  const includeLibs = options.includeLibs;
  const excludePatterns = options.exclude.split(',').map((s: string) => s.trim());
  const interactive = options.interactive !== false;

  console.log(chalk.bold.blue('\n  ⚡ AI Bridge Context Crawler\n'));
  console.log(`  Entry: ${chalk.cyan(entryFile)}`);
  console.log(`  Budget: ${chalk.yellow(budget.toLocaleString())} tokens`);
  console.log(`  Depth: ${chalk.yellow(String(maxDepth))}`);

  // Interactive import selection
  let selectedImports: string[] | undefined;
  if (interactive) {
    const selected = await selectImports(entryFile);
    if (selected !== null) {
      selectedImports = selected;
    }
  }

  // Run the crawler
  console.log(chalk.gray('\n  Crawling dependencies...\n'));

  const result = crawl({
    entryFile,
    budget,
    maxDepth,
    includeLibs,
    excludePatterns,
    selectedImports,
  });

  // Show summary
  console.log(formatSummary(result, budget));

  // Format output
  let output = formatOutput(result, budget);

  // Add database connector output if requested
  if (options.db) {
    const connectorOutput = executeConnector(options.db);
    if (connectorOutput) {
      output += formatConnectorOutput(options.db, connectorOutput);
    }
  }

  // Output to file if specified
  if (options.output) {
    const fs = await import('fs');
    fs.writeFileSync(options.output, output, 'utf-8');
    console.log(chalk.green(`  ✓ Written to ${options.output}`));
    return;
  }

  // Copy to clipboard
  if (options.copy !== false) {
    const shouldCopy = !interactive || await confirm({
      message: 'Copy to clipboard?',
      default: true,
    });

    if (shouldCopy) {
      await clipboardy.write(output);
      console.log(chalk.green('  ✓ Copied to clipboard!\n'));
    }
  }

  // Show available connectors
  const connectors = getAvailableConnectors();
  if (connectors.length > 0 && !options.db) {
    console.log(chalk.gray(`  Tip: Use --db <name> to include external context.`));
    console.log(chalk.gray(`  Available connectors: ${connectors.join(', ')}\n`));
  }
}
