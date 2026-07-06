// U5 regression coverage: internal navigation must use next/link (client-side
// transition, no full-page reload), not a raw <a href="/..."> tag. A static
// source scan is the practical check here — rendered JSX for next/link and a
// raw <a> look identical once mounted (both are <a> elements in the DOM), so
// asserting "no full reload" isn't observable via RTL without a real browser.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(__dirname, '..', '..'); // src/app/__tests__ -> src
const REPO_ROOT = join(SRC_DIR, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

describe('internal navigation uses next/link, not raw <a> tags', () => {
  it('no .tsx file has a raw <a href="/..."> pointing at an internal route', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      const matches = [...content.matchAll(/<a\b[^>]*>/g)];
      for (const m of matches) {
        const tag = m[0];
        // Internal, absolute-path href (starts with a single "/") and no
        // target attribute (an explicit new-tab external link is intentional).
        if (/href=(\{`\/(?!\/)|"\/(?!\/))/.test(tag) && !/target=/.test(tag)) {
          offenders.push(file.slice(REPO_ROOT.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
