import { camoufoxEngine } from './camoufox.js';
import { patchrightEngine } from './patchright.js';
import { playwrightEngine } from './playwright.js';
import type { Engine } from './types.js';

export type EngineName = 'camoufox' | 'patchright' | 'playwright';

const engines: Record<EngineName, Engine> = {
  camoufox: camoufoxEngine,
  patchright: patchrightEngine,
  playwright: playwrightEngine,
};

/** Default engine when a request doesn't specify one. */
export function defaultEngineName(): EngineName {
  const requested = process.env.STEALTH_ENGINE;
  if (requested === 'patchright' || requested === 'playwright') return requested;
  return 'camoufox';
}

export function getEngine(name?: string): Engine {
  if (name === 'camoufox' || name === 'patchright' || name === 'playwright') {
    return engines[name];
  }
  return engines[defaultEngineName()];
}

export type { Engine } from './types.js';
