// U4 regression coverage: the shared `.animate-fade-up` CSS utility (globals.css)
// is what every CSS-converted entrance animation (home page, street page,
// KeyStats, ComparableSales) relies on for prefers-reduced-motion respect. jsdom
// has no real CSS engine, so this is a static-content guard rather than a
// rendered-style assertion — it fails loudly if the reduced-motion override is
// ever accidentally removed or detached from the animation it's meant to cancel.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');

describe('.animate-fade-up reduced-motion handling', () => {
  it('defines the fade-up animation utility', () => {
    expect(css).toMatch(/\.animate-fade-up\s*{[^}]*animation:\s*fade-up/);
  });

  it('neutralises the animation under prefers-reduced-motion: reduce', () => {
    const reducedBlockMatch = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)}\s*}/,
    );
    expect(reducedBlockMatch).not.toBeNull();
    const reducedBlock = reducedBlockMatch![1];
    expect(reducedBlock).toContain('.animate-fade-up');
    expect(reducedBlock).toMatch(/animation:\s*none/);
  });
});
