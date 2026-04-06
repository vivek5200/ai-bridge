/**
 * Interactive Dependency Selection
 *
 * Shows a checklist of direct imports from the entry file,
 * allowing the user to select which dependencies to include.
 */

import * as fs from 'fs';
import * as path from 'path';
import { input, checkbox } from '@inquirer/prompts';

/**
 * Parse imports from the entry file and let user select which to include.
 * Returns an array of selected import specifiers.
 */
export async function selectImports(entryFile: string): Promise<string[] | null> {
  const absoluteEntry = path.resolve(entryFile);
  const content = fs.readFileSync(absoluteEntry, 'utf-8');

  // Extract import specifiers
  const imports: { name: string; specifier: string; isLocal: boolean }[] = [];

  // ES imports
  const esRegex = /import\s+(?:([\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esRegex.exec(content)) !== null) {
    const imported = match[1]?.trim() || match[2];
    imports.push({
      name: imported,
      specifier: match[2],
      isLocal: match[2].startsWith('.'),
    });
  }

  // CommonJS requires
  const reqRegex = /(?:const|let|var)\s+([\w{}]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = reqRegex.exec(content)) !== null) {
    imports.push({
      name: match[1],
      specifier: match[2],
      isLocal: match[2].startsWith('.'),
    });
  }

  if (imports.length === 0) {
    return null; // No imports found — crawl everything
  }

  const localImports = imports.filter((i) => i.isLocal);
  const libImports = imports.filter((i) => !i.isLocal);

  if (localImports.length === 0) {
    return null;
  }

  const choices = localImports.map((imp) => ({
    name: `${imp.specifier} (${imp.name})`,
    value: imp.specifier,
    checked: true,
  }));

  if (libImports.length > 0) {
    console.log(`\n  📦 External dependencies (not included in crawl):`);
    for (const lib of libImports) {
      console.log(`     - ${lib.specifier}`);
    }
    console.log('');
  }

  const selected = await checkbox({
    message: 'Select local imports to include in context:',
    choices,
  });

  return selected;
}
