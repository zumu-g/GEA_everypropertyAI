import { describe, it, expect, vi } from 'vitest';

// next/font/google is an SWC-time loader that doesn't execute under vitest; stub the font
// factories so importing the layout module (for its `viewport` export) doesn't blow up.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '', className: '', style: {} });
  return { Instrument_Sans: font, IBM_Plex_Mono: font };
});

const { viewport } = await import('../layout');

// Behavioural assertion: the layout exports a Next 15 `viewport` config that enables
// safe-area insets (viewport-fit: cover) WITHOUT disabling user zoom. This is a real
// contract check, not a class-string assertion — it guards the foundational mobile config.
describe('root layout viewport', () => {
  it('enables viewport-fit: cover for safe-area insets', () => {
    expect(viewport.viewportFit).toBe('cover');
  });

  it('uses device-width at initial scale 1', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
  });

  it('does not disable user scaling (accessibility)', () => {
    // userScalable unset/true and no maximumScale lock — pinch-zoom stays available.
    expect(viewport.userScalable === undefined || viewport.userScalable === true).toBe(true);
    expect(viewport.maximumScale).toBeUndefined();
  });
});
