import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  allhomesProfileHtmlToExtraction,
  allhomesProfileHtmlToMarkdown,
} from '../allhomes-profile';

const html = readFileSync(
  join(__dirname, 'fixtures', 'allhomes-66a-duncan.html'),
  'utf8'
);

describe('allhomesProfileHtmlToExtraction', () => {
  it('parses attributes, estimates, and photos from a real off-market page', () => {
    const ext = allhomesProfileHtmlToExtraction(html);
    expect(ext).not.toBeNull();
    const raw = ext!.raw as Record<string, unknown>;
    expect(raw.bedrooms).toBe(3);
    expect(raw.bathrooms).toBe(2);
    expect(raw.carSpaces).toBe(1);
    expect(raw.propertyType).toBe('house');
    expect(raw.landArea).toBe(370);
    expect(raw.lotPlan).toBe('1/PS423718');
    expect(raw.estimatedValue).toBe(630000);
    expect(raw.estimatedRent).toBe(530);
    expect((raw.photos as string[]).length).toBeGreaterThanOrEqual(8);
    expect((raw.photos as string[])[0]).toContain('images.allhomes.com.au');
    const addr = raw.address as Record<string, string>;
    expect(addr.streetNumber).toBe('66A');
    expect(addr.suburb).toBe('Pakenham');
  });

  it('captures rental history with parsed weekly rent', () => {
    const raw = allhomesProfileHtmlToExtraction(html)!.raw as Record<string, unknown>;
    const rentals = raw.rentalHistory as Array<{ date: string; weeklyRent?: number }>;
    expect(rentals[0].date).toBe('2021-08-17');
    expect(rentals[0].weeklyRent).toBe(360);
  });

  it('returns null for a page without the APP_PROPS blob (shell/404)', () => {
    expect(allhomesProfileHtmlToExtraction('<html><body>404</body></html>')).toBeNull();
  });
});

describe('allhomesProfileHtmlToMarkdown', () => {
  it('produces a summary containing the address and photos', () => {
    const md = allhomesProfileHtmlToMarkdown(html)!;
    expect(md).toContain('66A Duncan Drive');
    expect(md).toContain('images.allhomes.com.au');
  });
});
