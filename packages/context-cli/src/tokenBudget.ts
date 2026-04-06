/**
 * Token Budget — Token counting wrapper using tiktoken
 *
 * Uses cl100k_base encoding (GPT-4 / Claude compatible).
 */

import { encoding_for_model } from 'tiktoken';

let encoder: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder() {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

/**
 * Count the number of tokens in a text string.
 */
export function countTokens(text: string): number {
  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch {
    // Fallback: rough estimate (1 token ≈ 4 chars)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Format token count with budget context.
 */
export function formatTokenCount(used: number, budget: number): string {
  const pct = Math.round((used / budget) * 100);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  return `[${bar}] ${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`;
}

/**
 * Cleanup encoder resources.
 */
export function freeEncoder() {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}
