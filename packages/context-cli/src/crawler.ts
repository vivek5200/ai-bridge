/**
 * BFS Dependency Crawler
 *
 * Crawls local imports starting from an entry file,
 * collecting file contents within a token budget.
 * Uses a simple regex-based import parser (lightweight alternative to ts-morph).
 */

import * as fs from 'fs';
import * as path from 'path';
import { countTokens } from './tokenBudget.js';

export interface CrawlResult {
  files: FileEntry[];
  totalTokens: number;
  budgetExceeded: boolean;
  skippedFiles: string[];
}

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  content: string;
  tokens: number;
  depth: number;
  imports: string[];
}

interface CrawlOptions {
  entryFile: string;
  budget: number;
  maxDepth: number;
  includeLibs: boolean;
  excludePatterns: string[];
  selectedImports?: string[]; // If set, only include these imports from entry file
}

/**
 * Parse import/require statements from a file using regex.
 * Returns an array of module specifier strings.
 */
function parseImports(content: string, filePath: string): string[] {
  const imports: string[] = [];

  // ES Module imports: import ... from '...'
  const esImportRegex = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Dynamic imports: import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // CommonJS require: require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return [...new Set(imports)];
}

/**
 * Check if an import specifier is a local file (relative path).
 */
function isLocalImport(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

/**
 * Resolve a local import to an absolute file path.
 * Tries multiple extensions if the specifier doesn't have one.
 */
function resolveImport(specifier: string, fromFile: string): string | null {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, specifier);

  // If specifier already has an extension, try it directly
  if (path.extname(specifier)) {
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    return null;
  }

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  // Try index files (e.g., ./components → ./components/index.ts)
  for (const ext of extensions) {
    const indexFile = path.join(resolved, `index${ext}`);
    if (fs.existsSync(indexFile)) {
      return indexFile;
    }
  }

  return null;
}

/**
 * Get the language identifier for a file extension.
 */
function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.json': 'json',
    '.sql': 'sql',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
  };
  return map[ext] || 'text';
}

/**
 * Run the BFS crawler.
 */
export function crawl(options: CrawlOptions): CrawlResult {
  const { entryFile, budget, maxDepth, includeLibs, excludePatterns, selectedImports } = options;

  const absoluteEntry = path.resolve(entryFile);
  if (!fs.existsSync(absoluteEntry)) {
    throw new Error(`Entry file not found: ${absoluteEntry}`);
  }

  const baseDir = process.cwd();
  const visited = new Set<string>();
  const files: FileEntry[] = [];
  const skippedFiles: string[] = [];
  let totalTokens = 0;
  let budgetExceeded = false;

  // BFS queue: [absolutePath, depth]
  const queue: [string, number][] = [[absoluteEntry, 0]];

  while (queue.length > 0) {
    const [filePath, depth] = queue.shift()!;

    // Skip if already visited
    if (visited.has(filePath)) {
      continue;
    }
    visited.add(filePath);

    // Skip if beyond max depth
    if (depth > maxDepth) {
      skippedFiles.push(path.relative(baseDir, filePath) + ' (depth exceeded)');
      continue;
    }

    // Check exclude patterns
    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
    const segments = relativePath.split('/');
    const shouldExclude = excludePatterns.some(
      (p) => segments.includes(p) || p === relativePath
    );
    if (shouldExclude) {
      continue;
    }

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      skippedFiles.push(relativePath + ' (read error)');
      continue;
    }

    // Count tokens
    const tokens = countTokens(content);

    // Check budget
    if (totalTokens + tokens > budget) {
      budgetExceeded = true;
      skippedFiles.push(relativePath + ` (${tokens} tokens, budget exceeded)`);
      continue;
    }

    // Parse imports
    const rawImports = parseImports(content, filePath);

    // Filter imports for entry file if selectedImports is provided
    let filteredImports = rawImports;
    if (depth === 0 && selectedImports) {
      filteredImports = rawImports.filter((imp) =>
        selectedImports.some((sel) => imp.includes(sel))
      );
    }

    // Resolve local imports and queue them
    const resolvedImports: string[] = [];
    for (const imp of filteredImports) {
      if (isLocalImport(imp)) {
        const resolved = resolveImport(imp, filePath);
        if (resolved) {
          resolvedImports.push(imp);
          if (!visited.has(resolved)) {
            queue.push([resolved, depth + 1]);
          }
        }
      } else if (includeLibs) {
        // Include library import names for context
        resolvedImports.push(imp);
      }
    }

    // Add to results
    files.push({
      relativePath,
      absolutePath: filePath,
      content,
      tokens,
      depth,
      imports: resolvedImports,
    });

    totalTokens += tokens;
  }

  return { files, totalTokens, budgetExceeded, skippedFiles };
}

export { getLanguage };
