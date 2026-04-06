/**
 * Output Formatter
 *
 * Formats crawl results as markdown code blocks
 * suitable for pasting into AI chat interfaces.
 */

import { type CrawlResult, getLanguage } from './crawler.js';
import { formatTokenCount } from './tokenBudget.js';

/**
 * Format crawl results into a markdown string.
 */
export function formatOutput(result: CrawlResult, budget: number): string {
  const sections: string[] = [];

  // Header
  sections.push('# Project Context\n');

  // File list summary
  sections.push(`> ${result.files.length} file(s) included | ${formatTokenCount(result.totalTokens, budget)}\n`);

  if (result.budgetExceeded) {
    sections.push('> ⚠️ Token budget exceeded — some files were skipped.\n');
  }

  // File contents
  for (const file of result.files) {
    const lang = getLanguage(file.absolutePath);
    const depthIndicator = file.depth > 0 ? ` (depth: ${file.depth})` : ' (entry)';

    sections.push(`## ${file.relativePath}${depthIndicator} — ${file.tokens.toLocaleString()} tokens\n`);
    sections.push(`\`\`\`${lang}`);
    sections.push(file.content);
    sections.push('```\n');
  }

  // Summary table
  sections.push('---\n');
  sections.push('| File | Tokens | Depth |');
  sections.push('|------|--------|-------|');
  for (const file of result.files) {
    sections.push(`| ${file.relativePath} | ${file.tokens.toLocaleString()} | ${file.depth} |`);
  }
  sections.push(`| **Total** | **${result.totalTokens.toLocaleString()}** | |`);

  // Skipped files
  if (result.skippedFiles.length > 0) {
    sections.push('\n### Skipped Files');
    for (const skipped of result.skippedFiles) {
      sections.push(`- ${skipped}`);
    }
  }

  return sections.join('\n');
}

/**
 * Format a compact summary for terminal display.
 */
export function formatSummary(result: CrawlResult, budget: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('  Files included:');
  for (const file of result.files) {
    const depthPad = '  '.repeat(file.depth);
    lines.push(`    ${depthPad}${file.relativePath} (${file.tokens.toLocaleString()} tokens)`);
  }

  lines.push('');
  lines.push(`  ${formatTokenCount(result.totalTokens, budget)}`);

  if (result.budgetExceeded) {
    lines.push('');
    lines.push('  ⚠️  Budget exceeded! Some files were skipped.');
  }

  if (result.skippedFiles.length > 0) {
    lines.push('');
    lines.push('  Skipped:');
    for (const skipped of result.skippedFiles) {
      lines.push(`    - ${skipped}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
